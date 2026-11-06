/**
 * What the transport does with the server's `Retry-After`.
 *
 * ForgeDeck's fifth report (2026-11-06, item 2): their `chatly plan` and
 * `chatly apply` printed zero bytes for 60 to 75 seconds against a throttled
 * API, and the API had sent `retry-after: 809`. `RetryPolicy.maxDelayMs` is
 * documented as "ceiling for a single backoff" and the advised path ignored
 * it — `await this.sleepFn(advised ?? jittered)` slept for whatever number
 * arrived. A thirteen-minute sleep with no output is indistinguishable from a
 * hang, which is what it looked like to them.
 *
 * Two behaviours, and the tests are written so that each fails on its own:
 * advice past `MAX_ADVISED_DELAY_MS` is handed back instead of slept through,
 * and every wait is announced to `onRetry` first.
 */
import { describe, expect, it } from 'vitest';

import { ChatlyApiError, ChatlyClient, MAX_ADVISED_DELAY_MS, type RetryNotice } from './index.js';

/** Answers 429 with a given `Retry-After`, counting calls. */
function throttling(retryAfter: string, status = 429) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 'rate_limited' } }), {
      status,
      headers: { 'content-type': 'application/json', 'retry-after': retryAfter },
    });
  };
  return { calls: () => calls, fn: fn as unknown as typeof fetch };
}

function clientWith(fetchFn: typeof fetch, extra: Record<string, unknown> = {}) {
  const slept: number[] = [];
  const notices: RetryNotice[] = [];
  const client = new ChatlyClient({
    apiKey: 'ck_test',
    fetchFn,
    sleepFn: async (ms: number) => {
      slept.push(ms);
    },
    onRetry: (n) => notices.push(n),
    ...extra,
  });
  return { client, slept, notices };
}

describe('advice longer than the cap is handed back, not slept through', () => {
  it('throws on the FIRST 429 and sleeps not at all', async () => {
    const api = throttling('809');
    const { client, slept } = clientWith(api.fn);
    await expect(client.request('GET', '/v1/privacy/partners')).rejects.toBeInstanceOf(
      ChatlyApiError,
    );
    expect(slept).toEqual([]);
    // One attempt, not three: there is no point retrying sooner than advised.
    expect(api.calls()).toBe(1);
  });

  /*
   * The error still carries the advice, because the decision moves to the
   * caller rather than disappearing. `chatly` prints this number.
   */
  it('carries retryAfter so the caller can report or wait itself', async () => {
    const { client } = clientWith(throttling('809').fn);
    await client.request('GET', '/v1/x').catch((err: unknown) => {
      expect(err).toBeInstanceOf(ChatlyApiError);
      expect((err as ChatlyApiError).retryAfter).toBe(809);
    });
    expect.assertions(2);
  });

  it('is the cap that decides, not the status', async () => {
    // One second over, to pin the boundary rather than the magnitude.
    const over = String(MAX_ADVISED_DELAY_MS / 1000 + 1);
    const { client, slept } = clientWith(throttling(over).fn);
    await expect(client.request('GET', '/v1/x')).rejects.toBeInstanceOf(ChatlyApiError);
    expect(slept).toEqual([]);
  });
});

describe('advice within the cap is still waited out', () => {
  /*
   * The regression this change must not cause. A 429 advising 5 seconds was
   * waited out before and has to be still: capping the advised path at the
   * 4-second backoff ceiling would turn those into failures.
   */
  it('sleeps for exactly the advised time and retries', async () => {
    const api = throttling('5');
    const { client, slept } = clientWith(api.fn);
    await expect(client.request('GET', '/v1/x')).rejects.toBeInstanceOf(ChatlyApiError);
    expect(slept).toEqual([5000, 5000]);
    expect(api.calls()).toBe(3);
  });

  it('waits at the cap itself, so the boundary is inclusive', async () => {
    const at = String(MAX_ADVISED_DELAY_MS / 1000);
    const { client, slept } = clientWith(throttling(at).fn);
    await expect(client.request('GET', '/v1/x')).rejects.toBeInstanceOf(ChatlyApiError);
    expect(slept[0]).toBe(MAX_ADVISED_DELAY_MS);
  });
});

describe('every wait is announced before it happens', () => {
  it('calls onRetry with the wait, the attempt and the server`s advice', async () => {
    const { client, notices } = clientWith(throttling('5').fn);
    await expect(client.request('POST', '/v1/conversations', {})).rejects.toThrow();
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      attempt: 1,
      attempts: 3,
      status: 429,
      delayMs: 5000,
      retryAfterSeconds: 5,
      method: 'POST',
      path: '/v1/conversations',
    });
    expect(notices[1]?.attempt).toBe(2);
  });

  /*
   * Announced BEFORE the sleep, not after. A notice that arrives when the wait
   * ends explains a silence that has already happened, which is the whole
   * defect restated.
   */
  it('announces before sleeping', async () => {
    const order: string[] = [];
    const client = new ChatlyClient({
      apiKey: 'ck_test',
      fetchFn: throttling('5').fn,
      sleepFn: async () => {
        order.push('sleep');
      },
      onRetry: () => order.push('notice'),
    });
    await expect(client.request('GET', '/v1/x')).rejects.toThrow();
    expect(order).toEqual(['notice', 'sleep', 'notice', 'sleep']);
  });

  it('reports a 5xx retry too, with no server advice', async () => {
    const { client, notices } = clientWith(
      (async () =>
        new Response('{}', {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    );
    await expect(client.request('GET', '/v1/x')).rejects.toThrow();
    expect(notices[0]?.status).toBe(503);
    expect(notices[0]?.retryAfterSeconds).toBeNull();
    // Our own backoff, so jittered rather than exact.
    expect(notices[0]?.delayMs).toBeGreaterThan(0);
  });

  /* A client that passes no hook must behave exactly as before. */
  it('is optional', async () => {
    const client = new ChatlyClient({
      apiKey: 'ck_test',
      fetchFn: throttling('5').fn,
      sleepFn: async () => {},
    });
    await expect(client.request('GET', '/v1/x')).rejects.toThrow();
  });
});
