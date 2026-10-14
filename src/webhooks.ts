import { createHmac, timingSafeEqual } from 'node:crypto';

/** Freshness window for `t`, in seconds. Matches what the docs recommend. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookSignatureInput {
  /**
   * The EXACT bytes we POSTed. Pass the raw body — re-serialising parsed JSON
   * reorders keys and changes whitespace, and the digest will not match.
   */
  body: string | Uint8Array;
  /** The `x-livechat-signature` header value: `t=<unix seconds>,v1=<hex>`. */
  signatureHeader: string;
  /** The endpoint's `whsec_…` signing secret.  */
  secret: string;
  /**
   * How far `t` may be from now before the delivery is treated as a replay.
   * Defaults to {@link WEBHOOK_SIGNATURE_TOLERANCE_SECONDS}; pass `Infinity`
   * only when re-verifying an archived delivery.
   */
  toleranceSeconds?: number;
  /** Escape hatch for tests. Unix seconds. */
  nowSeconds?: number;
}

/**
 * Verify the signature header on a webhook delivery from the platform.
 *
 * **Prefer {@link verifyChatlySignature}.** This function handles exactly one
 * of the seven things Chatly signs — the `x-livechat-signature` event webhook
 * — and it takes the header VALUE, so a caller holding a request has to know
 * which header to pull out and has no way to be told they picked the wrong
 * one. `verifyChatlySignature` takes the whole header bag plus the surface
 * name, covers all seven constructions, and returns a reason rather than a
 * bare `false`. This one stays exported and unchanged because it is published
 * and in use; it is not deprecated and it is not going away.
 *
 * `v1` is HMAC-SHA256 over `` `${t}.${body}` `` — the timestamp is bound INTO
 * the digest, which is what makes the replay window enforceable at all.
 *
 * This used to HMAC the body ALONE, so it rejected every genuine delivery the
 * platform sent: the producer has always signed `${t}.${body}` and our own
 * published documentation has always described that construction. Anyone
 * following either the SDK or the docs got a hard "invalid signature" on 100%
 * of real traffic. The wire format is unchanged — only this verifier was wrong.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const parts = new Map<string, string>();
  for (const part of input.signatureHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      parts.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }

  const rawTs = parts.get('t');
  const tag = parts.get('v1');
  if (rawTs === undefined || tag === undefined) {
    return false;
  }
  const issuedAt = Number.parseInt(rawTs, 10);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  const tolerance = input.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - issuedAt) > tolerance) {
    return false;
  }

  const hmac = createHmac('sha256', input.secret);
  hmac.update(`${rawTs}.`);
  hmac.update(typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : input.body);
  const a = Buffer.from(tag, 'hex');
  const b = Buffer.from(hmac.digest('hex'), 'hex');
  // Length check first: timingSafeEqual throws on a length mismatch, and a
  // thrown verifier is an accepted webhook in a handler that forgot try/catch.
  return a.length === b.length && timingSafeEqual(a, b);
}
