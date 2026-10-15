/**
 * One verifier for every signature Chatly puts on an outbound request.
 *
 * The surface table — which header, which base string, which time unit — is
 * `signature-table.ts`, and this module re-exports it, so one import of
 * `./signatures.js` still gets everything.
 *
 * ═══ WHY IT TAKES A `surface` ═════════════════════════════════════════════
 *
 * Because the header name does not determine the construction. Three
 * surfaces send `x-chatly-signature` and sign three different strings, and
 * two of the eight send MILLISECONDS. The caller knows which route they are
 * terminating; this function cannot. The table's own header has the detail
 * and the two traps.
 *
 * ═══ THE UNIFIED v2 CONSTRUCTION ══════════════════════════════════════════
 *
 * `x-chatly-signature-v2: t=<unix seconds>,v1=<hex>` over
 * `<t>.<METHOD>.<path>.<rawBody>` is where every surface is going, sent
 * alongside each one's legacy header. `v2` on the input chooses how much to
 * insist on it, and the default is the one that makes the migration free:
 *
 *   - `'prefer'` (default) — if the v2 header is present AND `method` and
 *     `path` were supplied, verify THAT and nothing else. Otherwise verify
 *     the surface's own legacy construction. So a receiver that passes its
 *     method and path gets the stronger check the day the sender starts
 *     emitting v2, with no code change, and is unaffected until then.
 *   - `'require'` — refuse unless the v2 header is there. For a receiver who
 *     has confirmed the sender has moved and wants no way back.
 *   - `'ignore'` — the surface's own construction only.
 *
 * `prefer` never cross-falls-back: once v2 is chosen, a mismatched v2 digest
 * is a refusal, not a reason to try the legacy header. Both headers come from
 * the same secret, so a request with a good legacy digest and a bad v2 one is
 * either tampered with or a sender bug, and accepting it would hide both.
 *
 * The ok arm's `surface` reports what actually verified, which on a preferred
 * v2 is `'unified_v2'` rather than the surface asked for.
 *
 * ═══ KEY ROTATION ═════════════════════════════════════════════════════════
 *
 * Two shapes, and both are supported because rotation needs both ends:
 *
 *   - `secret` takes an ARRAY. A receiver mid-rotation accepts the old and
 *     the new secret, and `secretIndex` on the ok arm says which one
 *     verified — which is how you find out the old one is finally unused.
 *   - the `t=…,v1=…,v1=…` header carries a LIST of digests. A sender
 *     mid-rotation signs with both secrets, and any one matching is enough.
 *
 * ═══ WHY IT RETURNS A REASON INSTEAD OF A BOOLEAN ═════════════════════════
 *
 * `verifyWebhookSignature` returns `false` for nine distinct failures, and an
 * integrator debugging a rejected delivery cannot tell "your clock is wrong"
 * from "your secret is wrong" from "you passed the parsed body". Both of
 * those are a support ticket. This returns a discriminated union, and the
 * `message` is written to be printed.
 *
 * ═══ WHY IT NEVER THROWS ══════════════════════════════════════════════════
 *
 * CONTRACT.md §6: "a verifier that throws is an accepted webhook in a handler
 * that forgot to catch". Every input — a missing header, a duplicated header,
 * a non-hex digest, an unknown surface, an empty secret — comes back as
 * `ok: false`. `timingSafeEqual` throws on a length mismatch, so lengths are
 * compared first, and a digest is shape-checked before it is decoded because
 * `Buffer.from('zz…', 'hex')` truncates silently rather than failing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  CHATLY_SIGNATURE_SURFACES,
  CHATLY_SIGNATURE_TOLERANCE_SECONDS,
  CHATLY_V2_SIGNATURE_HEADER,
  IN_SIGNATURE,
  type ChatlyHeaders,
  type ChatlySignatureBase,
  type ChatlySignatureFailure,
  type ChatlySignatureSurface,
} from './signature-table.js';

export {
  CHATLY_SIGNATURE_SURFACES,
  CHATLY_SIGNATURE_TOLERANCE_SECONDS,
  CHATLY_V2_SIGNATURE_HEADER,
  type ChatlyHeaders,
  type ChatlySignatureBase,
  type ChatlySignatureFailure,
  type ChatlySignatureSurface,
  type SurfaceSpec,
} from './signature-table.js';

/** How hard to insist on the unified v2 construction. See this file's header. */
export type ChatlyV2Policy = 'prefer' | 'require' | 'ignore';

