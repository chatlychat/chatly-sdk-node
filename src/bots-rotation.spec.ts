/**
 * `bots.rotateExternalSecret` and its overlap window, on the wire.
 *
 * The route is `.strict()` server-side (`rotateSecretSchema` in
 * bots.controller.ts), so a misspelled key is a 400 rather than the silent
 * hard cut it was before the route had a body at all — but only if the SDK
 * sends the key the schema names. Every assertion here is on what was SENT;
 * the canned response is used only by the last case, which is the weak one.
 *
 * The no-argument call is pinned by `resource-params.spec.ts` ("writes with
 * no body send none"): it must stay bodyless, because that is the hard cut
 * every caller written before the window still relies on.
 */
import { describe, expect, it } from 'vitest';

import { ChatlyClient } from './index.js';

interface Sent {
  method: string;
  path: string;
  rawBody: string | undefined;
  headers: Record<string, string>;
}

function recorder(answer: unknown = { signingSecret: 'whsec_x', activatesAt: null }) {
  const sent: Sent[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    sent.push({
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
      rawBody: typeof init?.body === 'string' ? init.body : undefined,
      headers,
    });
    return new Response(JSON.stringify(answer), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const chatly = new ChatlyClient({
    apiKey: 'ck_t',
    apiUrl: 'https://api.test.invalid',
    fetchFn,
    retry: { attempts: 1 },
    sleepFn: async () => undefined,
  });
  return { chatly, sent };
}

const PATH = '/v1/bots/b_1/external/rotate-secret';

describe('bots.rotateExternalSecret with an overlap window', () => {
  it('sends exactly {"activateAt"} — camelCase, nothing beside it — as an idempotent POST', async () => {
    const { chatly, sent } = recorder();
    await chatly.bots.rotateExternalSecret('b_1', { activateAt: '2026-10-16T09:00:00Z' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.path).toBe(PATH);
    expect(sent[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]?.rawBody).toBe('{"activateAt":"2026-10-16T09:00:00Z"}');
  });

  it('passes a string through verbatim, offset and all — the server validates it', async () => {
    const { chatly, sent } = recorder();
    await chatly.bots.rotateExternalSecret('b_1', { activateAt: '2026-10-16T11:00:00+02:00' });
    expect(JSON.parse(sent[0]?.rawBody ?? 'null')).toEqual({
      activateAt: '2026-10-16T11:00:00+02:00',
    });
  });

  it('sends a Date as its UTC instant', async () => {
    const { chatly, sent } = recorder();
    // 11:00 at +02:00 is 09:00Z — the conversion, not the wall-clock digits.
    await chatly.bots.rotateExternalSecret('b_1', {
      activateAt: new Date('2026-10-16T11:00:00+02:00'),
    });
    expect(sent[0]?.rawBody).toBe('{"activateAt":"2026-10-16T09:00:00.000Z"}');
  });

  it('an empty options object is the hard cut, and sends no body', async () => {
    const { chatly, sent } = recorder();
    await chatly.bots.rotateExternalSecret('b_1', {});
    expect(sent[0]?.rawBody).toBeUndefined();
    expect(sent[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns activatesAt, null or an instant, as the server wrote it', async () => {
    const parked = recorder({ signingSecret: 'whsec_x', activatesAt: '2026-10-16T09:00:00.000Z' });
    const r1 = await parked.chatly.bots.rotateExternalSecret('b_1', {
      activateAt: '2026-10-16T09:00:00.000Z',
    });
    expect(r1.activatesAt).toBe('2026-10-16T09:00:00.000Z');
    expect(r1.signingSecret).toBe('whsec_x');

    const cut = recorder();
    const r2 = await cut.chatly.bots.rotateExternalSecret('b_1');
    expect(r2.activatesAt).toBeNull();
  });
});
