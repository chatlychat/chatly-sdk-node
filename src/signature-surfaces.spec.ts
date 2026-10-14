/**
 * The parts of `verifyChatlySignature` that are not one surface in isolation:
 * the three surfaces that share a header name, the legacy workflow header,
 * every malformed input, and the published fixed vector.
 *
 * Split out of `signatures.spec.ts` to stay under this repo's 650-line
 * ceiling. The table-driven per-surface tests are there; the shared fixtures
 * are in `test/signature-fixtures.ts`, which records why they sign by hand.
 */

import { describe, expect, it } from 'vitest';

import {
  verifyChatlySignature,
  type ChatlySignatureSurface,
  type VerifyChatlySignatureInput,
  type VerifyChatlySignatureResult,
} from './signatures.js';
import { BODY, NOW_MS, NOW_SECONDS, SECRET, hmac, refused } from './test/signature-fixtures.js';
import { verifyWebhookSignature } from './webhooks.js';

describe('the surfaces that share a header name cannot be confused', () => {
  /*
   * This is the bug the whole module exists for. All three of these requests
   * arrive as `x-chatly-signature`, and each verifies under exactly one
   * surface — so a verifier that keys on the header name is wrong two times
   * in three while looking right.
   */
  it('an agent delivery does not verify as a tool call or a customer card', () => {
    const t = String(NOW_SECONDS);
    const headers = {
      'x-chatly-signature': `t=${t},v1=${hmac(SECRET, `${t}.${BODY}`)}`,
    };
    expect(
      verifyChatlySignature({
        surface: 'agent_delivery',
        body: BODY,
        headers,
        secret: SECRET,
        nowMs: NOW_MS,
      }).ok,
    ).toBe(true);
    expect(
      verifyChatlySignature({
        surface: 'ai_tool_call',
        body: BODY,
        headers,
        secret: SECRET,
        method: 'POST',
        path: '/x',
        nowMs: NOW_MS,
      }).ok,
    ).toBe(false);
    // As a customer card it is not even the right FORMAT — `t=…,v1=…` where
    // `sha256=…` belongs — so this one is caught before any crypto.
    expect(
      refused(
        verifyChatlySignature({
          surface: 'customer_card',
          body: BODY,
          headers,
          secret: SECRET,
          nowMs: NOW_MS,
        }),
      ).reason,
    ).toBe('malformed_signature_header');
  });

  it('a tool call signed over t.METHOD.path.body does not verify as an agent delivery', () => {
    const t = String(NOW_SECONDS);
    const headers = {
      'x-chatly-signature': `t=${t},v1=${hmac(SECRET, `${t}.POST./orders.${BODY}`)}`,
    };
    expect(
      verifyChatlySignature({
        surface: 'ai_tool_call',
        body: BODY,
        headers,
        secret: SECRET,
        method: 'post',
        path: '/orders',
        nowMs: NOW_MS,
      }).ok,
    ).toBe(true);
    expect(
      verifyChatlySignature({
        surface: 'agent_delivery',
        body: BODY,
        headers,
        secret: SECRET,
        nowMs: NOW_MS,
      }).ok,
    ).toBe(false);
  });

  it('a tool call signed for one path does not verify for another', () => {
    const t = String(NOW_SECONDS);
    const headers = {
      'x-chatly-signature': `t=${t},v1=${hmac(SECRET, `${t}.GET./returns/9.${BODY}`)}`,
    };
    // The whole reason the target is signed: one route treating GET as a read
    // and DELETE as a cancellation must not accept the other's signature.
    expect(
      verifyChatlySignature({
        surface: 'ai_tool_call',
        body: BODY,
        headers,
        secret: SECRET,
        method: 'DELETE',
        path: '/returns/9',
        nowMs: NOW_MS,
      }).ok,
    ).toBe(false);
  });

  it('refuses a tool call with no method or path instead of signing an empty target', () => {
    const t = String(NOW_SECONDS);
    const { reason, message } = refused(
      verifyChatlySignature({
        surface: 'ai_tool_call',
        body: BODY,
        headers: { 'x-chatly-signature': `t=${t},v1=${hmac(SECRET, `${t}.${BODY}`)}` },
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    );
    expect(reason).toBe('missing_request_target');
    expect(message).toContain('pathname');
  });
});

describe('the legacy workflow header', () => {
  const headers = { 'x-chatly-signature': `sha256=${hmac(SECRET, BODY)}` };

  it('is refused by default, and the refusal names the v2 header', () => {
    const { reason, message } = refused(
      verifyChatlySignature({
        surface: 'workflow_webhook_legacy',
        body: BODY,
        headers,
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    );
    expect(reason).toBe('replay_unprotected');
    expect(message).toContain('x-chatly-signature-v2');
  });

  it('verifies on an explicit opt-in, and reports no timestamp', () => {
    const result = verifyChatlySignature({
      surface: 'workflow_webhook_legacy',
      body: BODY,
      headers,
      secret: SECRET,
      allowUnprotectedReplay: true,
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // `null`, not 0 and not `Date.now()`: the surface sends no timestamp,
      // and a caller logging freshness must be able to see that.
      expect(result.timestampMs).toBeNull();
    }
  });

  it('still verifies a year later, which is the reason it is opt-in', () => {
    const result = verifyChatlySignature({
      surface: 'workflow_webhook_legacy',
      body: BODY,
      headers,
      secret: SECRET,
      allowUnprotectedReplay: true,
      nowMs: NOW_MS + 365 * 24 * 60 * 60 * 1000,
    });
    // Nothing is wrong with this verifier. The surface simply cannot bound a
    // replay, and asserting it makes the cost of the opt-in explicit.
    expect(result.ok).toBe(true);
  });
});

describe('malformed input never throws', () => {
  const nasty: ReadonlyArray<readonly [string, VerifyChatlySignatureInput]> = [
    [
      'an unknown surface',
      {
        surface: 'not_a_surface' as ChatlySignatureSurface,
        body: BODY,
        headers: {},
        secret: SECRET,
      },
    ],
    [
      'a digest that is not hex',
      {
        surface: 'event_webhook',
        body: BODY,
        headers: { 'x-livechat-signature': `t=${String(NOW_SECONDS)},v1=zzzz` },
        secret: SECRET,
        nowMs: NOW_MS,
      },
    ],
    [
      'a header with no fields at all',
      {
        surface: 'event_webhook',
        body: BODY,
        headers: { 'x-livechat-signature': 'garbage' },
        secret: SECRET,
        nowMs: NOW_MS,
      },
    ],
    [
      'a v1 field but no t',
      {
        surface: 'event_webhook',
        body: BODY,
        headers: { 'x-livechat-signature': `v1=${'a'.repeat(64)}` },
        secret: SECRET,
        nowMs: NOW_MS,
      },
    ],
    [
      'an empty header value',
      {
        surface: 'canvas_step',
        body: BODY,
        headers: { 'x-chatly-canvas-signature': '', 'x-chatly-canvas-ts': '' },
        secret: SECRET,
        nowMs: NOW_MS,
      },
    ],
    [
      'a canvas signature with no timestamp header',
      {
        surface: 'canvas_step',
        body: BODY,
        headers: { 'x-chatly-canvas-signature': `sha256=${'a'.repeat(64)}` },
        secret: SECRET,
        nowMs: NOW_MS,
      },
    ],
    [
      'headers whose values are undefined',
      {
        surface: 'event_webhook',
        body: BODY,
        headers: { 'x-livechat-signature': undefined },
        secret: SECRET,
        nowMs: NOW_MS,
      },
    ],
  ];

  it.each(nasty)('returns a reason for %s', (_label, input) => {
    let result: VerifyChatlySignatureResult;
    expect(() => {
      result = verifyChatlySignature(input);
    }).not.toThrow();

    expect(result!.ok).toBe(false);
  });

  it('accepts a Uint8Array body as well as a string', () => {
    const t = String(NOW_SECONDS);
    const headers = {
      'x-livechat-signature': `t=${t},v1=${hmac(SECRET, `${t}.${BODY}`)}`,
    };
    const result = verifyChatlySignature({
      surface: 'event_webhook',
      body: new TextEncoder().encode(BODY),
      headers,
      secret: SECRET,
      nowMs: NOW_MS,
    });
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
  });
});

describe('the published fixed vector', () => {
  /*
   * CONTRACT.md §10.9. Computed and cross-checked in two implementations, so
   * it is the one assertion here that does not depend on this file's own
   * signer being right.
   */
  const VECTOR = {
    secret: 'whsec_test',
    body: '{"id":"evt_1"}',
    header: 't=1700000000,v1=c89214b5b5da833daed6f0b8c5bb6bd58cea9022bd80ccc78230f3942d632925',
    nowMs: 1_700_000_000 * 1000,
  };

  it('verifies under the new verifier', () => {
    const result = verifyChatlySignature({
      surface: 'event_webhook',
      body: VECTOR.body,
      headers: { 'x-livechat-signature': VECTOR.header },
      secret: VECTOR.secret,
      nowMs: VECTOR.nowMs,
    });
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
  });

  it('still verifies under the published verifyWebhookSignature', () => {
    // It is on npm and in use. The new function is the recommended path, not
    // a replacement, and this is the assertion that keeps that true.
    expect(
      verifyWebhookSignature({
        body: VECTOR.body,
        signatureHeader: VECTOR.header,
        secret: VECTOR.secret,
        nowSeconds: 1_700_000_000,
      }),
    ).toBe(true);
  });

  it('is rejected by both when the digest is taken over the body alone', () => {
    const bodyOnly = `t=1700000000,v1=${hmac(VECTOR.secret, VECTOR.body)}`;
    expect(
      verifyChatlySignature({
        surface: 'event_webhook',
        body: VECTOR.body,
        headers: { 'x-livechat-signature': bodyOnly },
        secret: VECTOR.secret,
        nowMs: VECTOR.nowMs,
      }).ok,
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        body: VECTOR.body,
        signatureHeader: bodyOnly,
        secret: VECTOR.secret,
        nowSeconds: 1_700_000_000,
      }),
    ).toBe(false);
  });
});
