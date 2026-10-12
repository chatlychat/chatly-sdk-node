/**
 * The error model.
 *
 * This SDK used to throw `new Error(`livechat ${status}: ${text}`)` for every
 * failure, which forced every caller into string matching to tell "the key is
 * wrong" from "the key is missing a scope" from "the contact does not exist".
 * Those three need different handling — re-auth, ask an admin, create it — and
 * a caller that cannot distinguish them retries all three or none.
 *
 * Nothing here extends the monorepo's `AppError`: this package is published to
 * people who must not install our internals, so it stays dependency-free by
 * design.
 */

/** The parsed body of an API error response, as far as it could be read. */
export interface ApiErrorShape {
  readonly code?: string;
  readonly message?: string;
}

/** Base for everything this SDK throws. `instanceof ChatlyError` catches all of it. */
export class ChatlyError extends Error {
  public override readonly name: string = 'ChatlyError';
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * The API answered, and the answer was a failure status.
 *
 * `requestId` is the `x-request-id` header. Quote it in a support request —
 * it is the only way to find the exact call in our traces.
 */
export class ChatlyApiError extends ChatlyError {
  public override readonly name: string = 'ChatlyApiError';
  public readonly status: number;
  public readonly code: string | null;
  public readonly requestId: string | null;
  /** The raw response text. Everything `code`/`message` could not represent. */
  public readonly body: string;
  /** Seconds the server asked us to wait, from `Retry-After`. Only on 429/503. */
  public readonly retryAfter: number | null;

  public constructor(input: {
    status: number;
    code: string | null;
    message: string;
    requestId: string | null;
    body: string;
    retryAfter: number | null;
  }) {
    super(input.message);
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.body = input.body;
    this.retryAfter = input.retryAfter;
  }
}

/** 401 — the key is missing, malformed, revoked or belongs to no workspace. */
export class ChatlyAuthenticationError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyAuthenticationError';
}
/** 403 — the key is valid and lacks the scope this route needs. Check `whoami()`. */
export class ChatlyPermissionError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyPermissionError';
}
/** 404 — no such resource in this workspace. */
export class ChatlyNotFoundError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyNotFoundError';
}
/**
 * 409 — most often an idempotency conflict: this `Idempotency-Key` was already
 * used with a DIFFERENT body. Mint a new key, or send the original body.
 */
export class ChatlyConflictError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyConflictError';
}
/** 422 (and 400) — the request body or query failed validation. */
export class ChatlyValidationError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyValidationError';
}
/** 429 — rate limited. `retryAfter` carries the server's own advice, in seconds. */
export class ChatlyRateLimitError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyRateLimitError';
}
/** 5xx — our problem. Safe to retry; the SDK already did, up to its limit. */
export class ChatlyServerError extends ChatlyApiError {
  public override readonly name: string = 'ChatlyServerError';
}

/**
 * The request never produced an HTTP response: DNS, TCP, TLS, timeout, abort.
 *
 * Deliberately NOT a subclass of {@link ChatlyApiError} — there is no status
 * to branch on, and code that does `err.status >= 500` must not silently read
 * `undefined` here.
 */
export class ChatlyTransportError extends ChatlyError {
  public override readonly name: string = 'ChatlyTransportError';
  public constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

/** Seconds, from a `Retry-After` that may be a delta or an HTTP date. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header === null || header.trim() === '') {
    return null;
  }
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    return Math.max(0, Math.round((at - nowMs) / 1000));
  }
  return null;
}

/** Map a failure response onto the narrowest error class that fits. */
export function errorForResponse(input: {
  status: number;
  body: string;
  requestId: string | null;
  retryAfter: number | null;
}): ChatlyApiError {
  let parsed: ApiErrorShape = {};
  try {
    const json: unknown = JSON.parse(input.body);
    if (typeof json === 'object' && json !== null) {
      // The API's envelope is `{ code, message }`, sometimes nested under `error`.
      const outer = json as Record<string, unknown>;
      const inner =
        typeof outer['error'] === 'object' && outer['error'] !== null
          ? (outer['error'] as Record<string, unknown>)
          : outer;
      parsed = {
        code: typeof inner['code'] === 'string' ? inner['code'] : undefined,
        message: typeof inner['message'] === 'string' ? inner['message'] : undefined,
      };
    }
  } catch {
    // Not JSON — an HTML error page from a proxy, or an empty body. `body` keeps it.
  }

  const message = parsed.message ?? `Chatly API responded ${String(input.status)}`;
  const args = {
    status: input.status,
    code: parsed.code ?? null,
    message,
    requestId: input.requestId,
    body: input.body,
    retryAfter: input.retryAfter,
  };

  if (input.status === 401) {
    return new ChatlyAuthenticationError(args);
  }
  if (input.status === 403) {
    return new ChatlyPermissionError(args);
  }
  if (input.status === 404) {
    return new ChatlyNotFoundError(args);
  }
  if (input.status === 409) {
    return new ChatlyConflictError(args);
  }
  /*
   * 400 as well as 422. Nothing in this API answers 422 — `ValidationError`
   * is `httpStatus: 400, code: validation_failed` and the exception filter
   * maps a raw `ZodError` the same way — so a client that mapped 422 alone
   * put every real validation failure in the generic branch. The Java SDK
   * shipped exactly that.
   */
  if (input.status === 400 || input.status === 422) {
    return new ChatlyValidationError(args);
  }
  if (input.status === 429) {
    return new ChatlyRateLimitError(args);
  }
  if (input.status >= 500) {
    return new ChatlyServerError(args);
  }
  return new ChatlyApiError(args);
}

/**
 * The retry advice, from whichever spelling the server used.
 *
 * `@nestjs/throttler` names its buckets, so Chatly emits
 * `Retry-After-{bucket}` and — until 2026-10-12 — never a plain
 * `Retry-After`. Our own published docs said so. This SDK read only the plain
 * header, so `retryAfter` was null on every real 429. The API now derives the
 * plain header as well, but a deployment that has not taken that change still
 * sends only the suffixed ones, so read both and take the LONGEST: backing
 * off for the shortest bucket retries into a limit that is still closed.
 */
export function retryAfterHeader(headers: Headers): string | null {
  const plain = headers.get('retry-after');
  if (plain !== null && plain.trim() !== '') {
    return plain;
  }
  let longest: number | null = null;
  headers.forEach((value, name) => {
    if (!name.toLowerCase().startsWith('retry-after-')) {
      return;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && (longest === null || seconds > longest)) {
      longest = seconds;
    }
  });
  return longest === null ? null : String(longest);
}
