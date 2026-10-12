/**
 * Behaviour tests for the public SDK surface that the dashboard /
 * partner integrators depend on. Focused on the bits that are easy to
 * regress and load-bearing for correctness:
 *
 *   - every write sends an `Idempotency-Key` (no header drop on dispatch)
 *   - `withIdempotencyKey(key)` pins the key across multiple writes
 *   - `withIdempotencyKey` returns a derived client, not a mutated one
 *   - webhook signature verification (timing-safe, malformed inputs ok)
 *
 * `fetch` is injected via `ClientOptions.fetchFn`, so we don't touch the
 * network — the spec asserts on the request shape the SDK builds.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ChatlyClient,
  verifyWebhookSignature,
  chatlyIdentityHash,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from './index.js';

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


/**
 * Local copy of `@livechat/shared/narrow`'s `at`, deliberately not imported.
 *
 * This file is mirrored verbatim into the PUBLIC `chatlychat/chatly-sdk-node`
 * repository, and the mirror generator drops any spec that imports a private
 * workspace package — which is what it did to this one. The result was a
 * published SDK repo whose CI ran `vitest run`, found no test files, and
 * exited 1: thirty-eight behavioural tests thrown away over a ten-line array
 * helper. The import was the only thing private about the file.
 *
 * Same contract as the shared version: name the array that was short, instead
 * of a TypeError on a property of undefined.
 */
function at<T>(items: ArrayLike<T>, index: number, label = 'array'): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(
      `Expected ${label}[${String(index)}] to exist, but the array has ${String(items.length)} item(s).`,
    );
  }
  return value;
}

describe('ChatlyClient — Idempotency-Key on writes', () => {
  it('attaches a fresh idempotency-key to every POST when no key is pinned', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({
      apiKey: 'k',
      apiUrl: 'https://api.test',
      fetchFn: rec.fn,
    });
    await client.events.track({ contactId: 'c1', name: 'signup' });
    await client.events.track({ contactId: 'c2', name: 'signup' });
    expect(rec.calls).toHaveLength(2);
    const k1 = new Headers(
      at(rec.calls, 0, 'recorded requests').init.headers as Record<string, string>,
    ).get('idempotency-key');
    const k2 = new Headers(
      at(rec.calls, 1, 'recorded requests').init.headers as Record<string, string>,
    ).get('idempotency-key');
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).not.toEqual(k2);
  });

  it('preserves the base auth headers on the dispatch path', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({
      apiKey: 'secret-token',
      apiUrl: 'https://api.test',
      fetchFn: rec.fn,
    });
    await client.contacts.upsert({ email: 'a@b.c' });
    const h = new Headers(
      at(rec.calls, 0, 'recorded requests').init.headers as Record<string, string>,
    );
    expect(h.get('authorization')).toBe('Bearer secret-token');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('idempotency-key')).toBeTruthy();
  });
});

describe('ChatlyClient — withIdempotencyKey', () => {
  it('pins a stable key across multiple writes on the derived client', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({
      apiKey: 'k',
      apiUrl: 'https://api.test',
      fetchFn: rec.fn,
    });
    const pinned = client.withIdempotencyKey('fixed-key-123');
    await pinned.events.track({ contactId: 'c1', name: 'a' });
    await pinned.events.track({ contactId: 'c2', name: 'b' });
    expect(rec.calls).toHaveLength(2);
    for (const call of rec.calls) {
      const h = new Headers(call.init.headers as Record<string, string>);
      expect(h.get('idempotency-key')).toBe('fixed-key-123');
    }
  });

  it('does not mutate the original client', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({
      apiKey: 'k',
      apiUrl: 'https://api.test',
      fetchFn: rec.fn,
    });
    client.withIdempotencyKey('pinned'); // intentionally unused
    await client.events.track({ contactId: 'c1', name: 'x' });
    const h = new Headers(
      at(rec.calls, 0, 'recorded requests').init.headers as Record<string, string>,
    );
    expect(h.get('idempotency-key')).not.toBe('pinned');
  });

  it('rejects empty / non-string keys with a TypeError (cheap mistake guard)', () => {
    const client = new ChatlyClient({ apiKey: 'k' });
    expect(() => client.withIdempotencyKey('')).toThrow(TypeError);
    // @ts-expect-error — intentional misuse
    expect(() => client.withIdempotencyKey(undefined)).toThrow(TypeError);
  });
});

