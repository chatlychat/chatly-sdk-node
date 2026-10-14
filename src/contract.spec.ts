/**
 * The cross-language contract, tested in Node.
 *
 * `packages/sdk-spec/CONTRACT.md` §10 lists ten things every Chatly SDK must
 * prove. This file is Node's proof of items 1–9. The same nine run in Python,
 * Go, Ruby, PHP, Java, .NET and Rust, against the same two pinned vectors —
 * so a digest that differs between languages is a bug in one of them, not a
 * difference of opinion.
 *
 * Item 10, the response-shape lock, lives in `surface-lock.spec.ts` instead,
 * because it is the file that writes `surface.lock.json`.
 */
import { describe, expect, it } from 'vitest';

import {
  ChatlyClient,
  type ClientOptions,
  ChatlyAuthenticationError,
  ChatlyConflictError,
  ChatlyNotFoundError,
  ChatlyPermissionError,
  ChatlyRateLimitError,
  ChatlyServerError,
  ChatlyTransportError,
  ChatlyValidationError,
  DEFAULT_API_URL,
  chatlyIdentityHash,
  verifyWebhookSignature,
} from './index.js';

/** A fetch stand-in that answers from a script and records what it was asked. */
function recorder(
  script: Array<{ status: number; body?: string; headers?: Record<string, string> }>,
): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; method: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  let i = 0;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step === undefined) {
      throw new Error('recorder: empty script');
    }
    return new Response(step.body ?? '{}', {
      status: step.status,
      headers: { 'content-type': 'application/json', ...(step.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const noSleep = async (): Promise<void> => undefined;

function client(
  script: Parameters<typeof recorder>[0],
  opts: Partial<ClientOptions> = {},
): { chatly: ChatlyClient; calls: ReturnType<typeof recorder>['calls'] } {
  const rec = recorder(script);
  const chatly = new ChatlyClient({
    apiKey: 'ck_test_key',
    apiUrl: 'https://api.test.invalid',
    fetchFn: rec.fetchFn,
    sleepFn: noSleep,
    ...opts,
  });
  return { chatly, calls: rec.calls };
}

/* ── §10.1 the default base URL is production ─────────────────────────── */
describe('contract 1 — default host', () => {
  it('defaults to the production API, not a dev or example hostname', async () => {
    expect(DEFAULT_API_URL).toBe('https://api.chatlychat.com');
    const rec = recorder([{ status: 200, body: '{"ok":true}' }]);
    const chatly = new ChatlyClient({ apiKey: 'ck_x', fetchFn: rec.fetchFn, sleepFn: noSleep });
    await chatly.workspace.labels();
    expect(rec.calls[0]?.url).toBe('https://api.chatlychat.com/v1/labels');
  });

  it('rejects an empty api key at construction, not at the first call', () => {
    expect(() => new ChatlyClient({ apiKey: '' })).toThrow(TypeError);
  });
});

/* ── §10.2 authorization carries the key ──────────────────────────────── */
describe('contract 2 — auth header', () => {
  it('sends the key as a bearer token on every request', async () => {
    const { chatly, calls } = client([{ status: 200 }]);
    await chatly.workspace.inboxes();
    expect(calls[0]?.headers['authorization']).toBe('Bearer ck_test_key');
    expect(calls[0]?.headers['user-agent']).toMatch(/^chatly-sdk-node\//);
  });
});

/* ── §10.3 idempotency ────────────────────────────────────────────────── */
describe('contract 3 — idempotency keys', () => {
  it('sends a key on a write and none on a read', async () => {
    const { chatly, calls } = client([{ status: 200 }, { status: 200 }]);
    await chatly.contacts.upsert({ email: 'a@b.test' });
    await chatly.contacts.list();
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]?.headers['idempotency-key']).toBeUndefined();
  });

  it('mints a different key per logical write', async () => {
    const { chatly, calls } = client([{ status: 200 }, { status: 200 }]);
    await chatly.contacts.upsert({ email: 'a@b.test' });
    await chatly.contacts.upsert({ email: 'c@d.test' });
    expect(calls[0]?.headers['idempotency-key']).not.toBe(calls[1]?.headers['idempotency-key']);
  });

  it('reuses ONE key across the SDK-internal retries of a single call', async () => {
    // Two 503s then success: one logical write, three attempts, one key —
    // otherwise attempt 2 of a write that already landed upstream is accepted
    // as a brand new operation and double-writes.
    const { chatly, calls } = client([
      { status: 503 },
      { status: 503 },
      { status: 200, body: '{"id":"c1"}' },
    ]);
    await chatly.contacts.upsert({ email: 'a@b.test' });
    expect(calls).toHaveLength(3);
    const keys = new Set(calls.map((c) => c.headers['idempotency-key']));
    expect(keys.size).toBe(1);
  });

  it('pins a stable key across calls on a derived client', async () => {
    const { chatly, calls } = client([{ status: 200 }, { status: 200 }]);
    const pinned = chatly.withIdempotencyKey('key_fixed');
    await pinned.contacts.upsert({ email: 'a@b.test' });
    await pinned.macros.create({ name: 'm' });
    expect(calls.map((c) => c.headers['idempotency-key'])).toEqual(['key_fixed', 'key_fixed']);
  });
});

/* ── §10.4 typed errors ───────────────────────────────────────────────── */
describe('contract 4 — typed errors', () => {
  const cases: Array<[number, unknown]> = [
    [401, ChatlyAuthenticationError],
    [403, ChatlyPermissionError],
    [404, ChatlyNotFoundError],
    [409, ChatlyConflictError],
    [422, ChatlyValidationError],
    [429, ChatlyRateLimitError],
    [500, ChatlyServerError],
  ];
  for (const [status, type] of cases) {
    it(`maps ${String(status)} to ${(type as { name: string }).name}`, async () => {
      const { chatly } = client(
        [
          {
            status,
            body: JSON.stringify({ code: 'some_code', message: 'nope' }),
            headers: { 'x-request-id': 'req_abc' },
          },
        ],
        { retry: { attempts: 1 } },
      );
      await expect(chatly.contacts.get('c1')).rejects.toBeInstanceOf(type as never);
      await expect(chatly.contacts.get('c1')).rejects.toMatchObject({
        status,
        code: 'some_code',
        message: 'nope',
        requestId: 'req_abc',
      });
    });
  }

  it('populates retryAfter on a 429 from the Retry-After header', async () => {
    const { chatly } = client([{ status: 429, body: '{}', headers: { 'retry-after': '7' } }], {
      retry: { attempts: 1 },
    });
    await expect(chatly.contacts.list()).rejects.toMatchObject({ retryAfter: 7 });
  });

  it('keeps the raw body when the error payload is not JSON', async () => {
    const { chatly } = client([{ status: 502, body: '<html>bad gateway</html>' }], {
      retry: { attempts: 1 },
    });
    await expect(chatly.contacts.list()).rejects.toMatchObject({
      body: '<html>bad gateway</html>',
      code: null,
    });
  });

  it('raises a transport error, not an API error, when there is no response', async () => {
    const chatly = new ChatlyClient({
      apiKey: 'ck_x',
      apiUrl: 'https://api.test.invalid',
      sleepFn: noSleep,
      retry: { attempts: 1 },
      fetchFn: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await expect(chatly.contacts.list()).rejects.toBeInstanceOf(ChatlyTransportError);
  });
});

/* ── §10.5 retries ────────────────────────────────────────────────────── */
describe('contract 5 — retry policy', () => {
  it('retries a 429 and then succeeds', async () => {
    const { chatly, calls } = client([
      { status: 429, body: '{}' },
      { status: 200, body: '{"items":[],"nextCursor":null}' },
    ]);
    await chatly.contacts.list();
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry a 400', async () => {
    const { chatly, calls } = client([{ status: 400, body: '{}' }]);
    await expect(chatly.contacts.list()).rejects.toBeInstanceOf(ChatlyValidationError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the configured attempt count', async () => {
    const { chatly, calls } = client([{ status: 500, body: '{}' }], { retry: { attempts: 3 } });
    await expect(chatly.contacts.list()).rejects.toBeInstanceOf(ChatlyServerError);
    expect(calls).toHaveLength(3);
  });
});

/* ── §10.6 pagination ─────────────────────────────────────────────────── */
describe('contract 6 — auto-pagination', () => {
  it('walks two pages and stops on a null cursor', async () => {
    const { chatly, calls } = client([
      { status: 200, body: '{"items":[{"id":"a"},{"id":"b"}],"nextCursor":"cur2"}' },
      { status: 200, body: '{"items":[{"id":"c"}],"nextCursor":null}' },
    ]);
    const seen: unknown[] = [];
    for await (const item of chatly.contacts.listAll()) {
      seen.push(item);
    }
    expect(seen).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]?.url ?? '').searchParams.get('cursor')).toBe('cur2');
  });

  it('refuses to loop forever when the server repeats a cursor', async () => {
    const { chatly } = client([
      { status: 200, body: '{"items":[{"id":"a"}],"nextCursor":"same"}' },
      { status: 200, body: '{"items":[{"id":"b"}],"nextCursor":"same"}' },
    ]);
    const walk = async (): Promise<void> => {
      for await (const _ of chatly.contacts.listAll()) {
        void _;
      }
    };
    await expect(walk()).rejects.toThrow(/repeated cursor/);
  });

  it('repeats a query key instead of comma-joining it, with no brackets', async () => {
    /*
     * The brackets mattered, in the wrong direction. `search.kb` sent
     * `kinds[]=kb`, which `searchQuerySchema` — a zod OBJECT schema — strips
     * as an unknown key, so the search ran unnarrowed and returned 200. The
     * plain repeated key is what the schema validates.
     */
    const { chatly, calls } = client([{ status: 200, body: '{}' }]);
    await chatly.search.kb('refunds');
    expect(calls[0]?.url).toContain('kinds=kb');
    expect(calls[0]?.url).not.toContain('kinds%5B%5D');
  });
});

/* ── §10.7 and §10.8/9 the pinned vectors ─────────────────────────────── */
describe('contract 7 — webhook signature, against the pinned vector', () => {
  const SECRET = 'whsec_test';
  const BODY = '{"id":"evt_1"}';
  const T = 1700000000;
  const V1 = 'c89214b5b5da833daed6f0b8c5bb6bd58cea9022bd80ccc78230f3942d632925';

  it('accepts the vector from CONTRACT.md §10', () => {
    expect(
      verifyWebhookSignature({
        body: BODY,
        signatureHeader: `t=${String(T)},v1=${V1}`,
        secret: SECRET,
        nowSeconds: T,
      }),
    ).toBe(true);
  });

  it('rejects a digest taken over the body alone', async () => {
    const { createHmac } = await import('node:crypto');
    const wrong = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(
      verifyWebhookSignature({
        body: BODY,
        signatureHeader: `t=${String(T)},v1=${wrong}`,
        secret: SECRET,
        nowSeconds: T,
      }),
    ).toBe(false);
  });

  it('returns false, never throws, on a malformed header', () => {
    for (const header of ['', 'garbage', 't=abc,v1=ff', `v1=${V1}`, `t=${String(T)}`]) {
      expect(() =>
        verifyWebhookSignature({ body: BODY, signatureHeader: header, secret: SECRET }),
      ).not.toThrow();
      expect(verifyWebhookSignature({ body: BODY, signatureHeader: header, secret: SECRET })).toBe(
        false,
      );
    }
  });
});

describe('contract 8 — identity hash, against the pinned vector', () => {
  it('matches the digest every other SDK must produce', () => {
    expect(chatlyIdentityHash('sek_test_secret', 'user_42')).toBe(
      '5e26772dce97d5ba995796e621f83f2e97e6f8c3f9386dbf153a98ab24c10271',
    );
  });
});

/* ── The escape hatch ─────────────────────────────────────────────────── */
describe('request() — the escape hatch', () => {
  it('reaches a route with no typed method, with auth and idempotency intact', async () => {
    const { chatly, calls } = client([{ status: 200, body: '{"ok":true}' }]);
    await chatly.request('POST', '/v1/feature-flags', { body: { key: 'x' } });
    expect(calls[0]?.url).toBe('https://api.test.invalid/v1/feature-flags');
    expect(calls[0]?.headers['authorization']).toBe('Bearer ck_test_key');
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/* ── The wire BODIES, which three of them got wrong ───────────────────── */
describe('request bodies match the zod schemas, key for key', () => {
  /** A recorder that keeps the serialised body, not just the headers. */
  function bodyRecorder(): {
    fetchFn: typeof fetch;
    bodies: Array<{ url: string; body: unknown }>;
  } {
    const bodies: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      bodies.push({
        url: String(url),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { fetchFn, bodies };
  }

  function bodyClient(): { chatly: ChatlyClient; bodies: Array<{ url: string; body: unknown }> } {
    const rec = bodyRecorder();
    return {
      chatly: new ChatlyClient({
        apiKey: 'ck_t',
        apiUrl: 'https://api.test.invalid',
        fetchFn: rec.fetchFn,
        sleepFn: noSleep,
        retry: { attempts: 1 },
      }),
      bodies: rec.bodies,
    };
  }

  /*
   * zod DROPS unknown keys, so a write with the wrong key name returns 200
   * having done nothing — indistinguishable from success. These three were
   * built that way and shipped:
   *
   *   merge        sent { sourceContactId }, schema wants { mergedId }
   *   addTags      sent { tags: [...] },     schema wants { tag }, singular
   *   unsubscribe  sent { },                 `unsubscribed` is required
   *
   * The first two silently did nothing.
   */
  it('contacts.merge sends mergedId, not sourceContactId', async () => {
    const { chatly, bodies } = bodyClient();
    await chatly.contacts.merge('c1', { mergedId: 'c2' });
    expect(bodies[0]?.body).toEqual({ mergedId: 'c2' });
  });

  it('contacts.addTags sends ONE tag under `tag`', async () => {
    const { chatly, bodies } = bodyClient();
    await chatly.contacts.addTags('c1', 'vip');
    expect(bodies[0]?.body).toEqual({ tag: 'vip' });
  });

  it('contacts.unsubscribe sends the required `unsubscribed` boolean', async () => {
    const { chatly, bodies } = bodyClient();
    await chatly.contacts.unsubscribe('c1', { unsubscribed: true, reason: 'asked' });
    expect(bodies[0]?.body).toEqual({ unsubscribed: true, reason: 'asked' });
  });

  it('conversations.setAgentHandling sends `state`', async () => {
    const { chatly, bodies } = bodyClient();
    await chatly.conversations.setAgentHandling('conv1', { state: 'human' });
    expect(bodies[0]?.body).toEqual({ state: 'human' });
  });

  it('contacts.bulkUpsert wraps the array under `contacts`', async () => {
    const { chatly, bodies } = bodyClient();
    await chatly.contacts.bulkUpsert([{ email: 'a@b.test' }]);
    expect(bodies[0]?.body).toEqual({ contacts: [{ email: 'a@b.test' }] });
  });
});

/* ── Retry-After, in the spelling the server actually sends ───────────── */
describe('rate-limit advice', () => {
  it('reads a suffixed Retry-After-{bucket} when there is no plain header', async () => {
    /*
     * `@nestjs/throttler` names its buckets, so it emits
     * `Retry-After-{bucket}` and no plain `Retry-After` — our own public docs
     * said as much. This SDK read only the plain header, so `retryAfter` was
     * null on every real 429. The API now derives the plain header too; this
     * covers a deployment that has not taken that change.
     */
    const { chatly } = client(
      [
        {
          status: 429,
          body: '{}',
          headers: { 'retry-after-short': '3', 'retry-after-long': '42' },
        },
      ],
      { retry: { attempts: 1 } },
    );
    // The LONGEST bucket wins: backing off for the shortest retries into a
    // limit that is still closed.
    await expect(chatly.contacts.list()).rejects.toMatchObject({ retryAfter: 42 });
  });

  it('prefers a plain Retry-After when the server sends one', async () => {
    const { chatly } = client(
      [{ status: 429, body: '{}', headers: { 'retry-after': '9', 'retry-after-short': '1' } }],
      { retry: { attempts: 1 } },
    );
    await expect(chatly.contacts.list()).rejects.toMatchObject({ retryAfter: 9 });
  });
});

/* ── The nested error envelope ────────────────────────────────────────── */
describe('error envelope', () => {
  it('reads code and message from the nested `error` object the API sends', async () => {
    // `wireError()` in packages/shared produces `{ error: { code, message } }`.
    // A client reading the top level gets null for every real refusal — that
    // bug shipped in the widget.
    const { chatly } = client(
      [
        {
          status: 403,
          body: JSON.stringify({ error: { code: 'forbidden', message: 'needs contacts:write' } }),
        },
      ],
      { retry: { attempts: 1 } },
    );
    await expect(chatly.contacts.upsert({ email: 'a@b.test' })).rejects.toMatchObject({
      code: 'forbidden',
      message: 'needs contacts:write',
    });
  });

  it('still reads a flat envelope, which is what a proxy sends', async () => {
    const { chatly } = client(
      [{ status: 502, body: JSON.stringify({ code: 'bad_gateway', message: 'upstream' }) }],
      { retry: { attempts: 1 } },
    );
    await expect(chatly.contacts.list()).rejects.toMatchObject({ code: 'bad_gateway' });
  });
});

describe('SDK_VERSION', () => {
  it('matches package.json, because it is stamped into every User-Agent', async () => {
    // The CLI's equivalent literal drifted two patch versions and told every
    // user the wrong number. A literal is fine; an unchecked literal is not.
    const { readFileSync } = await import('node:fs');
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const { SDK_VERSION } = await import('./index.js');
    expect(SDK_VERSION).toBe(version);
  });
});

/* ── Auto-pagination covers every paged route, and only those ─────────── */
describe('the paged set matches the manifest', () => {
  /*
   * The manifest's `paged` flag was wrong in BOTH directions for a day:
   * `macros.list` was flagged and is `@PaginationExempt`, while
   * `contacts.journey`, `conversations.unattended` and `search.query` return
   * real cursors and were not flagged. Eight became ten, and the 55 -> 142
   * expansion made it twelve: `bots.list` and `triggers.list` both go through
   * `buildPaginatedResponse`. Nothing connected the flag to this SDK's
   * paginators, which is how that went unnoticed — so this reads the manifest
   * and checks both directions.
   */
  it('every paged entry has an auto-paginating form here, and no other does', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    /*
     * Monorepo, then the copy a public mirror vendors at its root.
     *
     * This hardcoded `../../sdk-spec/surface.json`, which is right here and
     * does not exist in a mirror, where the package root IS the repo root.
     * `surface-lock.spec.ts` already resolved both and this did not, so the
     * mirror's CI went red on a test that passes locally — exactly what that
     * CI is for.
     */
    const candidates = [
      new URL('../../sdk-spec/surface.json', import.meta.url),
      new URL('../sdk-spec/surface.json', import.meta.url),
    ];
    const found = candidates.find((u) => existsSync(u));
    expect(found, 'surface.json is not reachable from either known location').toBeDefined();
    const manifest = JSON.parse(readFileSync(found ?? candidates[0]!, 'utf8')) as {
      entries: Array<{ ns: string; name: string; paged?: boolean }>;
    };

    const paged = manifest.entries.filter((e) => e.paged === true);
    /*
     * Floor, with the reason in the message. Twelve today. It moved 8 → 10 and
     * then 10 → 12 on evidence; if it drops, check that the manifest still
     * parses before concluding a route legitimately stopped paginating.
     */
    expect(
      paged.length,
      'the paged set shrank — confirm surface.json parsed first',
    ).toBeGreaterThanOrEqual(12);

    const { chatly } = client([{ status: 200, body: '{"items":[],"nextCursor":null}' }]);
    const bag = chatly as unknown as Record<string, Record<string, unknown>>;

    /** The paginating method this SDK exposes for a manifest entry. */
    const walkerFor: Record<string, [string, string]> = {
      'contacts.list': ['contacts', 'listAll'],
      'contacts.journey': ['contacts', 'journeyAll'],
      'conversations.list': ['conversations', 'listAll'],
      'conversations.messages': ['conversations', 'messagesAll'],
      'conversations.unattended': ['conversations', 'unattendedAll'],
      'tickets.list': ['tickets', 'listAll'],
      'kb.articles': ['kb', 'listAll'],
      'search.query': ['search', 'queryAll'],
      'events.list': ['events', 'listAll'],
      /*
       * `deliveriesAll`, not `listAll`. `webhooks.list` is now
       * `GET /v1/webhooks` — the endpoint list, a bare array — so the delivery
       * page moved off `list`. While `list` pointed at deliveries there was no
       * method at all for the endpoints, and a walker named `listAll` beside a
       * non-paginating `list` would have been a trap.
       */
      'webhooks.deliveries': ['webhooks', 'deliveriesAll'],
      'bots.list': ['bots', 'listAll'],
      'bots.deliveries': ['bots', 'deliveriesAll'],
      'triggers.list': ['triggers', 'listAll'],
    };

    for (const entry of paged) {
      const key = `${entry.ns}.${entry.name}`;
      const target = walkerFor[key];
      expect(target, `${key} is flagged paged and has no walker in this SDK`).toBeDefined();
      const [ns, method] = target ?? ['', ''];
      expect(typeof bag[ns]?.[method], `chatly.${ns}.${method} is missing`).toBe('function');
    }

    // And nothing walks a route the manifest does not flag. `macros` is the
    // one that mattered: a paginator there raised a decode error on the real
    // bare-array response in two sibling SDKs. `billing.invoices` is the new
    // hazard — it IS cursor-paginated, but under `data`, so a walker keyed on
    // `items` would answer an empty page with a 200 forever.
    expect(
      bag['macros']?.['listAll'],
      'macros does not paginate — the route is exempt',
    ).toBeUndefined();
    expect(
      bag['billing']?.['invoicesAll'],
      'billing.invoices paginates under `data`, so a generic walker is wrong',
    ).toBeUndefined();
  });
});
