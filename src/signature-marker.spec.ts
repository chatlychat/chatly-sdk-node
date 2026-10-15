/**
 * The `b=` base marker on `x-chatly-signature-v2`, as the verifier reads it.
 *
 * Its own file rather than a block in `signature-v2.spec.ts` (650-line
 * ceiling). Every digest is built by hand from a literal base string — see
 * `test/signature-fixtures.ts` for why nothing here signs with the code under
 * test.
 *
 * The rules these pin:
 *   - the marker NARROWS what a surface accepts and never widens it
 *   - an ABSENT marker changes nothing, because every v2 value sent before
 *     the marker existed is absent
 *   - the first `b` wins, like the first `t`
 *   - a marker that rules every candidate out is refused with a message that
 *     names the surface that would accept it
 */
import { describe, expect, it } from 'vitest';

import { verifyChatlySignature, type VerifyChatlySignatureInput } from './signatures.js';
import {
  BODY,
  NOW_MS,
  NOW_SECONDS,
  SECRET,
  V2_METHOD,
  V2_PATH,
  hmac,
  refused,
} from './test/signature-fixtures.js';

const t = String(NOW_SECONDS);
const bodyDigest = hmac(SECRET, `${t}.${BODY}`);
const targetDigest = hmac(SECRET, `${t}.${V2_METHOD}.${V2_PATH}.${BODY}`);
const target = { method: V2_METHOD, path: V2_PATH };

const req = (
  surface: 'workflow_webhook' | 'unified_v2',
  value: string,
  over: Partial<VerifyChatlySignatureInput> = {},
): VerifyChatlySignatureInput => ({
  surface,
  body: BODY,
  headers: { 'x-chatly-signature-v2': value },
  secret: SECRET,
  nowMs: NOW_MS,
  ...over,
});

describe('workflow_webhook reads the marker', () => {
  it('b=t with no method/path is missing_request_target, not a mismatch', () => {
    // The day the workflow sender moves to b=t, a receiver that never passed
    // method/path must be told WHAT to pass — not sent hunting their secret.
    const { reason, message } = refused(
      verifyChatlySignature(req('workflow_webhook', `t=${t},v1=${targetDigest},b=t`)),
    );
    expect(reason).toBe('missing_request_target');
    expect(message).toContain('path');
  });

  it('b=t with method/path verifies the target base', () => {
    const result = verifyChatlySignature(
      req('workflow_webhook', `t=${t},v1=${targetDigest},b=t`, target),
    );
    expect(result.ok && result.base).toBe('target');
  });

  it('b=b narrows to the body base: a target digest marked b=b is refused', () => {
    expect(
      verifyChatlySignature(req('workflow_webhook', `t=${t},v1=${bodyDigest},b=b`, target)).ok,
    ).toBe(true);
    expect(
      verifyChatlySignature(req('workflow_webhook', `t=${t},v1=${targetDigest},b=b`, target)).ok,
    ).toBe(false);
  });

  it('b=b under v2: "require" names the marker in the refusal', () => {
    const { reason, message } = refused(
      verifyChatlySignature(
        req('workflow_webhook', `t=${t},v1=${bodyDigest},b=b`, { ...target, v2: 'require' }),
      ),
    );
    expect(reason).toBe('signature_mismatch');
    expect(message).toContain('b=b');
  });

  it('an ABSENT marker keeps the behaviour it had: body, and target when given one', () => {
    expect(verifyChatlySignature(req('workflow_webhook', `t=${t},v1=${bodyDigest}`)).ok).toBe(true);
    expect(
      verifyChatlySignature(req('workflow_webhook', `t=${t},v1=${targetDigest}`, target)).ok,
    ).toBe(true);
  });

  it('keeps the FIRST b, so an appended b=b cannot move a b=t value', () => {
    const result = verifyChatlySignature(
      req('workflow_webhook', `t=${t},v1=${targetDigest},b=t,b=b`),
    );
    expect(refused(result).reason).toBe('missing_request_target');
  });
});

