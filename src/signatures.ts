/**
 * One verifier for every signature Chatly puts on an outbound request.
 *
 * ═══ WHY THIS EXISTS, AND WHY IT TAKES A `surface` ════════════════════════
 *
 * Chatly signs six outbound surfaces, and the published table in
 * `api-external-agents.mdx` is the authority for what each one signs. The
 * short version is that the header name does NOT determine the construction:
 *
 *   | surface                   | header(s)                                        | base string                       | `t` unit |
 *   | ------------------------- | ------------------------------------------------ | --------------------------------- | -------- |
 *   | `agent_delivery`          | `x-chatly-signature: t=…,v1=…`                   | `<t>.<rawBody>`                   | seconds  |
 *   | `event_webhook`           | `x-livechat-signature: t=…,v1=…`                 | `<t>.<rawBody>`                   | seconds  |
 *   | `ai_tool_call`            | `x-chatly-signature: t=…,v1=…`                   | `<t>.<METHOD>.<path>.<rawBody>`   | seconds  |
 *   | `canvas_step`             | `x-chatly-canvas-signature: sha256=…` + `-ts`    | `<ts>.<rawBody>`                  | **ms**   |
 *   | `customer_card`           | `x-chatly-signature: sha256=…` + `x-chatly-timestamp` | `<ts>.<rawBody>`             | **ms**   |
 *   | `workflow_webhook`        | `x-chatly-signature-v2: t=…,v1=…`                | `<t>.<rawBody>`                   | seconds  |
 *   | `workflow_webhook_legacy` | `x-chatly-signature: sha256=…`                   | `<rawBody>` — **no timestamp**    | n/a      |
 *
 * **Three different surfaces send `x-chatly-signature` and they sign three
 * different strings.** Agent delivery signs `<t>.<body>` under a `t=…,v1=…`
 * value; a tool call signs `<t>.<METHOD>.<path>.<body>` under the same-looking
 * value; a customer-card fetch signs `<ts>.<body>` with the timestamp in a
 * SEPARATE header and the value prefixed `sha256=`. A verifier that keys on
 * the header name can therefore be pointed at the wrong construction while
 * looking completely correct, which is why `surface` is required and is not
 * inferred. The caller knows which route they are terminating; this function
 * cannot.
 *
 * ── The unit trap, which this repo has paid for twice ────────────────────
 *
 * Two of the surfaces send MILLISECONDS. A millisecond timestamp read as
 * seconds lands around the year 55,000 — roughly 54,000 years out — so a
 * tolerance check on it rejects every genuine request, and the failure looks
 * like a wrong secret. The signing scheme in `@livechat/shared` shipped the
 * mirror image of this once: it emitted milliseconds in the header while
 * signing a seconds value, and a verifier that followed our own published
 * docs exactly refused 100% of real traffic.
 *
 * So the unit is a property of the SURFACE in the table above, never of the
 * value, and every comparison here happens in milliseconds after converting
 * once. The base string still uses the timestamp STRING exactly as received —
 * re-deriving it from a parsed number would drop a leading zero or a `+` and
 * change the digest.
 *
 * ── Why it returns a reason instead of a boolean ─────────────────────────
 *
 * `verifyWebhookSignature` returns `false` for nine distinct failures, and an
 * integrator debugging a rejected delivery cannot tell "your clock is wrong"
 * from "your secret is wrong" from "you passed the parsed body". Both of
 * those are a support ticket. This returns a discriminated union, and the
 * `message` is written to be printed.
 *
 * ── Why it never throws ──────────────────────────────────────────────────
 *
 * CONTRACT.md §6: "a verifier that throws is an accepted webhook in a handler
 * that forgot to catch". Every input — a missing header, a duplicated header,
 * a non-hex digest, an unknown surface, an empty secret — comes back as
 * `ok: false`. `timingSafeEqual` throws on a length mismatch, so lengths are
 * compared first, and the digest is shape-checked before it is decoded
 * because `Buffer.from('zz…', 'hex')` truncates silently rather than failing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Which outbound surface produced the request being verified. */
