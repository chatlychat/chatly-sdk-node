/**
 * The two caller-error shapes `verifyChatlySignature` must not throw on.
 *
 * `signatures.ts` has always claimed this invariant — the docblock on
 * `secretsFrom` says the function "must never throw: a plain-JavaScript caller
 * passing `undefined` … has to come back as `missing_secret` rather than a
 * `TypeError` out of somebody's webhook handler". It was enforced for
 * `secret` alone. Measured on 2026-10-16, FOUR shapes threw:
 *
 *   headers: undefined          → TypeError from Object.entries
 *   headers: null               → TypeError from Object.entries
 *   body: undefined             → ERR_INVALID_ARG_TYPE from Buffer.from
 *   body: a parsed object       → ERR_INVALID_ARG_TYPE from Buffer.from
 *
 * The last one is not an exotic input — it is what `req.body` IS under
 * `express.json()`, the default in most Node apps, and it is the mistake the
 * raw-body documentation exists to prevent. So the case an integrator is most
 * likely to hit answered with a stack trace from inside this library instead
 * of a reason code naming the cause. TypeScript rejects all four, which is why
 * no test and no port ever saw them; plain JavaScript does not.
 *
 * Both verdicts fail CLOSED. A parsed body cannot be turned back into the
 * bytes that were signed — key order and whitespace are gone — so there is
 * nothing to verify and `signature_mismatch` is the honest answer. The MESSAGE
 * names the likely cause, and message wording is each SDK's own (the
 * cross-SDK corpus compares `reason`), so this adds no reason code and
 * nothing to port.
 *
 * Split out of `signatures.ts` when it crossed the repo's 650-line ceiling.
 * An honest seam rather than a convenient one: everything here is about what
 * the CALLER handed over, and none of it looks at a signature.
 */
import type { ChatlySignatureFailure } from './signature-table.js';

/** What the caller got wrong, or null when the inputs are usable. */
export interface CallerInputProblem {
  readonly reason: ChatlySignatureFailure;
  readonly message: string;
}

export function callerInputProblem(input: {
  readonly headers: unknown;
  readonly body: unknown;
}): CallerInputProblem | null {
  if (input.headers === null || typeof input.headers !== 'object') {
    return {
      reason: 'missing_signature_header',
      message:
        "No headers given. Pass the request's own header map; verifyChatlySignature " +
        'reads the signature out of it.',
    };
  }
  /*
   * `ArrayBuffer.isView`, not `Buffer.isBuffer`. The declared type is
   * `string | Uint8Array`, and `Buffer.isBuffer(new Uint8Array())` is FALSE —
   * a Buffer is a Uint8Array subclass, not the other way round. The first
   * version of this guard used `isBuffer` and refused a plain `Uint8Array`,
   * which is a documented, supported body with its own case in
   * `signature-surfaces.spec.ts`. That spec caught it on the first run, which
   * is the argument for a guard arriving together with its tests.
   */
  if (typeof input.body !== 'string' && !ArrayBuffer.isView(input.body)) {
    const got =
      input.body === undefined || input.body === null ? String(input.body) : typeof input.body;
    return {
      reason: 'signature_mismatch',
      message:
        `\`body\` must be the RAW request body as a string or Uint8Array, not a ${got}. ` +
        'A parsed body (for example `req.body` under `express.json()`) cannot verify: the ' +
        'signature covers the exact bytes Chatly sent, and parsing has already lost the key ' +
        'order and whitespace. Capture the raw body — `express.raw({ type: "*/*" })`, ' +
        "Fastify's `rawBody`, or `await request.text()` in a route handler.",
    };
  }
  return null;
}
