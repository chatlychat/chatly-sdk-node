/**
 * The query and body parameter NAMES, against the zod schemas.
 *
 * ═══ WHY THIS IS A SEPARATE SUITE ═════════════════════════════════════════
 *
 * `surface.json` pins the verb, the path and the response shape. It pins
 * nothing about parameters, and that is where the live bugs have been: a zod
 * object schema STRIPS an unknown key, so a client sending the wrong name
 * gets a 200 and the server quietly does something else. `kinds[]` on
 * `/v1/search` shipped in three callers at once and ran unnarrowed.
 *
 * Worse on the reports routes, which validate nothing: they read raw
 * `@Query('name')` strings and clamp with `Math.min/Math.max`, so a
 * misspelled window is not even a 200-that-did-nothing — it is the DEFAULT
 * window, returning a plausible report for a period nobody asked for.
 *
 * So every name below was read off a handler on 2026-10-12 and is asserted
 * here on the wire. If a name changes server-side, this file is what should
 * go red.
 */
import { describe, expect, it } from 'vitest';

import { ChatlyClient, ChatlyPermissionError, ChatlyRateLimitError } from './index.js';

interface Sent {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  /** Lower-cased, because `Headers` normalises and a caller should not care. */
  headers: Record<string, string>;
  /** Whether a body was sent AT ALL, which `body: undefined` cannot say. */
  hadBody: boolean;
}

function recorder(): { chatly: ChatlyClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    sent.push({
      method: init?.method ?? 'GET',
      path: parsed.pathname,
      query: parsed.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers,
      hadBody: init?.body !== undefined && init?.body !== null,
    });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return {
    chatly: new ChatlyClient({
      apiKey: 'ck_t',
      apiUrl: 'https://api.test.invalid',
      fetchFn,
      retry: { attempts: 1 },
      sleepFn: async () => undefined,
    }),
    sent,
  };
}

/** The one request this call made. */
async function one(run: (c: ChatlyClient) => Promise<unknown>): Promise<Sent> {
  const { chatly, sent } = recorder();
  await run(chatly);
  expect(sent).toHaveLength(1);
  return sent[0] as Sent;
}

describe('report windows are not spelled the same way twice', () => {
  it('cohorts sends `weeks`, and never `days`', async () => {
    const req = await one((c) => c.reports.cohorts({ weeks: 12 }));
    expect(req.query.get('weeks')).toBe('12');
    expect(req.query.has('days')).toBe(false);
  });

  it('attribution sends `dimension` and `days`', async () => {
    const req = await one((c) => c.reports.attribution({ dimension: 'device_type', days: 14 }));
    expect(req.query.get('dimension')).toBe('device_type');
    expect(req.query.get('days')).toBe('14');
  });

  /*
   * Snake_case on the wire. `toRangeQuery` reads `group_by` and
   * `business_hours`; the camelCase spellings a TS caller reaches for first
   * are not parameters the API knows, and because nothing validates these
   * they would have been silently the defaults.
   */
  it('teams and labels send group_by and business_hours in snake_case', async () => {
    const teams = await one((c) =>
      c.reports.teams({
        groupBy: 'week',
        businessHours: true,
        from: '2026-01-01',
        to: '2026-02-01',
      }),
    );
    expect(teams.query.get('group_by')).toBe('week');
    expect(teams.query.get('business_hours')).toBe('true');
    expect(teams.query.has('groupBy')).toBe(false);
    expect(teams.query.has('businessHours')).toBe(false);
    expect(teams.query.get('from')).toBe('2026-01-01');
    expect(teams.query.get('to')).toBe('2026-02-01');

    const labels = await one((c) => c.reports.labels({ groupBy: 'hour' }));
    expect(labels.query.get('group_by')).toBe('hour');
  });

  it('themes sends a single batch `date`, not a range', async () => {
    const req = await one((c) => c.reports.themes({ date: '2026-10-12' }));
    expect(req.query.get('date')).toBe('2026-10-12');
    expect(req.query.has('days')).toBe(false);
    expect(req.query.has('from')).toBe(false);
  });

  it('themeConversations sends no query at all — the route reads none', async () => {
    const req = await one((c) => c.reports.themeConversations('th_1'));
    expect([...req.query.keys()]).toEqual([]);
    expect(req.path).toBe('/v1/reports/th_1/conversations'.replace('/th_1', '/themes/th_1'));
  });
});

