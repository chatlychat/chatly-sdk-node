/**
 * Reading the raw material: a header value, a `t=…,v1=…` value, a secret list.
 *
 * ═══ WHY THIS IS A REAL SEAM ══════════════════════════════════════════════
 *
 * Three total functions over untrusted input, and the line between them and
 * `signatures.ts` is sharp in two directions at once:
 *
 *   - **Nothing here knows what a surface is.** No function below reads
 *     `CHATLY_SIGNATURE_SURFACES`, a base string, a `v2` policy or a
 *     tolerance. They are handed bytes that arrived from the network and
 *     return plain data — a list of strings, a parsed record or `null`. Every
 *     decision stays on the other side of the import.
 *   - **Nothing here returns a VERDICT.** That is what separates this file
 *     from its sibling `signature-caller-input.ts`, which looks at the same
 *     untrusted input and answers with a `reason` and a `message`. A parser
 *     that cannot refuse cannot disagree with the verifier about why
 *     something failed, so `VerifyChatlySignatureResult` is not imported here
 *     and `fail()` deliberately stayed behind.
 *
 * The shared invariant is the one `verifyChatlySignature` is built on and
 * CONTRACT.md §6 demands: never throw. A plain-JavaScript caller passing
 * `undefined`, a duplicated header, an array with a hole in it, a value that
 * is not a string — each has to come back as data the verifier can refuse,
 * not as a `TypeError` out of somebody's webhook handler. Keeping all three
 * in one file is what makes that invariant reviewable in one place.
 *
 * Sixth split out of `signatures.ts` for the repo's 650-line ceiling, after
 * `signature-table.ts`, `signature-mint.ts`, `signature-caller-input.ts`,
 * `signature-message.ts` and `signature-verify-types.ts`. Nothing here is
 * exported from the package entry point — it is internal to the verifier, and
 * `signatures.ts` is the only importer.
 */
import type { ChatlyHeaders } from './signature-table.js';

/** 64 lowercase-or-uppercase hex characters and nothing else. */
export const HEX_SHA256 = /^[0-9a-fA-F]{64}$/;

export function headerValue(headers: ChatlyHeaders, name: string): string[] {
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

/**
 * Parse a `t=…,v1=…[,b=…]` value, collecting EVERY `v1`.
 *
 * Tolerates spaces and extra fields — a future `v3` field must not break a
 * `v1` verifier, which is the whole point of the prefix — and keeps the
 * FIRST `t` and the FIRST `b`, so a crafted second one cannot move the
 * window or the base.
 */
export function parseTv1(raw: string): { t: string; v1: string[]; b: string | undefined } | null {
  let t: string | undefined;
  let b: string | undefined;
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
    } else if (key === 'b') {
      b ??= value;
    } else if (key === 'v1') {
      v1.push(value);
    }
  }
  if (t === undefined || v1.length === 0) {
    return null;
  }
  return { t, v1, b };
}

/**
 * Every non-empty secret the caller handed over, in order.
 *
 * Defensive about what it is given because this function must never throw: a
 * plain-JavaScript caller passing `undefined`, or an array with a hole in it,
 * has to come back as `missing_secret` rather than a `TypeError` out of
 * somebody's webhook handler.
 */
export function secretsFrom(
  secret: string | readonly string[],
): { value: string; index: number }[] {
  const list: readonly unknown[] =
    typeof secret === 'string' ? [secret] : Array.isArray(secret) ? (secret as unknown[]) : [];
  // The CALLER's index survives the filter (`['', s]` reported 0).
  return list.flatMap((value, index) =>
    typeof value === 'string' && value.length > 0 ? [{ value, index }] : [],
  );
}
