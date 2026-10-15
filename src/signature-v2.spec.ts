/**
 * The unified v2 construction, the `v2` policy, and key rotation.
 *
 * ═══ WHAT THESE HOLD THE VERIFIER TO ══════════════════════════════════════
 *
 * The per-surface table-driven tests are in `signatures.spec.ts` and the
 * cross-surface confusions are in `signature-surfaces.spec.ts`. This file is
 * the three things C-02 added:
 *
 *  1. **`unified_v2`** — `x-chatly-signature-v2: t=…,v1=…` over
 *     `<t>.<METHOD>.<path>.<rawBody>`. Asserted against a signature built by
 *     hand from a known secret and body, then held to a mutation of ONE BYTE
 *     of the body, ONE CHARACTER of the digest, the method, the path, and a
 *     timestamp outside tolerance in BOTH directions. A verifier test that
 *     checks only the happy path is the one that lets a wrong verifier ship —
 *     an HMAC over a constant prefix passes a happy-path test.
 *
 *  2. **The `v2` policy** — how a receiver crosses the migration while
 *     senders still emit the legacy header beside the new one.
 *
 *  3. **Rotation**, in both directions: a receiver holding two secrets, and a
 *     sender sending two `v1=` digests.
 *
 * Everything here signs by hand — see `test/signature-fixtures.ts` for why
 * that is not laziness.
 */
import { describe, expect, it } from 'vitest';

import {
  CHATLY_SIGNATURE_TOLERANCE_SECONDS,
  verifyChatlySignature,
  type VerifyChatlySignatureInput,
} from './signatures.js';
import {
  BODY,
  NOW_MS,
  NOW_SECONDS,
  OTHER_SECRET,
  SECRET,
  V2_METHOD,
  V2_PATH,
  hmac,
  refused,
  v2Base,
  v2Header,
} from './test/signature-fixtures.js';

/** A genuine unified-v2 request, and the input that verifies it. */
function v2Request(
  over: Partial<VerifyChatlySignatureInput> = {},
  headerOver: { secret?: string; body?: string; tsSeconds?: number } = {},
): VerifyChatlySignatureInput {
  const tsSeconds = headerOver.tsSeconds ?? NOW_SECONDS;
  return {
    surface: 'unified_v2',
    body: BODY,
    headers: {
      'x-chatly-signature-v2': v2Header({
        secret: headerOver.secret ?? SECRET,
        body: headerOver.body ?? BODY,
        tsSeconds,
      }),
    },
    secret: SECRET,
    method: V2_METHOD,
    path: V2_PATH,
    nowMs: NOW_MS,
    ...over,
  };
}

