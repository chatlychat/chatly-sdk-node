/**
 * `verifyChatlySignature`, held to every one of the eight constructions.
 *
 * The surface table and the signing helpers are in
 * `test/signature-fixtures.ts`, which also records why these tests sign by
 * hand instead of importing the producer's own signer.
 *
 * ═══ WHAT EACH SURFACE IS HELD TO ═════════════════════════════════════════
 *
 * Four refusals per surface, because each catches a different real mistake:
 * the WRONG SECRET (a customer-card secret pointed at an agent delivery — the
 * commonest, since three surfaces share a header name), a TAMPERED BODY (the
 * property the signature exists for), an EXPIRED TIMESTAMP (replay), and a
 * timestamp in the WRONG UNIT (two surfaces send milliseconds; reading one as
 * seconds puts the check ~54,000 years out and rejects everything, and this
 * repo has shipped the mirror image of that bug).
 *
 * The cross-surface confusions, the legacy workflow header, the malformed
 * inputs and the published fixed vector are in `signature-surfaces.spec.ts`.
 * The unified v2 construction, the `v2` policy and key rotation are in
 * `signature-v2.spec.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  CHATLY_SIGNATURE_SURFACES,
  CHATLY_SIGNATURE_TOLERANCE_SECONDS,
  verifyChatlySignature,
  type VerifyChatlySignatureInput,
} from './signatures.js';
import {
  BODY,
  CASES,
  NOW_MS,
  NOW_SECONDS,
  OTHER_SECRET,
  SECRET,
  refused,
} from './test/signature-fixtures.js';

describe('the surface table is complete', () => {
  it('has an entry for every case under test, and a case for every entry', () => {
    /*
     * Anti-vacuity. A surface added to the union and forgotten in
     * `CHATLY_SIGNATURE_SURFACES` is an `unknown_surface` refusal at runtime
     * with a green suite, and a surface with a table entry and no case here
     * is an untested construction.
     */
    expect(CASES.map((c) => c.surface).sort()).toEqual(
      Object.keys(CHATLY_SIGNATURE_SURFACES).sort(),
    );
  });

  it('agrees with the published table on which surfaces send milliseconds', () => {
    // The unit is read off `api-external-agents.mdx`, verified against the
    // signers on 2026-10-14. Only these two send `Date.now()`.
    const ms = Object.entries(CHATLY_SIGNATURE_SURFACES)
      .filter(([, spec]) => spec.unit === 'milliseconds')
      .map(([name]) => name)
      .sort();
    expect(ms).toEqual(['canvas_step', 'customer_card']);
  });

  it('agrees that three surfaces share x-chatly-signature', () => {
    // The reason `surface` is a required argument rather than inferred.
    const sharing = Object.entries(CHATLY_SIGNATURE_SURFACES)
      .filter(([, spec]) => spec.signatureHeader === 'x-chatly-signature')
      .map(([name]) => name)
      .sort();
    expect(sharing).toEqual([
      'agent_delivery',
      'ai_tool_call',
      'customer_card',
      'workflow_webhook_legacy',
    ]);
  });
});