describe('ChatlyClient — withIdempotencyKey keeps the full surface', () => {
  /**
   * `derive` rebuilds every route namespace by hand so the closures target
   * the derived instance. That is easy to forget: `search` was never rebound
   * at all, and `messages` was caught only by the compiler because its
   * namespace happened to already be listed.
   *
   * This compares the shape of a derived client against its parent, so a new
   * method on any namespace fails here rather than silently calling the
   * parent's request methods.
   */
  it('exposes exactly the same namespaces and methods as the parent', () => {
    const rec = recordingFetch();
    const parent = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    const child = parent.withIdempotencyKey('order-1');

    const surface = (c: ChatlyClient): string[] => {
      const bags = ['contacts', 'conversations', 'events', 'search'] as const;
      return bags
        .flatMap((bag) =>
          Object.keys((c as unknown as Record<string, object>)[bag] ?? {}).map(
            (k) => `${bag}.${k}`,
          ),
        )
        .sort();
    };
    expect(surface(child)).toEqual(surface(parent));
  });

  it('routes a derived namespace through the derived client', async () => {
    const rec = recordingFetch();
    const parent = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    await parent.withIdempotencyKey('order-1').contacts.upsert({ email: 'a@b.c' });
    const headers = new Headers(rec.calls[0]?.init.headers);
    expect(headers.get('idempotency-key')).toBe('order-1');
  });
});

describe('ChatlyClient — parity with the MCP tools', () => {
  /**
   * The MCP server exposed `get_messages` and `search_kb` while the SDK did
   * not, so the same capability was reachable from a tool call and not from
   * the published client. These pin the request shapes against the routes the
   * MCP tools use.
   */
  it('reads a thread by conversation id', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    await client.conversations.messages('c-1', { limit: 50 });
    expect(rec.calls[0]?.url).toBe('https://api.test/v1/conversations/c-1/messages?limit=50');
  });

  it('narrows KB search with the plain `kinds` parameter the schema validates', async () => {
    /*
     * This test said the opposite, in a comment, and enforced it:
     *
     *   "The bracket in `kinds[]` is the whole point: `kinds=kb` is silently
     *    ignored by the list-filter parser and returns everything."
     *
     * Exactly backwards. `searchQuerySchema` is a zod OBJECT with a key named
     * `kinds`; the query parser leaves `kinds[]` as a literal key, which the
     * object schema strips. So `search.kb()` ran an UNNARROWED search and
     * returned contacts, conversations, messages and tickets with a 200.
     * `filter[]` on the list endpoints is the opposite case — it has an
     * explicit fold — and the two were conflated.
     *
     * Three SDK authors found this independently by reading the schema. The
     * test that should have caught it was the thing holding it in place,
     * because its comment was an assertion about the server that nobody
     * checked against the server.
     */
    const rec = recordingFetch();
    const client = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    await client.search.kb('refund');
    const url = new URL(rec.calls[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/search');
    expect(url.searchParams.get('q')).toBe('refund');
    expect(url.searchParams.getAll('kinds')).toEqual(['kb']);
    expect(url.searchParams.has('kinds[]')).toBe(false);
  });
});

describe('ChatlyClient — events.list', () => {
  /**
   * The SDK could POST an event and never read one back: `/v1/cdp/events`
   * was referenced only under POST, so the read half of the CDP integration
   * had no shipped caller at all. These pin the exact request.
   */
  it('GETs the same collection track() posts to', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    await client.events.list();
    expect(rec.calls).toHaveLength(1);
    expect(new URL(at(rec.calls, 0, 'recorded requests').url).pathname).toBe('/v1/cdp/events');
    expect(at(rec.calls, 0, 'recorded requests').init.method).toBe('GET');
  });

  it('scopes the stream to one contact and passes the page cursor through', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    await client.events.list({ contactId: 'ct-1', limit: 25, cursor: 'abc' });
    const url = new URL(at(rec.calls, 0, 'recorded requests').url);
    expect(url.pathname).toBe('/v1/cdp/events');
    expect(url.searchParams.get('contactId')).toBe('ct-1');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('abc');
  });

  it('is a read, so it sends no idempotency key', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({ apiKey: 'k', apiUrl: 'https://api.test', fetchFn: rec.fn });
    await client.events.list();
    const headers = new Headers(at(rec.calls, 0, 'recorded requests').init.headers);
    expect(headers.get('idempotency-key')).toBeNull();
  });
});

