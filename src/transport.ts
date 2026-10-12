import { randomUUID } from 'node:crypto';

import {
  ChatlyApiError,
  ChatlyRateLimitError,
  ChatlyServerError,
  ChatlyTransportError,
  errorForResponse,
  parseRetryAfter,
  retryAfterHeader,
} from './errors.js';

/** Production. Never a dev or example host — see the note in {@link Transport}. */
export const DEFAULT_API_URL = 'https://api.chatlychat.com';

/** The package version, stamped into `User-Agent` so our logs can see SDK age. */
export const SDK_VERSION = '0.2.1';

export interface RetryPolicy {
  /** Total attempts, including the first. `1` disables retrying. */
  readonly attempts: number;
  /** First backoff, doubled per attempt. Jitter is applied on top. */
  readonly baseDelayMs: number;
  /** Ceiling for a single backoff, before jitter. */
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 250, maxDelayMs: 4_000 };

export interface TransportOptions {
  readonly apiKey: string;
  readonly apiUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly retry?: Partial<RetryPolicy>;
  /** Test seam. Defaults to a real timer; a test passes a no-op. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export type Query = Record<string, string | number | boolean | undefined | ReadonlyArray<string>>;

/**
 * One HTTP concern, in one place: auth, idempotency, retry, error mapping.
 *
 * Resource namespaces hold no HTTP logic at all — they build a path and a
 * body and hand both here. That is what makes the retry policy and the error
 * model uniform across 55 routes instead of per-method.
 */
export class Transport {
  private readonly base: string;
  private readonly headers: Headers;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly retry: RetryPolicy;
  private readonly sleepFn: (ms: number) => Promise<void>;
  /**
   * When set, every write uses this exact `Idempotency-Key` instead of a fresh
   * UUID. Set by `ChatlyClient.withIdempotencyKey`, which returns a client
   * sharing this transport's configuration with a pinned key.
   */
  public readonly pinnedIdempotencyKey: string | null;

  public constructor(opts: TransportOptions, pinnedIdempotencyKey: string | null = null) {
    if (typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
      throw new TypeError('ChatlyClient: apiKey is required and must be a non-empty string');
    }
    /*
     * Production, not a dev hostname.
     *
     * This was `https://api.livechat.local`, which resolves nowhere — so a
     * developer who followed the published docs and omitted `apiUrl` got an
     * SDK whose every call failed, and the docs page carried a warning
     * telling each reader to override it. Reported by a customer who
     * integrated from the docs alone, not caught here, because every test in
     * this package passes an explicit `apiUrl`. The same defect shipped in
     * the Kotlin and Swift SDKs as `api.chatly.example`.
     */
    this.base = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.headers = new Headers({
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': `chatly-sdk-node/${SDK_VERSION}`,
    });
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pinnedIdempotencyKey = pinnedIdempotencyKey;
  }

  /** A copy of this transport with a pinned idempotency key. */
  public withPinnedKey(key: string): Transport {
    const clone: Transport = Object.create(Transport.prototype);
    Object.assign(clone, this, { pinnedIdempotencyKey: key });
    return clone;
  }

  public async get<T>(path: string, query: Query = {}): Promise<T> {
    return this.send<T>('GET', path, query, undefined);
  }

  public async post<T>(path: string, body?: unknown, query: Query = {}): Promise<T> {
    return this.send<T>('POST', path, query, body);
  }

  public async patch<T>(path: string, body?: unknown, query: Query = {}): Promise<T> {
    return this.send<T>('PATCH', path, query, body);
  }

  public async put<T>(path: string, body?: unknown, query: Query = {}): Promise<T> {
    return this.send<T>('PUT', path, query, body);
  }

  public async del<T>(path: string, query: Query = {}): Promise<T> {
    return this.send<T>('DELETE', path, query, undefined);
  }

  /**
   * The escape hatch, and the one method every other method goes through.
   *
   * 85 of the 140 key-accessible routes have no typed method here. Without a
   * public way in, reaching one means abandoning the SDK and hand-rolling
   * HTTP with a bearer token — losing the retry policy, the error model and
   * the idempotency contract in the process.
   */
  public async send<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    query: Query = {},
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        // Repeated keys stay repeated: `kinds=kb&kinds=ticket`. Joining them
        // with a comma produces one parameter whose value is not a member of
        // the enum — which is what the MCP server's `search` tool did.
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const isWrite = method !== 'GET';
    /*
     * One key for the whole call, retries included.
     *
     * Minting a fresh key per ATTEMPT would defeat the header's only purpose:
     * attempt 2 of a POST that actually succeeded upstream would be accepted
     * as a new operation and double-write. Minting it per CALL means a retry
     * is recognised as the same logical operation and replayed.
     */
    const idempotencyKey = isWrite ? (this.pinnedIdempotencyKey ?? randomUUID()) : null;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      try {
        return await this.attempt<T>(url, method, body, idempotencyKey);
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof ChatlyTransportError ||
          err instanceof ChatlyRateLimitError ||
          err instanceof ChatlyServerError;
        if (!retryable || attempt === this.retry.attempts) {
          throw err;
        }
        const advised =
          err instanceof ChatlyApiError && err.retryAfter !== null ? err.retryAfter * 1000 : null;
        const backoff = Math.min(this.retry.baseDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
        // Jitter: a fleet of workers retrying in lockstep is a second outage.
        const jittered = backoff * (0.5 + Math.random() / 2);
        await this.sleepFn(advised ?? jittered);
      }
    }
    throw lastError;
  }

  private async attempt<T>(
    url: URL,
    method: string,
    body: unknown,
    idempotencyKey: string | null,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers = new Headers(this.headers);
      if (idempotencyKey !== null) {
        headers.set('idempotency-key', idempotencyKey);
      }
      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), {
          method,
          headers,
          signal: ctrl.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (cause) {
        const why = ctrl.signal.aborted ? `timed out after ${String(this.timeoutMs)}ms` : 'failed';
        throw new ChatlyTransportError(`Chatly request ${why}: ${method} ${url.pathname}`, cause);
      }

      if (!res.ok) {
        throw errorForResponse({
          status: res.status,
          body: await res.text(),
          requestId: res.headers.get('x-request-id'),
          retryAfter: parseRetryAfter(retryAfterHeader(res.headers), Date.now()),
        });
      }
      if (res.status === 204) {
        return undefined as T;
      }
      const text = await res.text();
      if (text.length === 0) {
        return undefined as T;
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