describe('unified_v2 reads the marker', () => {
  it('b=b is refused, and the refusal names workflow_webhook', () => {
    const { reason, message } = refused(
      verifyChatlySignature(req('unified_v2', `t=${t},v1=${bodyDigest},b=b`, target)),
    );
    expect(reason).toBe('signature_mismatch');
    expect(message).toContain('workflow_webhook');
  });

  it('a forged b=t cannot make a body digest verify', () => {
    expect(verifyChatlySignature(req('unified_v2', `t=${t},v1=${bodyDigest},b=t`, target)).ok).toBe(
      false,
    );
  });

  it('an absent marker still verifies the target base, as it did before the marker', () => {
    expect(verifyChatlySignature(req('unified_v2', `t=${t},v1=${targetDigest}`, target)).ok).toBe(
      true,
    );
  });
});

describe('the three surfaces that now send v2 beside their legacy header', () => {
  /*
   * The request shapes the API sends as of this change: the legacy header
   * byte-for-byte as before, and `x-chatly-signature-v2: …,b=t` beside it,
   * from ONE instant — milliseconds in the legacy header, seconds in v2.
   */
  const ms = String(NOW_MS + 789);
  const v2 = `t=${t},v1=${targetDigest},b=t`;
  const shapes = [
    {
      surface: 'customer_card' as const,
      headers: {
        'x-chatly-timestamp': ms,
        'x-chatly-signature': `sha256=${hmac(SECRET, `${ms}.${BODY}`)}`,
        'x-chatly-signature-v2': v2,
      },
    },
    {
      surface: 'canvas_step' as const,
      headers: {
        'x-chatly-canvas-ts': ms,
        'x-chatly-canvas-signature': `sha256=${hmac(SECRET, `${ms}.${BODY}`)}`,
        'x-chatly-signature-v2': v2,
      },
    },
    {
      surface: 'ai_tool_call' as const,
      headers: {
        'x-chatly-signature': `t=${t},v1=${targetDigest}`,
        'x-chatly-signature-v2': v2,
      },
    },
  ];

  for (const { surface, headers } of shapes) {
    it(`${surface}: verifies as unified_v2, as its own surface, and with v2 ignored`, () => {
      const base = { body: BODY, headers, secret: SECRET, nowMs: NOW_MS, ...target };
      const asUnified = verifyChatlySignature({ ...base, surface: 'unified_v2' });
      const preferred = verifyChatlySignature({ ...base, surface });
      const legacy = verifyChatlySignature({ ...base, surface, v2: 'ignore' });
      expect(asUnified.ok && asUnified.surface).toBe('unified_v2');
      // `prefer` (the default) picks the v2 header when method/path are given.
      expect(preferred.ok && preferred.surface).toBe('unified_v2');
      expect(legacy.ok && legacy.surface).toBe(surface);
    });
  }
});

describe('a tolerance that is not a number', () => {
  it('NaN refuses instead of switching the freshness check off', () => {
    // `drift > NaN` is false, so a `parseInt(process.env.X)` of an unset var
    // used to accept a request signed a year ago. Not in the cross-SDK corpus
    // because JSON has no NaN.
    const result = verifyChatlySignature({
      ...req('workflow_webhook', `t=${t},v1=${bodyDigest}`),
      toleranceSeconds: Number.NaN,
      nowMs: NOW_MS + 365 * 24 * 60 * 60 * 1000,
    });
    expect(refused(result).reason).toBe('timestamp_outside_tolerance');
  });

  it('Infinity still disables it, which is the documented archive escape hatch', () => {
    const result = verifyChatlySignature({
      ...req('workflow_webhook', `t=${t},v1=${bodyDigest}`),
      toleranceSeconds: Number.POSITIVE_INFINITY,
      nowMs: NOW_MS + 365 * 24 * 60 * 60 * 1000,
    });
    expect(result.ok).toBe(true);
  });
});