describe('unified_v2 — the construction', () => {
  it('accepts a signature built over <t>.<METHOD>.<path>.<rawBody>', () => {
    const result = verifyChatlySignature(v2Request());
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    if (result.ok) {
      expect(result.base).toBe('target');
      expect(result.timestampMs).toBe(NOW_MS);
      expect(result.secretIndex).toBe(0);
    }
  });

  it('is NOT an HMAC over the body alone, or over <t>.<body>', () => {
    /*
     * The two wrong constructions a hand-written signer actually produces.
     * Both would pass a happy-path test written against the signer itself.
     */
    const t = String(NOW_SECONDS);
    for (const wrong of [hmac(SECRET, BODY), hmac(SECRET, `${t}.${BODY}`)]) {
      expect(
        verifyChatlySignature(
          v2Request({ headers: { 'x-chatly-signature-v2': `t=${t},v1=${wrong}` } }),
        ).ok,
      ).toBe(false);
    }
  });

  it('REJECTS one byte changed in the body', () => {
    // One character, same length, still valid JSON: `evt_1` becomes `evt_2`.
    const at = BODY.indexOf('evt_1') + 4;
    const tampered = `${BODY.slice(0, at)}2${BODY.slice(at + 1)}`;
    expect(tampered).not.toBe(BODY);
    expect(tampered.length).toBe(BODY.length);
    expect(refused(verifyChatlySignature(v2Request({ body: tampered }))).reason).toBe(
      'signature_mismatch',
    );
  });

  it('REJECTS one character changed in the digest', () => {
    const genuine = v2Header({ secret: SECRET, body: BODY, tsSeconds: NOW_SECONDS });
    const last = genuine.slice(-1);
    const flipped = `${genuine.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
    expect(flipped).not.toBe(genuine);
    expect(
      refused(verifyChatlySignature(v2Request({ headers: { 'x-chatly-signature-v2': flipped } })))
        .reason,
    ).toBe('signature_mismatch');
  });

  it('REJECTS a body that was parsed and re-serialised rather than passed raw', () => {
    // The commonest integration mistake, and the one the raw-bytes contract
    // exists for: the same OBJECT, different bytes.
    const reserialised = JSON.stringify(JSON.parse(BODY) as unknown, null, 2);
    expect(reserialised).not.toBe(BODY);
    expect(verifyChatlySignature(v2Request({ body: reserialised })).ok).toBe(false);
  });

  it('REJECTS a different METHOD on the same path', () => {
    // One `/returns/{id}` route treating GET as a read and DELETE as a
    // cancellation must not accept the other's signature.
    expect(verifyChatlySignature(v2Request({ method: 'DELETE' })).ok).toBe(false);
  });

  it('REJECTS the path with its query string dropped', () => {
    expect(V2_PATH).toContain('?');
    const bare = V2_PATH.slice(0, V2_PATH.indexOf('?'));
    expect(verifyChatlySignature(v2Request({ path: bare })).ok).toBe(false);
  });

  it('normalises the method case but not the path case', () => {
    expect(verifyChatlySignature(v2Request({ method: V2_METHOD.toLowerCase() })).ok).toBe(true);
    expect(verifyChatlySignature(v2Request({ path: V2_PATH.toUpperCase() })).ok).toBe(false);
  });

  it('REJECTS a stale timestamp and says it is in the past', () => {
    const stale = NOW_SECONDS - (CHATLY_SIGNATURE_TOLERANCE_SECONDS + 1);
    const { reason, message } = refused(verifyChatlySignature(v2Request({}, { tsSeconds: stale })));
    expect(reason).toBe('timestamp_outside_tolerance');
    expect(message).toContain('in the past');
  });

  it('REJECTS a FAR-FUTURE timestamp and says so', () => {
    /*
     * The half a one-sided `now - t > tolerance` check misses. Without it a
     * sender (or an attacker with a captured body and a freshened `t` it
     * cannot re-sign — or a sender whose clock is a year ahead) gets an
     * unbounded window.
     */
    const ahead = NOW_SECONDS + CHATLY_SIGNATURE_TOLERANCE_SECONDS + 1;
    const { reason, message } = refused(verifyChatlySignature(v2Request({}, { tsSeconds: ahead })));
    expect(reason).toBe('timestamp_outside_tolerance');
    expect(message).toContain('FUTURE');
  });

  it('accepts the edges of the window exactly', () => {
    for (const ts of [
      NOW_SECONDS - CHATLY_SIGNATURE_TOLERANCE_SECONDS,
      NOW_SECONDS + CHATLY_SIGNATURE_TOLERANCE_SECONDS,
    ]) {
      expect(verifyChatlySignature(v2Request({}, { tsSeconds: ts })).ok).toBe(true);
    }
  });

  it('REJECTS a missing method or path rather than signing an empty target', () => {
    for (const over of [{ method: undefined }, { path: undefined }, { method: '', path: '' }]) {
      const { reason, message } = refused(verifyChatlySignature(v2Request(over)));
      expect(reason).toBe('missing_request_target');
      expect(message).toContain('pathname');
    }
  });

  it('REJECTS the wrong secret', () => {
    expect(refused(verifyChatlySignature(v2Request({}, { secret: OTHER_SECRET }))).reason).toBe(
      'signature_mismatch',
    );
  });
});

describe('key rotation', () => {
  it('accepts either of two secrets a RECEIVER holds, and says which', () => {
    const signedWithNew = v2Request({ secret: [OTHER_SECRET, SECRET] });
    const result = verifyChatlySignature(signedWithNew);
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    if (result.ok) {
      // The index is the point: it is how an operator learns the old secret
      // is no longer in use and can be dropped.
      expect(result.secretIndex).toBe(1);
    }
  });

  it('reports index 0 when the first secret is the one that verified', () => {
    const result = verifyChatlySignature(v2Request({ secret: [SECRET, OTHER_SECRET] }));
    expect(result.ok && result.secretIndex).toBe(0);
  });

  it('REJECTS when none of the receiver’s secrets matches, and says how many it tried', () => {
    const { reason, message } = refused(
      verifyChatlySignature(v2Request({ secret: [OTHER_SECRET, 'whsec_third'] })),
    );
    expect(reason).toBe('signature_mismatch');
    expect(message).toContain('2 secrets');
  });

  it('treats an empty or all-empty secret list as no secret at all', () => {
    for (const secret of [[], [''], '']) {
      expect(refused(verifyChatlySignature(v2Request({ secret }))).reason).toBe('missing_secret');
    }
  });

  it('accepts a v1 LIST from a SENDER mid-rotation, in either position', () => {
    const t = String(NOW_SECONDS);
    const good = hmac(SECRET, v2Base({ tsSeconds: NOW_SECONDS, body: BODY }));
    const stale = hmac(OTHER_SECRET, v2Base({ tsSeconds: NOW_SECONDS, body: BODY }));
    for (const header of [`t=${t},v1=${stale},v1=${good}`, `t=${t},v1=${good},v1=${stale}`]) {
      const result = verifyChatlySignature(
        v2Request({ headers: { 'x-chatly-signature-v2': header } }),
      );
      expect(result.ok, result.ok ? '' : result.message).toBe(true);
    }
  });

  it('REJECTS a v1 list where nothing matches', () => {
    const t = String(NOW_SECONDS);
    const a = hmac(OTHER_SECRET, v2Base({ tsSeconds: NOW_SECONDS, body: BODY }));
    const b = hmac('whsec_third', v2Base({ tsSeconds: NOW_SECONDS, body: BODY }));
    expect(
      refused(
        verifyChatlySignature(
          v2Request({ headers: { 'x-chatly-signature-v2': `t=${t},v1=${a},v1=${b}` } }),
        ),
      ).reason,
    ).toBe('signature_mismatch');
  });

  it('REJECTS a list with a malformed member rather than quietly using the rest', () => {
    /*
     * A truncated digest beside a good one is a sender bug, and accepting the
     * request hides it. `Buffer.from('zz', 'hex')` returns a SHORT buffer
     * rather than failing, so a shape check is the only thing between a
     * garbage digest and a length-mismatch reported as "wrong signature".
     */
    const t = String(NOW_SECONDS);
    const good = hmac(SECRET, v2Base({ tsSeconds: NOW_SECONDS, body: BODY }));
    const { reason, message } = refused(
      verifyChatlySignature(
        v2Request({ headers: { 'x-chatly-signature-v2': `t=${t},v1=zz,v1=${good}` } }),
      ),
    );
    expect(reason).toBe('malformed_signature_header');
    expect(message).toContain('2 v1 values');
  });

  it('keeps the FIRST t when a crafted second one is appended', () => {
    // Otherwise an attacker replays a captured body with a fresh `t` by
    // appending one, and the window check reads the new one while the digest
    // was taken over the old.
    const t = String(NOW_SECONDS);
    const fresh = String(NOW_SECONDS + 10_000);
    const good = hmac(SECRET, v2Base({ tsSeconds: NOW_SECONDS, body: BODY }));
    const result = verifyChatlySignature(
      v2Request({ headers: { 'x-chatly-signature-v2': `t=${t},v1=${good},t=${fresh}` } }),
    );
    expect(result.ok && result.timestampMs).toBe(NOW_MS);
  });
});

describe('the v2 policy, surface by surface', () => {
  /** A customer-card request as it will arrive mid-migration: both headers. */
  function cardRequest(opts: { v2?: string; legacyOk?: boolean } = {}): VerifyChatlySignatureInput {
    const ts = String(NOW_MS);
    const legacySecret = opts.legacyOk === false ? OTHER_SECRET : SECRET;
    return {
      surface: 'customer_card',
      body: BODY,
      headers: {
        'x-chatly-timestamp': ts,
        'x-chatly-signature': `sha256=${hmac(legacySecret, `${ts}.${BODY}`)}`,
        ...(opts.v2 === undefined ? {} : { 'x-chatly-signature-v2': opts.v2 }),
      },
      secret: SECRET,
      nowMs: NOW_MS,
    };
  }

  const goodV2 = (): string => v2Header({ secret: SECRET, body: BODY, tsSeconds: NOW_SECONDS });

  it('verifies the LEGACY construction while no v2 header is sent', () => {
    const result = verifyChatlySignature({ ...cardRequest(), method: 'POST', path: '/cards' });
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    if (result.ok) {
      expect(result.surface).toBe('customer_card');
      expect(result.base).toBe('body');
    }
  });

  it('PREFERS v2 the moment the sender starts emitting it, with no code change', () => {
    /*
     * The whole point of the default. The receiver already passes its method
     * and path; the day the sender adds the header, this request verifies
     * under the stronger construction and says so.
     */
    const result = verifyChatlySignature({
      ...cardRequest({ v2: goodV2() }),
      method: V2_METHOD,
      path: V2_PATH,
    });
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    expect(result.ok && result.surface).toBe('unified_v2');
  });

  it('does NOT fall back to the legacy header when a present v2 does not verify', () => {
    const bad = `t=${String(NOW_SECONDS)},v1=${'a'.repeat(64)}`;
    const { reason, message } = refused(
      verifyChatlySignature({
        ...cardRequest({ v2: bad }),
        method: V2_METHOD,
        path: V2_PATH,
      }),
    );
    expect(reason).toBe('signature_mismatch');
    // And it says how to get the old behaviour, because the alternative is a
    // support ticket that reads "it worked yesterday".
    expect(message).toContain('x-chatly-signature-v2');
    expect(message).toContain('v2: "ignore"');
  });

  it('falls back to the legacy header when v2 is present but no target was supplied', () => {
    // A receiver that cannot give a method and path is not broken by the
    // sender's upgrade; it simply keeps verifying what it could before.
    const result = verifyChatlySignature(cardRequest({ v2: goodV2() }));
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    expect(result.ok && result.surface).toBe('customer_card');
  });

  it('v2: "ignore" verifies the legacy header even when a WRONG v2 is present', () => {
    const bad = `t=${String(NOW_SECONDS)},v1=${'a'.repeat(64)}`;
    const result = verifyChatlySignature({
      ...cardRequest({ v2: bad }),
      method: V2_METHOD,
      path: V2_PATH,
      v2: 'ignore',
    });
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
  });

  it('v2: "require" refuses a request that carries only the legacy header', () => {
    const { reason, message } = refused(
      verifyChatlySignature({
        ...cardRequest(),
        method: V2_METHOD,
        path: V2_PATH,
        v2: 'require',
      }),
    );
    expect(reason).toBe('missing_signature_header');
    expect(message).toContain('x-chatly-signature-v2');
  });

  it('v2: "require" refuses when it has no method and path to verify with', () => {
    const { reason } = refused(
      verifyChatlySignature({ ...cardRequest({ v2: goodV2() }), v2: 'require' }),
    );
    expect(reason).toBe('missing_request_target');
  });
});

describe('workflow_webhook — the one header that carries two bases', () => {
  const t = String(NOW_SECONDS);
  const bodyBase = (): string => `t=${t},v1=${hmac(SECRET, `${t}.${BODY}`)}`;
  const targetBase = (): string => v2Header({ secret: SECRET, body: BODY, tsSeconds: NOW_SECONDS });

  const input = (header: string, over: Partial<VerifyChatlySignatureInput> = {}) => ({
    surface: 'workflow_webhook' as const,
    body: BODY,
    headers: { 'x-chatly-signature-v2': header },
    secret: SECRET,
    nowMs: NOW_MS,
    ...over,
  });

  it("accepts TODAY's sender, which signs <t>.<body>", () => {
    const result = verifyChatlySignature(input(bodyBase()));
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    expect(result.ok && result.base).toBe('body');
  });

  it("accepts TOMORROW's sender on the same header, which signs the unified base", () => {
    /*
     * `signWorkflowWebhook` already sends `x-chatly-signature-v2` over
     * `<t>.<body>` — it predates the unified base. When apps/api moves it,
     * the header name does not change, so a receiver cannot tell the two
     * apart. Accepting both, whenever the receiver supplies a method and a
     * path, is what makes that switch invisible.
     */
    const result = verifyChatlySignature(input(targetBase(), { method: V2_METHOD, path: V2_PATH }));
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    expect(result.ok && result.base).toBe('target');
  });

  it('accepts only the body base when no method and path are supplied', () => {
    expect(verifyChatlySignature(input(targetBase())).ok).toBe(false);
    expect(verifyChatlySignature(input(bodyBase())).ok).toBe(true);
  });

  it('v2: "require" accepts the unified base and refuses the body base', () => {
    const strict = { method: V2_METHOD, path: V2_PATH, v2: 'require' as const };
    expect(verifyChatlySignature(input(targetBase(), strict)).ok).toBe(true);
    expect(refused(verifyChatlySignature(input(bodyBase(), strict))).reason).toBe(
      'signature_mismatch',
    );
  });

  it('v2: "ignore" accepts the body base and refuses the unified one', () => {
    const loose = { method: V2_METHOD, path: V2_PATH, v2: 'ignore' as const };
    expect(verifyChatlySignature(input(bodyBase(), loose)).ok).toBe(true);
    expect(verifyChatlySignature(input(targetBase(), loose)).ok).toBe(false);
  });
});