describe.each(CASES)('$surface', (testCase) => {
  const base = (
    headers: Record<string, string>,
    body = BODY,
    secret = SECRET,
  ): VerifyChatlySignatureInput => ({
    surface: testCase.surface,
    body,
    headers,
    secret,
    nowMs: NOW_MS,
    ...testCase.extra,
  });

  const genuine = (): Record<string, string> =>
    testCase.headersFor({ secret: SECRET, body: BODY, tsSeconds: NOW_SECONDS });

  it('accepts a genuine request', () => {
    const result = verifyChatlySignature(base(genuine()));
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
  });

  it('accepts it when the header names arrive in another case', () => {
    // Node lowercases, undici lowercases, but a hand-built proxy may not.
    const upper: Record<string, string> = {};
    for (const [k, v] of Object.entries(genuine())) {
      upper[k.toUpperCase()] = v;
    }
    expect(verifyChatlySignature(base(upper)).ok).toBe(true);
  });

  it('REJECTS the wrong secret', () => {
    const headers = testCase.headersFor({
      secret: OTHER_SECRET,
      body: BODY,
      tsSeconds: NOW_SECONDS,
    });
    const { reason, message } = refused(verifyChatlySignature(base(headers)));
    expect(reason).toBe('signature_mismatch');
    // The message has to name the commonest cause, because a secret from
    // another surface is indistinguishable from a wrong one at the digest.
    expect(message).toContain('secret');
  });

  it('REJECTS a tampered body', () => {
    const headers = genuine();
    const tampered = BODY.replace('evt_1', 'evt_2');
    expect(tampered).not.toBe(BODY);
    expect(refused(verifyChatlySignature(base(headers, tampered))).reason).toBe(
      'signature_mismatch',
    );
  });

  it('REJECTS a body that was re-serialised rather than passed raw', () => {
    // The single commonest integration mistake: `JSON.stringify(req.body)`.
    const headers = genuine();
    const reserialised = JSON.stringify(JSON.parse(BODY) as unknown, null, 2);
    expect(reserialised).not.toBe(BODY);
    expect(refused(verifyChatlySignature(base(headers, reserialised))).reason).toBe(
      'signature_mismatch',
    );
  });

  it('REJECTS a missing signature header, without throwing', () => {
    const { reason, message } = refused(verifyChatlySignature(base({})));
    expect(reason).toBe('missing_signature_header');
    expect(message).toContain(CHATLY_SIGNATURE_SURFACES[testCase.surface].signatureHeader);
  });

  it('REJECTS a duplicated signature header rather than guessing', () => {
    const headers = genuine();
    const name = CHATLY_SIGNATURE_SURFACES[testCase.surface].signatureHeader;
    const withDuplicate: Record<string, string | string[]> = {
      ...headers,
      [name]: [headers[name] ?? '', 'sha256=' + 'a'.repeat(64)],
    };
    expect(
      refused(
        verifyChatlySignature({
          ...base({}),
          headers: withDuplicate,
        }),
      ).reason,
    ).toBe('duplicate_signature_header');
  });

  it('REJECTS an empty secret', () => {
    expect(refused(verifyChatlySignature(base(genuine(), BODY, ''))).reason).toBe('missing_secret');
  });

  if (testCase.unit !== null) {
    it('REJECTS an expired timestamp', () => {
      // One second past the default window, signed correctly.
      const stale = NOW_SECONDS - (CHATLY_SIGNATURE_TOLERANCE_SECONDS + 1);
      const headers = testCase.headersFor({ secret: SECRET, body: BODY, tsSeconds: stale });
      const { reason, message } = refused(verifyChatlySignature(base(headers)));
      expect(reason).toBe('timestamp_outside_tolerance');
      expect(message).toContain('tolerance');
    });

    it('accepts a stale timestamp when the tolerance is widened deliberately', () => {
      const stale = NOW_SECONDS - 86_400;
      const headers = testCase.headersFor({ secret: SECRET, body: BODY, tsSeconds: stale });
      expect(
        verifyChatlySignature({ ...base(headers), toleranceSeconds: Number.POSITIVE_INFINITY }).ok,
      ).toBe(true);
    });

    it('REJECTS a timestamp in the WRONG UNIT, and says so', () => {
      /*
       * The 54,000-year bug, in whichever direction this surface can have
       * it. A seconds surface fed milliseconds, or a milliseconds surface fed
       * seconds: the signature is computed correctly over whatever string was
       * sent, so only the tolerance check can catch it — which is why the
       * message has to name the unit rather than just saying "expired".
       */
      const spec = CHATLY_SIGNATURE_SURFACES[testCase.surface];
      const wrongUnitSeconds =
        spec.unit === 'milliseconds'
          ? // Milliseconds surface sent a SECONDS value: ts = 1.76e9 ms = 1970.
            NOW_SECONDS / 1000
          : // Seconds surface sent a MILLISECONDS value: t = 1.76e12 s.
            NOW_SECONDS * 1000;
      const headers = testCase.headersFor({
        secret: SECRET,
        body: BODY,
        tsSeconds: wrongUnitSeconds,
      });
      const { reason, message } = refused(verifyChatlySignature(base(headers)));
      expect(reason).toBe('timestamp_outside_tolerance');
      expect(message).toContain('wrong UNIT');
      expect(message).toContain(spec.unit === 'milliseconds' ? 'milliseconds' : 'seconds');
    });

    it('REJECTS a non-numeric timestamp, without throwing', () => {
      const headers = genuine();
      const spec = CHATLY_SIGNATURE_SURFACES[testCase.surface];
      const mangled: Record<string, string> = { ...headers };
      if (spec.timestampFrom === 'in-signature') {
        const value = headers[spec.signatureHeader] ?? '';
        mangled[spec.signatureHeader] = value.replace(/t=\d+/, 't=yesterday');
      } else if (spec.timestampFrom !== null) {
        mangled[spec.timestampFrom] = 'yesterday';
      }
      const result = verifyChatlySignature(base(mangled));
      expect(result.ok).toBe(false);
      expect(refused(result).reason).toBe('malformed_timestamp');
    });
  }
});