describe('ChatlyClient — whoami', () => {
  it('GETs the one api-keys route a key is allowed to call', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({
      apiKey: 'k',
      apiUrl: 'https://api.test',
      fetchFn: rec.fn,
    });
    await client.whoami();
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.url).toBe('https://api.test/v1/api-keys/whoami');
    expect(rec.calls[0]?.init.method).toBe('GET');
  });

  it('is a read, so it sends no idempotency key', async () => {
    const rec = recordingFetch();
    const client = new ChatlyClient({
      apiKey: 'k',
      apiUrl: 'https://api.test',
      fetchFn: rec.fn,
    });
    await client.whoami();
    const headers = new Headers(rec.calls[0]?.init.headers);
    expect(headers.get('idempotency-key')).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'shh';
  const body = '{"type":"message.created","payload":{"id":"m1"}}';
  const t = 1_714_060_800;
  // The construction the producer uses and the docs describe: HMAC over
  // `${t}.${body}`, never the body alone. Computed here rather than
  // hard-coded so the spec doesn't rot, but note that the round-trip
  // assertion lives in the worker
  // (`apps/worker/src/__tests__/webhook-sig.spec.ts`) — this file can only
  // ever prove the verifier agrees with ITSELF.
  const header = (ts: number, payload = body, key = secret): string =>
    `t=${String(ts)},v1=${createHmac('sha256', key)
      .update(`${String(ts)}.${payload}`)
      .digest('hex')}`;

  it('returns true for a signature over `t.body`', () => {
    expect(
      verifyWebhookSignature({ body, signatureHeader: header(t), secret, nowSeconds: t }),
    ).toBe(true);
  });

  it('accepts the raw body as bytes', () => {
    expect(
      verifyWebhookSignature({
        body: Buffer.from(body, 'utf8'),
        signatureHeader: header(t),
        secret,
        nowSeconds: t,
      }),
    ).toBe(true);
  });

  it('rejects a signature over the body alone', () => {
    // This is what this verifier used to COMPUTE. If it ever passes again,
    // every genuine delivery is being rejected in the field.
    const bodyOnly = `t=${String(t)},v1=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyWebhookSignature({ body, signatureHeader: bodyOnly, secret, nowSeconds: t })).toBe(
      false,
    );
  });

  it('returns false for a tampered body', () => {
    expect(
      verifyWebhookSignature({
        body: '{"type":"message.created","payload":{"id":"m2"}}',
        signatureHeader: header(t),
        secret,
        nowSeconds: t,
      }),
    ).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    expect(
      verifyWebhookSignature({
        body,
        signatureHeader: header(t, body, 'evil'),
        secret,
        nowSeconds: t,
      }),
    ).toBe(false);
  });

  it('returns false when the header is missing the v1= scheme', () => {
    expect(
      verifyWebhookSignature({ body, signatureHeader: `t=${String(t)}`, secret, nowSeconds: t }),
    ).toBe(false);
  });

  it('returns false when the header is missing t=', () => {
    // Without `t` there is no replay window to enforce, so a header that
    // omits it is not verifiable — not merely unfresh.
    const sig = createHmac('sha256', secret)
      .update(`${String(t)}.${body}`)
      .digest('hex');
    expect(
      verifyWebhookSignature({ body, signatureHeader: `v1=${sig}`, secret, nowSeconds: t }),
    ).toBe(false);
  });

  it('rejects a replayed delivery outside the tolerance window', () => {
    expect(
      verifyWebhookSignature({
        body,
        signatureHeader: header(t),
        secret,
        nowSeconds: t + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 1,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        body,
        signatureHeader: header(t),
        secret,
        nowSeconds: t + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
      }),
    ).toBe(true);
  });

  it('rejects a delivery timestamped in the future beyond tolerance', () => {
    // Clock skew cuts both ways; an attacker post-dating `t` to buy a longer
    // replay window is the case that matters.
    expect(
      verifyWebhookSignature({
        body,
        signatureHeader: header(t),
        secret,
        nowSeconds: t - WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 1,
      }),
    ).toBe(false);
  });
});

describe('chatlyIdentityHash', () => {
  it('matches the digest the API verifies against', () => {
    // The API computes HMAC-SHA256(secret, externalId) and compares with
    // timingSafeEqual. If these two ever disagree, identity verification
    // rejects every legitimate visitor -- and the failure looks like a
    // widget bug rather than a hashing mismatch.
    const expected = createHmac('sha256', 'shh').update('user-42').digest('hex');
    expect(chatlyIdentityHash('shh', 'user-42')).toBe(expected);
  });

  it('differs per user, which is the entire point', () => {
    expect(chatlyIdentityHash('shh', 'user-1')).not.toBe(chatlyIdentityHash('shh', 'user-2'));
  });

  it('differs per workspace secret', () => {
    expect(chatlyIdentityHash('a', 'user-1')).not.toBe(chatlyIdentityHash('b', 'user-1'));
  });

  it.each([
    ['an empty secret', '', 'user-1'],
    ['an empty externalId', 'shh', ''],
  ])('refuses %s rather than returning a hash of nothing', (_label, secret, externalId) => {
    // An empty secret produces a perfectly valid-looking digest that any
    // attacker can also compute.
    expect(() => chatlyIdentityHash(secret, externalId)).toThrow();
  });
});
