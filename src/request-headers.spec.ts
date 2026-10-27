/**
 * `request({ headers })` — and the two guards on it, which are NOT the same
 * mechanism.
 *
 * It exists for one header: `x-secret-recipient` on `POST /v1/api-keys`,
 * which makes the response carry a blob sealed to the recipient's X25519 key
 * instead of a plaintext token. Before this, nothing in any published package
 * could send it, so the sealed path could only be driven from a browser.
 *
 * `authorization` is refused by a CONDITION. `idempotency-key` is protected
 * by POSITION — the extras are merged before the idempotency block, which
 * overwrites whatever was set. Only the first of those fails if the condition
 * is removed, which is why both are asserted separately and why the one that
 * depends on statement order says so.
 */
import { describe, expect, it } from 'vitest';

import { ChatlyClient } from './index.js';

function recordingFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fn: fn as unknown as typeof fetch };
}

const sent = (init: RequestInit): Headers => new Headers(init.headers);

const clientWith = (fn: typeof fetch) =>
  new ChatlyClient({ apiKey: 'ck_test_k', apiUrl: 'https://api.test', fetchFn: fn });

describe('request({ headers })', () => {
  it('sends the header on the wire', async () => {
    const rec = recordingFetch();
    await clientWith(rec.fn).request('POST', '/v1/api-keys', {
      body: { name: 'probe', scopes: ['messages:write'] },
      headers: { 'x-secret-recipient': 'x25519:AAAA' },
    });
    expect(sent(rec.calls[0]!.init).get('x-secret-recipient')).toBe('x25519:AAAA');
  });

  it('cannot replace the bearer token', async () => {
    const rec = recordingFetch();
    await clientWith(rec.fn).request('GET', '/v1/whatever', {
      headers: { Authorization: 'Bearer ck_live_someone_elses' },
    });
    expect(sent(rec.calls[0]!.init).get('authorization')).toBe('Bearer ck_test_k');
  });

  it('cannot replace the bearer token under any casing', async () => {
    // `Headers.set` is case-insensitive, so a lowercased comparison is the
    // only correct one — `'AUTHORIZATION' !== 'authorization'` would pass the
    // check and then overwrite the real header.
    const rec = recordingFetch();
    await clientWith(rec.fn).request('GET', '/v1/whatever', {
      headers: { AUTHORIZATION: 'Bearer nope', authorization: 'Bearer also-nope' },
    });
    expect(sent(rec.calls[0]!.init).get('authorization')).toBe('Bearer ck_test_k');
  });

  it('cannot replace the idempotency key — which ORDER protects, not the condition', async () => {
    const rec = recordingFetch();
    await clientWith(rec.fn).request('POST', '/v1/api-keys', {
      body: {},
      headers: { 'idempotency-key': 'chosen-by-the-caller' },
    });
    const key = sent(rec.calls[0]!.init).get('idempotency-key');
    expect(key).not.toBe('chosen-by-the-caller');
    // A real uuid, i.e. the transport's own, minted once per call.
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('leaves a request with no headers option exactly as it was', async () => {
    const rec = recordingFetch();
    await clientWith(rec.fn).request('GET', '/v1/whatever');
    const h = sent(rec.calls[0]!.init);
    expect(h.get('authorization')).toBe('Bearer ck_test_k');
    expect(h.get('idempotency-key')).toBe(null);
  });
});