export type ChatlySignatureSurface =
  | 'agent_delivery'
  | 'event_webhook'
  | 'ai_tool_call'
  | 'canvas_step'
  | 'customer_card'
  | 'workflow_webhook'
  | 'workflow_webhook_legacy';

/** Why a verification failed. Stable strings, safe to branch on. */
export type ChatlySignatureFailure =
  | 'unknown_surface'
  | 'missing_secret'
  | 'missing_signature_header'
  | 'duplicate_signature_header'
  | 'malformed_signature_header'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'timestamp_outside_tolerance'
  | 'missing_request_target'
  | 'replay_unprotected'
  | 'signature_mismatch';

/**
 * Headers as a server framework hands them over.
 *
 * Structurally compatible with Node's `IncomingHttpHeaders` and with
 * `Object.fromEntries(request.headers)` from a `Request`. A `Headers` instance
 * is not accepted directly, on purpose: it is not a plain object and silently
 * reading `undefined` off one is exactly the class of bug the README's
 * three-way-wrong snippet was.
 */
export type ChatlyHeaders = Readonly<Record<string, string | string[] | undefined>>;

export interface VerifyChatlySignatureInput {
  /** Which surface this request came from. See the table in this file's header. */
  readonly surface: ChatlySignatureSurface;
  /**
   * The EXACT bytes received, before any JSON parsing. Re-serialising parsed
   * JSON reorders keys and changes whitespace, and the digest will not match.
   */
  readonly body: string | Uint8Array;
  /** The request's headers. Looked up case-insensitively. */
  readonly headers: ChatlyHeaders;
  /** The secret for THIS surface. No secret verifies across two of them. */
  readonly secret: string;
  /**
   * Freshness window, always in SECONDS whatever unit the surface's timestamp
   * is in. Defaults to {@link CHATLY_SIGNATURE_TOLERANCE_SECONDS}. Pass
   * `Infinity` only when re-verifying something out of an archive.
   */
  readonly toleranceSeconds?: number;
  /**
   * `ai_tool_call` only: the HTTP method of the request, which is inside the
   * signed string. Case is normalised.
   */
  readonly method?: string;
  /**
   * `ai_tool_call` only: `pathname + search` of the request, which is inside
   * the signed string. Never the scheme or the host — see
   * `toolRequestPath` in `@livechat/shared/ai-tools`.
   */
  readonly path?: string;
  /**
   * `workflow_webhook_legacy` only, and required there.
   *
   * That surface signs the body with NO timestamp, so a captured request
   * verifies forever and this function cannot bound a replay. Verifying it
   * has to be a deliberate choice, so the default is a refusal that names
   * `workflow_webhook` instead. See {@link CHATLY_SIGNATURE_SURFACES}.
   */
  readonly allowUnprotectedReplay?: boolean;
  /** Escape hatch for tests. Unix MILLISECONDS. */
  readonly nowMs?: number;
}

export type VerifyChatlySignatureResult =
  | {
      readonly ok: true;
      readonly surface: ChatlySignatureSurface;
      /**
       * When the sender says it signed, in Unix milliseconds — normalised, so
       * a seconds surface and a milliseconds surface are comparable. `null`
       * on `workflow_webhook_legacy`, which sends no timestamp.
       */
      readonly timestampMs: number | null;
    }
  | {
      readonly ok: false;
      readonly surface: ChatlySignatureSurface;
      readonly reason: ChatlySignatureFailure;
      /** A sentence written to be printed to whoever has to fix it. */
      readonly message: string;
    };

/** Five minutes, matching `SIGNATURE_TOLERANCE_SECONDS` on the producing side. */
export const CHATLY_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Not a header name: the timestamp is the digest header's own `t=` field.
 *
 * A sentinel rather than a boolean, so `timestampFrom` answers "where" in one
 * place and a surface that moves its timestamp into a header of its own needs
 * only a table edit.
 */
const IN_SIGNATURE = 'in-signature';