describe('billing usage: two routes demand eventType and one refuses it', () => {
  it('usage and usage/daily both send `eventType`', async () => {
    const usage = await one((c) => c.billing.usage('conversation.opened'));
    expect(usage.query.get('eventType')).toBe('conversation.opened');

    const daily = await one((c) =>
      c.billing.usageDaily('message.sent.bot', { from: '2026-10-01' }),
    );
    expect(daily.query.get('eventType')).toBe('message.sent.bot');
    expect(daily.query.get('from')).toBe('2026-10-01');
  });

  /*
   * `/usage/monthly` does not read `eventType`. It rolls up all four meters
   * unconditionally, so sending one would be ignored — a filter that looks
   * applied and is not. Its only parameter is `month`, as YYYY-MM.
   */
  it('usage/monthly sends `month` and no eventType', async () => {
    const req = await one((c) => c.billing.usageMonthly({ month: '2026-09' }));
    expect(req.query.get('month')).toBe('2026-09');
    expect(req.query.has('eventType')).toBe(false);
  });
});

describe('path parameters are keyed by what the handler reads', () => {
  it('tickets.openCount is keyed by a conversation id', async () => {
    const req = await one((c) => c.tickets.openCount('conv_42'));
    expect(req.path).toBe('/v1/tickets/open-count/conv_42');
  });

  it('conversations.updateBlocks takes the conversation id first, then the message id', async () => {
    const req = await one((c) =>
      c.conversations.updateBlocks('conv_1', 'msg_1', { patches: [{ id: 'b1', set: {} }] }),
    );
    expect(req.path).toBe('/v1/conversations/conv_1/messages/msg_1/blocks');
  });

  it('ai.testProvider puts the provider NAME in the path, not an id', async () => {
    const req = await one((c) => c.ai.testProvider('anthropic'));
    expect(req.path).toBe('/v1/ai-providers/anthropic/test');
  });

  it('macros.template is keyed by slug', async () => {
    const req = await one((c) => c.macros.template('billing-refund'));
    expect(req.path).toBe('/v1/macros/templates/billing-refund');
  });

  it('email templates are keyed by kind, and the kind is not in the PUT body', async () => {
    const req = await one((c) =>
      c.emailTemplates.update('trial_ending_reminder', { subject: 's', body: 'b' }),
    );
    expect(req.method).toBe('PUT');
    expect(req.path).toBe('/v1/email-templates/trial_ending_reminder');
    // `emailTemplateWriteSchema` is .strict(): `kind` in the body is a 400.
    expect(req.body).toEqual({ subject: 's', body: 'b' });
  });

  it('the preview route is the mirror image — kind IS a body field', async () => {
    const req = await one((c) =>
      c.emailTemplates.preview({ kind: 'trial_ending_reminder', subject: 's', body: 'b' }),
    );
    expect(req.path).toBe('/v1/email-templates/preview');
    expect(req.body).toEqual({ kind: 'trial_ending_reminder', subject: 's', body: 'b' });
  });
});