export interface VerifyChatlySignatureInput {
  /** Which surface this request came from. See `signature-table.ts`. */
  readonly surface: ChatlySignatureSurface;
  /**
   * The EXACT bytes received, before any JSON parsing. Re-serialising parsed
   * JSON reorders keys and changes whitespace, and the digest will not match.
   */
  readonly body: string | Uint8Array;
  /** The request's headers. Looked up case-insensitively. */
  readonly headers: ChatlyHeaders;
  /**
   * The secret for THIS surface, or every secret that is currently live on
   * it. No secret verifies across two surfaces.
   */
  readonly secret: string | readonly string[];
  /**
   * Freshness window, always in SECONDS whatever unit the surface's timestamp
   * is in. Defaults to {@link CHATLY_SIGNATURE_TOLERANCE_SECONDS}. Rejects
   * stale AND far-future timestamps. Pass `Infinity` only when re-verifying
   * something out of an archive.
   */
  readonly toleranceSeconds?: number;
  /**
   * The HTTP method of the request, which is inside the signed string on
   * `unified_v2` and `ai_tool_call`. Case is normalised. Supplying it on any
   * surface is what lets `v2: 'prefer'` pick up the v2 header when it
   * appears.
   */
  readonly method?: string;
  /**
   * `pathname + search` of the request, which is inside the signed string on
   * `unified_v2` and `ai_tool_call`. Never the scheme or the host — see
   * `toolRequestPath` in `@livechat/shared/ai-tools`.
   */
  readonly path?: string;
  /** How hard to insist on the v2 header. Default `'prefer'`. */
  readonly v2?: ChatlyV2Policy;
  /**
   * `workflow_webhook_legacy` only, and required there.
   *
   * That surface signs the body with NO timestamp, so a captured request
   * verifies forever and this function cannot bound a replay. Verifying it
   * has to be a deliberate choice, so the default is a refusal that names
   * `workflow_webhook` instead.
   */
  readonly allowUnprotectedReplay?: boolean;
  /** Escape hatch for tests. Unix MILLISECONDS. */
  readonly nowMs?: number;
}

export type VerifyChatlySignatureResult =
  | {
      readonly ok: true;
      /**
       * What actually verified — `'unified_v2'` when the v2 header was
       * preferred over the surface asked for.
       */
      readonly surface: ChatlySignatureSurface;
      /**
       * When the sender says it signed, in Unix milliseconds — normalised, so
       * a seconds surface and a milliseconds surface are comparable. `null`
       * on `workflow_webhook_legacy`, which sends no timestamp.
       */
      readonly timestampMs: number | null;
      /** Which string the matching MAC was taken over. */
      readonly base: ChatlySignatureBase;
      /**
       * Index into the `secret` array that verified, or `0` for a single
       * secret. During a rotation this is how you learn the old secret is
       * no longer in use.
       */
      readonly secretIndex: number;
    }
  | {
      readonly ok: false;
      readonly surface: ChatlySignatureSurface;
      readonly reason: ChatlySignatureFailure;
      /** A sentence written to be printed to whoever has to fix it. */
      readonly message: string;
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
 * Parse a `t=…,v1=…` value, collecting EVERY `v1`.
 *
 * Tolerates spaces and extra fields — a future `v3` field must not break a
 * `v1` verifier, which is the whole point of the prefix — and keeps the
 * FIRST `t`, so a crafted second `t` cannot move the window.
 */
function parseTv1(raw: string): { t: string; v1: string[] } | null {
  let t: string | undefined;
  const v1: string[] = [];
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      t ??= value;
    } else if (key === 'v1') {
      v1.push(value);
    }
  }
  if (t === undefined || v1.length === 0) {
    return null;
  }
  return { t, v1 };
}