interface SurfaceSpec {
  /** The header carrying the digest. */
  readonly signatureHeader: string;
  /**
   * Where `t` comes from: the name of the header carrying it on its own, or
   * the sentinel {@link IN_SIGNATURE} when it is the digest header's own `t=`
   * field, or `null` when the surface sends none.
   *
   * Typed `string | null` rather than `'in-signature' | string | null`,
   * because a literal in a union with `string` is absorbed by it and reads as
   * a type that narrows when it does not.
   */
  readonly timestampFrom: string | null;
  /** `t=…,v1=<hex>` or `sha256=<hex>`. */
  readonly format: 'tv1' | 'sha256';
  /** The unit of whatever `timestampFrom` yields. `null` when there is none. */
  readonly unit: 'seconds' | 'milliseconds' | null;
  /** True when the method and path are inside the signed string. */
  readonly signsRequestTarget: boolean;
  /** A one-line description, for an error message and for documentation. */
  readonly describe: string;
}

/**
 * The table, as data.
 *
 * Exported because it is the thing to read when a verification fails and
 * because the `chatly listen` command prints from it. Keeping it as data
 * rather than a `switch` is also what lets a test assert that every surface in
 * the union has an entry — a surface added to the type and forgotten here
 * would otherwise be an `unknown_surface` refusal at runtime.
 */
export const CHATLY_SIGNATURE_SURFACES: Readonly<Record<ChatlySignatureSurface, SurfaceSpec>> = {
  agent_delivery: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    signsRequestTarget: false,
    describe: "external-agent push delivery, signed with the bot's signingSecret",
  },
  event_webhook: {
    signatureHeader: 'x-livechat-signature',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    signsRequestTarget: false,
    describe: "event webhook, signed with that subscription's whsec_ secret",
  },
  ai_tool_call: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    signsRequestTarget: true,
    describe: "custom AI tool call, signed with that tool's secret over t.METHOD.path.body",
  },
  canvas_step: {
    signatureHeader: 'x-chatly-canvas-signature',
    timestampFrom: 'x-chatly-canvas-ts',
    format: 'sha256',
    unit: 'milliseconds',
    signsRequestTarget: false,
    describe: 'canvas / interactive-step callback, timestamp in MILLISECONDS',
  },
  customer_card: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: 'x-chatly-timestamp',
    format: 'sha256',
    unit: 'milliseconds',
    signsRequestTarget: false,
    describe: 'customer-card fetch, timestamp in MILLISECONDS',
  },
  workflow_webhook: {
    signatureHeader: 'x-chatly-signature-v2',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    signsRequestTarget: false,
    describe: 'workflow "call a webhook" action, replay-bounded v2 header',
  },
  workflow_webhook_legacy: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: null,
    format: 'sha256',
    unit: null,
    signsRequestTarget: false,
    describe: 'workflow action, LEGACY header over the body alone — no replay protection',
  },
};

/** 64 lowercase-or-uppercase hex characters and nothing else. */
const HEX_SHA256 = /^[0-9a-fA-F]{64}$/;

function headerValue(headers: ChatlyHeaders, name: string): string[] {
  const wanted = name.toLowerCase();
  const found: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      found.push(...value);
    } else {
      found.push(value);
    }
  }
  return found;
}

function fail(
  surface: ChatlySignatureSurface,
  reason: ChatlySignatureFailure,
  message: string,
): VerifyChatlySignatureResult {
  return { ok: false, surface, reason, message };
}

/**
 * Parse a `t=…,v1=…` value. Tolerates spaces and extra fields — a future `v2`
 * field must not break a `v1` verifier, which is the whole point of the
 * prefix.
 */
function parseTv1(raw: string): { t: string; v1: string } | null {
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      t = value;
    } else if (key === 'v1') {
      v1 = value;
    }
  }
  if (t === undefined || v1 === undefined) {
    return null;
  }
  return { t, v1 };
}

/**
 * Verify one signed request from Chatly.
 *
 * ```ts
 * const result = verifyChatlySignature({
 *   surface: 'event_webhook',
 *   body: rawBody,
 *   headers: req.headers,
 *   secret: process.env.CHATLY_WEBHOOK_SECRET!,
 * });
 * if (!result.ok) {
 *   console.warn(result.reason, result.message);
 *   return reply.status(400).send();
 * }
 * ```
 *
 * Never throws. See this file's header for the surface table and the two
 * traps it exists to prevent.
 */