describe('body field names that the route name gets wrong', () => {
  it('docsSources.sync sends `full`, not force', async () => {
    const req = await one((c) => c.docsSources.sync('ds_1', { full: true }));
    expect(req.body).toEqual({ full: true });
  });

  /*
   * `@ZodBody` runs `schema.parse(value)`, and an absent body parses as
   * `undefined` and fails. So these two always send an object.
   */
  it('docsSources.sync and update always send a body, even an empty one', async () => {
    expect((await one((c) => c.docsSources.sync('ds_1'))).body).toEqual({});
    expect((await one((c) => c.docsSources.update('ds_1'))).body).toEqual({});
    expect((await one((c) => c.contacts.cards('cont_1'))).body).toEqual({});
  });

  it('docsSources.discover sends provider/token/baseUrl flat, with no credentials wrapper', async () => {
    const req = await one((c) =>
      c.docsSources.discover({
        provider: 'discourse',
        token: '',
        baseUrl: 'https://f.example.org',
      }),
    );
    expect(req.body).toEqual({
      provider: 'discourse',
      token: '',
      baseUrl: 'https://f.example.org',
    });
  });

  it('webhooks.create sends `eventTypes`, not `events`', async () => {
    const req = await one((c) =>
      c.webhooks.create({ url: 'https://h.example.org', eventTypes: ['message.created'] }),
    );
    const body = req.body as Record<string, unknown>;
    expect(body.eventTypes).toEqual(['message.created']);
    expect('events' in body).toBe(false);
  });

  it('webhooks.setSchemaVersion sends `schemaVersion`, not `version`', async () => {
    const req = await one((c) => c.webhooks.setSchemaVersion('wh_1', '2026-10-10'));
    expect(req.body).toEqual({ schemaVersion: '2026-10-10' });
  });

  it('ai.addProvider sends `apiKey`, not key or token', async () => {
    const req = await one((c) => c.ai.addProvider({ provider: 'openai', apiKey: 'k'.repeat(24) }));
    const body = req.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['apiKey', 'provider']);
  });

  it('ai.setTone wraps the rules under `rules`, and the PUT answers a bare array', async () => {
    const req = await one((c) =>
      c.ai.setTone([{ category: 'empathy', rule: 'Acknowledge first.' }]),
    );
    expect(req.method).toBe('PUT');
    expect(req.body).toEqual({ rules: [{ category: 'empathy', rule: 'Acknowledge first.' }] });
  });

  it('ai.generateTone sends `styleGuide`', async () => {
    const req = await one((c) => c.ai.generateTone('g'.repeat(64)));
    expect(Object.keys(req.body as Record<string, unknown>)).toEqual(['styleGuide']);
  });

  it('knowledgeGaps.update sends only `status`', async () => {
    const req = await one((c) => c.knowledgeGaps.update('kg_1', 'dismissed'));
    expect(req.body).toEqual({ status: 'dismissed' });
  });

  it('knowledgeGaps.list sends `status` and `limit`, and no cursor', async () => {
    const req = await one((c) => c.knowledgeGaps.list({ status: 'drafted', limit: 50 }));
    expect(req.query.get('status')).toBe('drafted');
    expect(req.query.get('limit')).toBe('50');
    expect(req.query.has('cursor')).toBe(false);
  });

  it('conversations.unreadCounts sends `brand`, not brandId', async () => {
    const req = await one((c) => c.conversations.unreadCounts({ brand: 'brd_1' }));
    expect(req.query.get('brand')).toBe('brd_1');
    expect(req.query.has('brandId')).toBe(false);
  });

  it('contacts.mood sends `days`', async () => {
    const req = await one((c) => c.contacts.mood('cont_1', { days: 180 }));
    expect(req.query.get('days')).toBe('180');
  });

  it('channels.update can ask for replace semantics via `configMode`', async () => {
    const req = await one((c) =>
      c.channels.update('ch_1', { config: { a: 1 }, configMode: 'replace' }),
    );
    expect(req.body).toEqual({ config: { a: 1 }, configMode: 'replace' });
  });
});

/*
 * ── Writes whose only input is a path parameter ───────────────────────────
 *
 * The title of this block promised an idempotency key and the body did not
 * look at one: `Sent` carried no headers until 2026-10-14, so six cases
 * asserted the verb and the absent body and nothing else. A test that names
 * a property it never reads is the kind of green that hides a regression —
 * the header could have stopped being sent on every one of these routes and
 * this file would still have passed. `hadBody` is here for the same reason:
 * `body: undefined` is what a JSON `null` decodes to as well, so it cannot
 * distinguish "no body" from "the body `null`", and the API's zod schemas
 * treat those differently.
 */