/**
 * Every non-empty secret the caller handed over, in order.
 *
 * Defensive about what it is given because this function must never throw: a
 * plain-JavaScript caller passing `undefined`, or an array with a hole in it,
 * has to come back as `missing_secret` rather than a `TypeError` out of
 * somebody's webhook handler.
 */
function secretsFrom(secret: string | readonly string[]): string[] {
  const list: readonly unknown[] =
    typeof secret === 'string' ? [secret] : Array.isArray(secret) ? (secret as unknown[]) : [];
  return list.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

function hasTarget(input: VerifyChatlySignatureInput): boolean {
  return (
    typeof input.method === 'string' &&
    input.method.length > 0 &&
    typeof input.path === 'string' &&
    input.path.length > 0
  );
}

/**
 * The v2 decision, taken before anything is parsed.
 *
 * Returns a result when it has answered the whole question — either by
 * delegating to `unified_v2` or by refusing — and `null` when verification
 * should continue on the surface asked for.
 */
function applyV2Policy(input: VerifyChatlySignatureInput): VerifyChatlySignatureResult | null {
  const { surface } = input;
  const spec = CHATLY_SIGNATURE_SURFACES[surface];
  const policy = input.v2 ?? 'prefer';
  if (policy === 'ignore' || surface === 'unified_v2') {
    return null;
  }
  // A surface whose OWN header is the v2 header handles the two bases in its
  // candidate list instead; there is nothing to delegate to.
  if (spec.signatureHeader === CHATLY_V2_SIGNATURE_HEADER) {
    return null;
  }

  const present = headerValue(input.headers, CHATLY_V2_SIGNATURE_HEADER).length > 0;
  if (policy === 'require' && !present) {
    return fail(
      surface,
      'missing_signature_header',
      `v2: "require" was asked for and this request carries no ${CHATLY_V2_SIGNATURE_HEADER} ` +
        `header. ${spec.signatureHeader} alone means the sender has not moved to the unified ` +
        'construction yet — use the default v2: "prefer" until it has.',
    );
  }
  if (!present) {
    return null;
  }
  if (!hasTarget(input)) {
    if (policy === 'require') {
      return fail(
        surface,
        'missing_request_target',
        `The unified ${CHATLY_V2_SIGNATURE_HEADER} signs <t>.<METHOD>.<path>.<rawBody>, so ` +
          'both method and path are required to verify it. path is pathname + search of the ' +
          'request as it arrived — not the host, not the scheme.',
      );
    }
    // `prefer`, with no target to verify against: the legacy header is still
    // being sent beside it, so fall through rather than refuse a request the
    // caller can verify.
    return null;
  }

  const result = verifyChatlySignature({ ...input, surface: 'unified_v2', v2: 'ignore' });
  if (result.ok) {
    return result;
  }
  return fail(
    'unified_v2',
    result.reason,
    `${result.message} (This request carried ${CHATLY_V2_SIGNATURE_HEADER}, so it was verified ` +
      `as the unified v2 construction rather than as ${surface}. Pass v2: "ignore" to verify ` +
      `${spec.signatureHeader} instead.)`,
  );
}

/**
 * Which strings the MAC may have been taken over, most specific first.
 *
 * More than one only on `workflow_webhook`, which sent the v2 header before
 * the base gained the method and path — see `signature-table.ts`.
 */
function candidateBases(input: VerifyChatlySignatureInput): ChatlySignatureBase[] {
  const spec = CHATLY_SIGNATURE_SURFACES[input.surface];
  const policy = input.v2 ?? 'prefer';
  if (spec.alsoAcceptsTargetBase !== true || policy === 'ignore' || !hasTarget(input)) {
    return [spec.base];
  }
  // `require` on this surface means the unified base and nothing else.
  return policy === 'require' ? ['target'] : ['target', spec.base];
}

function baseStringPrefix(
  base: ChatlySignatureBase,
  rawTimestamp: string | null,
  input: VerifyChatlySignatureInput,
): string {
  if (base === 'body_only') {
    return '';
  }
  const t = rawTimestamp ?? '';
  if (base === 'body') {
    return `${t}.`;
  }
  return `${t}.${(input.method ?? '').toUpperCase()}.${input.path ?? ''}.`;
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
 *   method: req.method,
 *   path: req.url,
 * });
 * if (!result.ok) {
 *   console.warn(result.reason, result.message);
 *   return reply.status(400).send();
 * }
 * ```
 *
 * Never throws. See this file's header and `signature-table.ts`.
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

  const secrets = secretsFrom(input.secret);
  if (secrets.length === 0) {
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

  const viaV2 = applyV2Policy(input);
  if (viaV2 !== null) {
    return viaV2;
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

  let digestsHex: string[];
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
    digestsHex = parsed.v1;
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
    digestsHex = [rawSignature.slice('sha256='.length).trim()];
  }

  for (const digestHex of digestsHex) {
    if (!HEX_SHA256.test(digestHex)) {
      /*
       * Shape-checked BEFORE decoding: `Buffer.from` stops at the first
       * non-hex character and returns a short buffer rather than failing, so
       * a garbage digest would otherwise reach the compare as a length
       * mismatch and be reported as a mismatched signature.
       */
      return fail(
        surface,
        'malformed_signature_header',
        `A digest in ${spec.signatureHeader} is not 64 hex characters ` +
          `(got ${String(digestHex.length)}).` +
          (digestsHex.length > 1
            ? ` ${String(digestsHex.length)} v1 values arrived; every one has to be well formed.`
            : ''),
      );
    }
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
    const signedMs = timestampMs;
    const driftMs = Math.abs(nowMs - signedMs);
    if (driftMs > toleranceSeconds * 1000) {
      /*
       * Both directions are refused, and the message says which. A stale
       * timestamp is a replay or a slow queue; a FAR-FUTURE one is a sender
       * clock or — far more often — the wrong unit, which lands roughly
       * 54,000 years out in one direction or 54 years in the other and reads
       * as "expired" unless something says so.
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
        `The timestamp on ${surface} is ${String(Math.round(driftMs / 1000))}s ` +
          `${signedMs > nowMs ? 'in the FUTURE' : 'in the past'}, outside the ` +
          `${String(toleranceSeconds)}s tolerance.${unitHint}`,
      );
    }
  }

  // ── The base string, and the compare ────────────────────────────────────
  const bases = candidateBases(input);
  if (bases.includes('target') && !hasTarget(input)) {
    return fail(
      surface,
      'missing_request_target',
      `${surface} signs <t>.<METHOD>.<path>.<rawBody>, so both method and path are required. ` +
        'path is pathname + search of the request as Chatly rendered it — not the host, not ' +
        'the scheme.',
    );
  }

  const bodyBytes =
    typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : Buffer.from(input.body);
  const given = digestsHex.map((hex) => Buffer.from(hex, 'hex'));

  for (const base of bases) {
    const prefix = baseStringPrefix(base, rawTimestamp, input);
    for (let i = 0; i < secrets.length; i += 1) {
      const hmac = createHmac('sha256', secrets[i] ?? '');
      if (prefix.length > 0) {
        hmac.update(prefix);
      }
      hmac.update(bodyBytes);
      const expected = Buffer.from(hmac.digest('hex'), 'hex');
      for (const candidate of given) {
        // Length first: `timingSafeEqual` THROWS on a mismatch, and a
        // verifier that throws is an accepted webhook in a handler that
        // forgot try/catch.
        if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
          return { ok: true, surface, timestampMs, base, secretIndex: i };
        }
      }
    }
  }

  return fail(
    surface,
    'signature_mismatch',
    `The digest does not match for ${surface}. The three usual causes, in order: a ` +
      're-serialised body (pass the RAW bytes, not JSON.stringify of the parsed object), the ' +
      `secret from a different surface, or the wrong surface — ${spec.describe}.` +
      (secrets.length > 1 ? ` None of the ${String(secrets.length)} secrets matched.` : ''),
  );
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

/** Clip an untrusted header value so an error message stays one line. */
function preview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 47)}…` : value;
}