export function verifyChatlySignature(
  input: VerifyChatlySignatureInput,
): VerifyChatlySignatureResult {
  const { surface } = input;
  const spec = Object.prototype.hasOwnProperty.call(CHATLY_SIGNATURE_SURFACES, surface)
    ? CHATLY_SIGNATURE_SURFACES[surface]
    : undefined;
  if (spec === undefined) {
    return fail(
      surface,
      'unknown_surface',
      `"${String(surface)}" is not a Chatly signature surface. One of: ${Object.keys(
        CHATLY_SIGNATURE_SURFACES,
      ).join(', ')}.`,
    );
  }

  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    return fail(
      surface,
      'missing_secret',
      `No secret given for ${surface}. Each surface has its own secret — ${spec.describe}. ` +
        'A secret from another surface will never verify.',
    );
  }

  if (surface === 'workflow_webhook_legacy' && input.allowUnprotectedReplay !== true) {
    return fail(
      surface,
      'replay_unprotected',
      'The legacy workflow header signs the body with no timestamp, so a captured request ' +
        'verifies forever and nothing here can bound a replay. The same call also sends ' +
        'x-chatly-signature-v2 — verify that instead, with surface "workflow_webhook". ' +
        'If you must accept the legacy header, pass allowUnprotectedReplay: true and make ' +
        'the endpoint idempotent.',
    );
  }

  // ── The digest header ───────────────────────────────────────────────────
  const sigHeaders = headerValue(input.headers, spec.signatureHeader);
  if (sigHeaders.length === 0) {
    return fail(
      surface,
      'missing_signature_header',
      `No ${spec.signatureHeader} header. ${capitalise(spec.describe)} always sends one; ` +
        'if the request carries a differently named signature header, you have the wrong surface.',
    );
  }
  if (sigHeaders.length > 1) {
    // Two values means something between us and you merged or injected one,
    // and picking either is a guess. Refuse rather than trial-verify both.
    return fail(
      surface,
      'duplicate_signature_header',
      `${sigHeaders.length} ${spec.signatureHeader} headers arrived. Chatly sends exactly one; ` +
        'a proxy merged or added one, and choosing between them would be a guess.',
    );
  }
  const rawSignature = (sigHeaders[0] ?? '').trim();

  let digestHex: string;
  let rawTimestamp: string | null = null;
  if (spec.format === 'tv1') {
    const parsed = parseTv1(rawSignature);
    if (parsed === null) {
      return fail(
        surface,
        'malformed_signature_header',
        `${spec.signatureHeader} should be "t=<unix seconds>,v1=<hex>" on ${surface}; ` +
          `got "${preview(rawSignature)}".`,
      );
    }
    digestHex = parsed.v1;
    rawTimestamp = parsed.t;
  } else {
    if (!rawSignature.startsWith('sha256=')) {
      return fail(
        surface,
        'malformed_signature_header',
        `${spec.signatureHeader} should be "sha256=<hex>" on ${surface}; ` +
          `got "${preview(rawSignature)}". A "t=…,v1=…" value here means you have the ` +
          'wrong surface — that is the other signature family.',
      );
    }
    digestHex = rawSignature.slice('sha256='.length).trim();
  }

  if (!HEX_SHA256.test(digestHex)) {
    // Shape-checked BEFORE decoding: `Buffer.from` stops at the first
    // non-hex character and returns a short buffer rather than failing, so a
    // garbage digest would otherwise reach the compare as a length mismatch
    // and be reported as a mismatched signature.
    return fail(
      surface,
      'malformed_signature_header',
      `The digest in ${spec.signatureHeader} is not 64 hex characters ` +
        `(got ${String(digestHex.length)}).`,
    );
  }

  // ── The timestamp, and its unit ─────────────────────────────────────────
  let timestampMs: number | null = null;
  if (spec.unit !== null) {
    if (spec.timestampFrom !== IN_SIGNATURE && spec.timestampFrom !== null) {
      const tsHeaders = headerValue(input.headers, spec.timestampFrom);
      const first = tsHeaders[0];
      if (first === undefined) {
        return fail(
          surface,
          'missing_timestamp',
          `No ${spec.timestampFrom} header. On ${surface} the timestamp travels in its own ` +
            'header and is part of the signed string, so it cannot be reconstructed.',
        );
      }
      rawTimestamp = first.trim();
    }
    if (rawTimestamp === null || rawTimestamp.length === 0) {
      return fail(surface, 'missing_timestamp', `No timestamp found for ${surface}.`);
    }
    // `Number.parseInt` would read "17e9" as 17 and "12abc" as 12. A
    // timestamp is digits.
    if (!/^\d+$/.test(rawTimestamp)) {
      return fail(
        surface,
        'malformed_timestamp',
        `The timestamp on ${surface} is not a run of digits: "${preview(rawTimestamp)}".`,
      );
    }
    const asNumber = Number(rawTimestamp);
    if (!Number.isFinite(asNumber)) {
      return fail(
        surface,
        'malformed_timestamp',
        `The timestamp on ${surface} is not a finite number: "${preview(rawTimestamp)}".`,
      );
    }
    timestampMs = spec.unit === 'seconds' ? asNumber * 1000 : asNumber;

    const toleranceSeconds = input.toleranceSeconds ?? CHATLY_SIGNATURE_TOLERANCE_SECONDS;
    const nowMs = input.nowMs ?? Date.now();
    const driftMs = Math.abs(nowMs - timestampMs);
    if (driftMs > toleranceSeconds * 1000) {
      /*
       * The hint is the point of this branch. A wrong-unit mistake lands
       * roughly 54,000 years out in one direction or 54 years in the other,
       * and both read as "expired" unless something says so.
       */
      const driftYears = driftMs / (1000 * 60 * 60 * 24 * 365);
      const unitHint =
        driftYears > 1
          ? ` That is ${driftYears.toFixed(0)} year(s) out, which is what a wrong UNIT looks like: ` +
            `${surface} sends ${spec.unit}.`
          : '';
      return fail(
        surface,
        'timestamp_outside_tolerance',
        `The timestamp on ${surface} is ${String(Math.round(driftMs / 1000))}s from now, outside ` +
          `the ${String(toleranceSeconds)}s tolerance.${unitHint}`,
      );
    }
  }

  // ── The base string ─────────────────────────────────────────────────────
  const bodyBytes =
    typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : Buffer.from(input.body);

  let prefix: string;
  if (spec.signsRequestTarget) {
    const method = input.method;
    const path = input.path;
    if (
      typeof method !== 'string' ||
      method.length === 0 ||
      typeof path !== 'string' ||
      path.length === 0
    ) {
      return fail(
        surface,
        'missing_request_target',
        `${surface} signs <t>.<METHOD>.<path>.<rawBody>, so both method and path are required. ` +
          'path is pathname + search of the request as Chatly rendered it — not the host, not ' +
          'the scheme.',
      );
    }
    prefix = `${rawTimestamp ?? ''}.${method.toUpperCase()}.${path}.`;
  } else if (spec.unit === null) {
    // The legacy workflow header: the body alone.
    prefix = '';
  } else {
    prefix = `${rawTimestamp ?? ''}.`;
  }

  const hmac = createHmac('sha256', input.secret);
  if (prefix.length > 0) {
    hmac.update(prefix);
  }
  hmac.update(bodyBytes);
  const expected = Buffer.from(hmac.digest('hex'), 'hex');
  const given = Buffer.from(digestHex, 'hex');

  // Length first: `timingSafeEqual` THROWS on a mismatch, and a verifier that
  // throws is an accepted webhook in a handler that forgot try/catch.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return fail(
      surface,
      'signature_mismatch',
      `The digest does not match for ${surface}. The three usual causes, in order: a ` +
        're-serialised body (pass the RAW bytes, not JSON.stringify of the parsed object), the ' +
        `secret from a different surface, or the wrong surface — ${spec.describe}.`,
    );
  }

  return { ok: true, surface, timestampMs };
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

/** Clip an untrusted header value so an error message stays one line. */
function preview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 47)}…` : value;
}