describe('writes with no body send none, and are still writes', () => {
  for (const [name, run, path] of [
    [
      'ai.testProvider',
      (c: ChatlyClient) => c.ai.testProvider('openai'),
      '/v1/ai-providers/openai/test',
    ],
    [
      'bots.rotateExternalSecret',
      (c: ChatlyClient) => c.bots.rotateExternalSecret('b_1'),
      '/v1/bots/b_1/external/rotate-secret',
    ],
    [
      'channels.rotateSecret',
      (c: ChatlyClient) => c.channels.rotateSecret('ch_1'),
      '/v1/channels/ch_1/secret/rotate',
    ],
    [
      'customerCards.rotateSecret',
      (c: ChatlyClient) => c.customerCards.rotateSecret('cc_1'),
      '/v1/customer-cards/cc_1/rotate-secret',
    ],
    [
      'docsSources.webhook',
      (c: ChatlyClient) => c.docsSources.webhook('ds_1'),
      '/v1/docs-sources/ds_1/webhook',
    ],
    [
      'knowledgeGaps.draft',
      (c: ChatlyClient) => c.knowledgeGaps.draft('kg_1'),
      '/v1/knowledge-gaps/kg_1/draft',
    ],
    [
      'visitors.startConversation',
      (c: ChatlyClient) => c.visitors.startConversation('cont_1'),
      '/v1/visitors/cont_1/start-conversation',
    ],
  ] as const) {
    it(`${name} POSTs ${path} with an idempotency key and no body`, async () => {
      const { chatly, sent } = recorder();
      await run(chatly);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.method).toBe('POST');
      expect(sent[0]?.path).toBe(path);
      expect([...(sent[0]?.query.keys() ?? [])]).toEqual([]);
      expect(sent[0]?.hadBody).toBe(false);
      expect(sent[0]?.body).toBeUndefined();
      expect(sent[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    });
  }
});

/*
 * ── The one route on the surface whose refusals are not about the key ─────
 *
 * `visitors.start_conversation` is gated by a workspace opt-in that is OFF by
 * default, so the commonest failure an integrator sees is a 403 that has
 * nothing to do with their scopes. The SDK cannot fix that, but it must not
 * swallow it either: both refusals have to arrive as the typed errors a
 * caller branches on, which is what this asserts.
 */
describe('visitors.startConversation surfaces the opt-in and the per-contact limit', () => {
  it('maps the workspace opt-in refusal to the permission error, with the message intact', async () => {
    const sent: Sent[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      sent.push({
        method: init?.method ?? 'GET',
        path: new URL(String(url)).pathname,
        query: new URL(String(url)).searchParams,
        body: undefined,
        headers: {},
        hadBody: init?.body !== undefined && init?.body !== null,
      });
      return new Response(
        JSON.stringify({
          error: {
            code: 'forbidden',
            message:
              'This workspace does not allow an API key to open conversations. ' +
              'An owner or admin enables it with `PATCH /v1/workspace/settings` ' +
              '`{ "proactiveOutreach": { "apiKeysMayStartConversations": true } }`. ' +
              'Nothing was sent.',
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const chatly = new ChatlyClient({
      apiKey: 'ck_t',
      apiUrl: 'https://api.test.invalid',
      fetchFn,
      retry: { attempts: 3 },
      sleepFn: async () => undefined,
    });

    await expect(chatly.visitors.startConversation('cont_1')).rejects.toThrow(
      ChatlyPermissionError,
    );
    // A 403 is not retried — only a 429 and 5xx are. Retrying an opt-in
    // refusal three times is three audit-log entries for one mistake.
    expect(sent).toHaveLength(1);
    await expect(chatly.visitors.startConversation('cont_1')).rejects.toThrow(
      /apiKeysMayStartConversations/,
    );
  });

  /*
   * The per-contact 429 carries NO `Retry-After`, and this asserts that
   * rather than pretending otherwise.
   *
   * The first version of this test served `retry-after: 1800` and asserted
   * `retryAfter: 1800`. It passed, and it was a fixture inventing the
   * server's shape — the thing `wireError`'s docstring in
   * `packages/shared/src/errors` exists to warn about. What the API actually
   * sends, traced end to end:
   *
   *   - `consumePerContactOutreachToken` throws `RateLimitedError(ttl)`;
   *   - that is an `AppError` whose `toJSON()` puts the TTL in
   *     `details.retryAfterSeconds`, which `app-exception.filter.ts` nests
   *     under `error` — and that filter sets no headers at all;
   *   - the one place a plain `Retry-After` is synthesised
   *     (`apps/api/src/main.ts`) reads the `Retry-After-{bucket}` headers
   *     `@nestjs/throttler` emits, and this refusal is not a throttler
   *     refusal, so there are none and nothing is synthesised.
   *
   * So `retryAfter` is null here and the advice is in the body, which no SDK
   * reads. That is a real gap, logged rather than papered over: a test that
   * asserted the header would have made this file agree with a claim the
   * server does not make.
   */
  it('answers the per-contact limit with a rate-limit error whose retryAfter is NULL', async () => {
    const body = JSON.stringify({
      error: {
        code: 'rate_limited',
        message: 'Too many requests',
        details: { retryAfterSeconds: 1800 },
      },
    });
    const fetchFn = (async () =>
      new Response(body, {
        status: 429,
        // Deliberately no `retry-after`: the API sends none for this refusal.
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const chatly = new ChatlyClient({
      apiKey: 'ck_t',
      apiUrl: 'https://api.test.invalid',
      fetchFn,
      retry: { attempts: 1 },
      sleepFn: async () => undefined,
    });

    const err = await chatly.visitors
      .startConversation('cont_1')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatlyRateLimitError);
    const rate = err as ChatlyRateLimitError;
    expect(rate.status).toBe(429);
    expect(rate.code).toBe('rate_limited');
    // Null, not 1800 — and the TTL is only reachable through the raw body.
    expect(rate.retryAfter).toBeNull();
    expect(JSON.parse(rate.body)).toMatchObject({
      error: { details: { retryAfterSeconds: 1800 } },
    });
  });

  /*
   * The paired case, so nobody "fixes" the assertion above by putting the
   * header back into the fixture.
   *
   * The same route CAN answer a 429 that does carry retry advice — the
   * global throttler buckets it inherits from `throttler.config.ts` (30 a
   * second, 100 in 15 minutes). Those come from `@nestjs/throttler`, which
   * emits `Retry-After-{bucket}`, and `main.ts` derives the plain header
   * from the longest of them. So `retryAfter` is populated on that one, and
   * two 429s on one route mean different things.
   */
  it('populates retryAfter on the throttler-bucket 429, which does send the header', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many' } }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after-short': '1',
          'retry-after-login': '42',
        },
      })) as unknown as typeof fetch;
    const chatly = new ChatlyClient({
      apiKey: 'ck_t',
      apiUrl: 'https://api.test.invalid',
      fetchFn,
      retry: { attempts: 1 },
      sleepFn: async () => undefined,
    });
    const err = await chatly.visitors
      .startConversation('cont_1')
      .then(() => null)
      .catch((e: unknown) => e);
    // The LONGEST bucket, not the first: backing off for 1s retries into a
    // limit that is still closed for another 41.
    expect((err as ChatlyRateLimitError).retryAfter).toBe(42);
  });
});

describe('the deletes that answer with a body are not typed void', () => {
  /*
   * Ten of the eleven DELETEs on this surface answer 200 with something.
   * `macros.delete` is the only real 204. A method typed `void` parses the
   * body and then throws it away, reachable only by casting — which is what
   * `conversations.cancelScheduled` did.
   */
  it('each returns the decoded body', async () => {
    const { chatly, sent } = recorder();
    const results = await Promise.all([
      chatly.contacts.removeTag('c_1', 't'),
      chatly.conversations.cancelScheduled('s_1'),
      chatly.ai.deleteTool('t_1'),
      chatly.botRoutes.delete('br_1'),
      chatly.brands.delete('b_1'),
      chatly.customerCards.delete('cc_1'),
      chatly.docsSources.delete('ds_1'),
      chatly.emailTemplates.delete('workspace_invite'),
      chatly.triggers.delete('tr_1'),
    ]);
    expect(sent.every((s) => s.method === 'DELETE')).toBe(true);
    for (const value of results) {
      expect(value).toEqual({});
    }
  });
});
