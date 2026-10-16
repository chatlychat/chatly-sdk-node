/**
 * `verifyChatlySignature` never throws — including on the four caller shapes
 * that TypeScript rejects and plain JavaScript does not.
 *
 * `signatures.ts` has always claimed this invariant, in the docblock on
 * `secretsFrom`, with the reason spelled out: a `TypeError` out of somebody's
 * webhook handler is not an acceptable answer. It was enforced for `secret`
 * only. Measured on 2026-10-16, `headers: undefined`, `headers: null`,
 * `body: undefined` and a PARSED OBJECT body all threw.
 *
 * The parsed-object case is the one that matters: that is exactly what
 * `req.body` is under `express.json()`, the default in most Node apps, and
 * it is the mistake the raw-body documentation exists to prevent. The person
 * most likely to hit it was the person least equipped to read the stack
 * trace, since it came from inside our `Buffer.from`.
 *
 * Every case below fails CLOSED. There is no input here that should verify —
 * a parsed body has already lost the bytes the signature covers — so the
 * tests assert both halves: not thrown, and not accepted.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyChatlySignature } from './signatures.js';

const SECRET = 'whsec_caller_input';
const BODY = '{"a":1}';

/** A genuinely valid header, so nothing short-circuits before the guards. */
function validHeaders(): Record<string, string> {
  const t = Math.floor(Date.now() / 1000);
  const mac = createHmac('sha256', SECRET)
    .update(`${String(t)}.${BODY}`)
    .digest('hex');
  return { 'x-chatly-signature': `t=${String(t)},v1=${mac}` };
}

describe('caller-error inputs are reported, never thrown', () => {
  it('verifies the control, so the cases below fail for their own reason', () => {
    const r = verifyChatlySignature({
      surface: 'agent_delivery',
      body: BODY,
      headers: validHeaders(),
      secret: SECRET,
    });
    expect(r.ok).toBe(true);
  });

  /*
   * `as never` on each: these are the shapes TypeScript already refuses, and
   * casting is the only way to exercise the plain-JavaScript caller this
   * guard exists for. A test that passed a well-typed value would be testing
   * nothing.
   */
  const cases: ReadonlyArray<readonly [string, unknown, unknown, string]> = [
    ['headers undefined', BODY, undefined, 'missing_signature_header'],
    ['headers null', BODY, null, 'missing_signature_header'],
    ['body undefined', undefined, 'valid', 'signature_mismatch'],
    ['body null', null, 'valid', 'signature_mismatch'],
    ['body a parsed object — express.json()', { a: 1 }, 'valid', 'signature_mismatch'],
    ['body a number', 42, 'valid', 'signature_mismatch'],
  ];

  for (const [label, body, headers, reason] of cases) {
    it(`${label}: reports ${reason} instead of throwing`, () => {
      const call = (): ReturnType<typeof verifyChatlySignature> =>
        verifyChatlySignature({
          surface: 'agent_delivery',
          body: body as never,
          headers: (headers === 'valid' ? validHeaders() : headers) as never,
          secret: SECRET,
        });
      expect(call).not.toThrow();
      const r = call();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe(reason);
        // The message has to name the cause: the whole point is that the
        // caller can tell a bug in their wiring from a bad signature.
        expect(r.message.length).toBeGreaterThan(20);
      }
    });
  }

  /*
   * The guard's own regression. The first version used `Buffer.isBuffer`,
   * which is FALSE for a plain `Uint8Array` — a Buffer is a Uint8Array
   * subclass, not the reverse — so it refused a supported body shape. A
   * guard is only as good as the line between what it rejects and what it
   * must let through, and this is that line.
   */
  it('still accepts the byte-array bodies that are legitimate', () => {
    for (const [label, body] of [
      ['Buffer', Buffer.from(BODY, 'utf8')],
      ['Uint8Array', new Uint8Array(Buffer.from(BODY, 'utf8'))],
    ] as ReadonlyArray<readonly [string, Uint8Array]>) {
      const r = verifyChatlySignature({
        surface: 'agent_delivery',
        body,
        headers: validHeaders(),
        secret: SECRET,
      });
      expect(r.ok, `${label} should verify${r.ok ? '' : `: ${r.message}`}`).toBe(true);
    }
  });

  it('names the raw body in the message, since that is the fix', () => {
    const r = verifyChatlySignature({
      surface: 'agent_delivery',
      body: { a: 1 } as never,
      headers: validHeaders(),
      secret: SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/raw/i);
      expect(r.message).toMatch(/express\.raw|request\.text|rawBody/);
    }
  });
});
