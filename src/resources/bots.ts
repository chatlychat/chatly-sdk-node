import { listable, listableAt } from '../pagination.js';

import type { Query, Transport, Unmodelled } from './common.js';

export function botsResource(t: Transport) {
  const deliveryPages = listableAt<Unmodelled>(
    t,
    (id) => `/v1/bots/${encodeURIComponent(id)}/deliveries`,
  );
  return {
    /**
     * A page of bots — `{ items, nextCursor, hasMore }`.
     *
     * Query is the shared cursor set only: `cursor`, `limit` (1–100, default
     * 25), `sort`, `fields`, `filter`. `sort` accepts `id`, `name`,
     * `createdAt`, `updatedAt`, `status` with a `-` prefix for descending;
     * `filter` accepts `status`, `model`, `templateOrigin`, `createdAt`,
     * `updatedAt`. Unknown query keys are stripped, not rejected.
     *
     * Because `fields` projects, every field on an item is optional on the
     * wire — a row here is not the full object `get` returns.
     */
    ...listable<Unmodelled>(t, '/v1/bots'),
    get: (id: string) => t.get<Unmodelled>(`/v1/bots/${encodeURIComponent(id)}`),
    /**
     * Create a bot. Answers **201**.
     *
     * The body is a UNION, discriminated by `type`. For
     * `type: 'external'` the external-agent fields are spread **flat at the
     * top level** — `webhookUrl`, `timeoutSeconds`, `fallbackMessage` — NOT
     * nested under a `config` object, even though the service re-nests them
     * internally. `webhookUrl` must be https and passes an SSRF guard.
     *
     * For a Chatly bot `type` may be omitted and `systemPrompt` is required
     * at a minimum of 20 characters.
     *
     * The external arm's response carries `signingSecret`, `token`,
     * `credentialId` and `note` beside the bot. That is the only time the
     * signing secret appears; thereafter you get
     * `externalAgent.signingSecretSet: boolean` and nothing more.
     */
    create: (body: Unmodelled) => t.post<Unmodelled>('/v1/bots', body),
    /**
     * Patch a bot's own fields.
     *
     * Notably absent: `slug`, `type`, and every external-agent field. Those
     * last three live on `updateExternal`. The body schema is not strict, so
     * sending `webhookUrl` here is a 200 that changed nothing. An empty body
     * IS rejected (400 `No fields to update`).
     */
    update: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/bots/${encodeURIComponent(id)}`, body),
    /**
     * Patch the external-agent config: `webhookUrl`, `timeoutSeconds`,
     * `fallbackMessage`, all optional but at least one required.
     *
     * Asymmetry with create worth knowing: there `timeoutSeconds` defaults to
     * 15, here omitting it means "leave it alone".
     */
    updateExternal: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/bots/${encodeURIComponent(id)}/external`, body),
    /**
     * Mint a new signing secret for an external agent. Answers 201 with
     * `{ signingSecret }` — that field name, not `secret` and not `token`.
     *
     * No body. The previous secret stops verifying immediately.
     */
    rotateExternalSecret: (id: string) =>
      t.post<Unmodelled>(`/v1/bots/${encodeURIComponent(id)}/external/rotate-secret`),
    /**
     * One page of an external agent's delivery ledger, newest first.
     *
     * `?status=` takes one of `pending`, `delivered`, `failed`, `dead` — and
     * a word outside those four is a **400**, not an empty page, because the
     * route validates it against a zod enum. `failed` will be retried;
     * `dead` will not.
     *
     * `sort` accepts `createdAt` only. Not `id`: this table's ids are
     * `gen_random_uuid()` — v4, not v7 — so ordering by id is ordering by
     * nothing.
     *
     * The signed `payload` is NOT on a list row. A page of fifty would be
     * megabytes of transcript; call `delivery` for one.
     *
     * A 404 here means the bot does not exist OR is not an external agent. A
     * Chatly persona has no ledger because nothing is pushed anywhere.
     */
    deliveries: deliveryPages.page,
    /** Every delivery, following the cursor. Same query, minus `cursor`. */
    deliveriesAll: deliveryPages.all,
    /**
     * One delivery, with `payload` — the exact object that was serialised
     * and signed.
     *
     * `Unmodelled` rather than a payload type, deliberately: a row written
     * before a payload key existed carries the shape of that day, and typing
     * it as today's schema would make a non-null field access unsound on
     * precisely the old rows you are reading the log to investigate.
     */
    delivery: (id: string, deliveryId: string) =>
      t.get<Unmodelled>(
        `/v1/bots/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}`,
      ),
    /**
     * Queue one recorded delivery again, from attempt 0. Answers **201**
     * with `{ queued: true, deliveryId, url }`.
     *
     * The RECORDED payload, at the agent's CURRENT url and secret. Same
     * `eventId`, which is the point — it is what makes dedupe-by-eventId
     * work across a retry — and therefore a replay of a delivery the
     * receiver already processed is one they will correctly discard. Replay
     * the ones that never got through.
     *
     * It does not un-ring the fallback: if the delivery went `dead` and the
     * visitor was told and the thread released to a human, that already
     * happened and a replay does not repeat it.
     */
    redeliver: (id: string, deliveryId: string) =>
      t.post<Unmodelled>(
        `/v1/bots/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      ),
    /**
     * Sign a rehearsal payload with the agent's real secret, POST it to its
     * real url, and answer **201** with what came back —
     * `{ ok, httpStatus, durationMs, error, responseBody, url, signature, payload }`.
     *
     * Synchronous, so a `401` from your own verifier arrives in the response
     * to this call rather than in a log twenty minutes later. `signature` and
     * `payload` come back so you can check a verifier offline against the
     * exact header value and the exact object whose serialisation was signed.
     *
     * It WRITES NOTHING — no ledger row, no conversation, no retry — so it
     * does not appear under `deliveries`, and calling it a hundred times
     * costs a visitor nothing.
     *
     * The payload carries `test: true` and all-zero UUIDs. Acknowledge with a
     * 2xx and do not reply: a reply would target a conversation that does not
     * exist.
     */
    testDelivery: (id: string) =>
      t.post<Unmodelled>(`/v1/bots/${encodeURIComponent(id)}/test-delivery`),
    /**
     * One bot's numbers — and it answers for BOTH kinds of bot, a Chatly
     * persona and your own external agent, from one route.
     *
     * `{ volume, latency, reliability, outcomes }` plus `botType`, `ledger`
     * and `unit`. Four things worth knowing before you plot it:
     *
     * **The window is `days` and nothing else.** 1–365, default 30. `from`,
     * `to`, `weeks` and `date` are **refused with a 400**, not ignored — this
     * product has shipped a report that stripped `from`/`to` and confidently
     * answered for seven days, and a 400 is the only way you would find out.
     *
     * **Latency is percentiles, never a mean**: `p50DurationMs`,
     * `p95DurationMs`, `maxDurationMs`, with the `sampleSize` they were
     * computed over. `latency.basis` tells you what is being timed, and the
     * two values are not comparable: `last_attempt` is one HTTP round trip to
     * your endpoint (the LAST attempt's — the column is overwritten on retry,
     * so it is not the sum of three), `run_wall_clock` is a whole tool loop.
     *
     * **A rate is `null`, not `0`, when its denominator is 0.** `0` would read
     * as "nothing failed" about a bot nobody has spoken to. Check
     * `sampleSize` beside it.
     *
     * **A `null` count means the kind cannot produce that number.**
     * `volume.retrying`, `reliability.fallbackCount` and
     * `reliability.retriedCount` are null for a Chatly persona — it has no
     * retry ladder and no fallback message, it escalates instead — and
     * `volume.cancelled` is null for an external agent. Null is never zero
     * here.
     *
     * `outcomes.conversations` is conversations this bot TOUCHED, so two bots
     * that shared a thread both count it and per-bot rows do not add up to a
     * workspace total. `GET /v1/reports/analytics/assistants` is the one that
     * partitions, by attributing each thread to its last deciding run — a
     * rule that cannot see an external agent at all, which is why this route
     * does not use it.
     *
     * Requires `reports:read`, not the `triggers:read` the delivery ledger
     * needs: this returns counts and percentiles, with no transcript,
     * payload, conversation id or contact in it.
     */
    analytics: (id: string, query: Query = {}) =>
      t.get<Unmodelled>(`/v1/bots/${encodeURIComponent(id)}/analytics`, query),
  };
}

export function botRoutesResource(t: Transport) {
  return {
    /**
     * Every bot route, in evaluation order. A bare array.
     *
     * The handler takes NO query parameters — it is `@PaginationExempt` and
     * has no `@Query` at all, so `cursor`, `limit`, `sort`, `fields` and
     * `filter` are not merely ignored by a schema, they are never read.
     */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/bot-routes'),
    /**
     * The routing-condition vocabulary.
     *
     * An OBJECT with four keys — `{ fields, prefixes, operators, evaluate }` —
     * not the bare array the route name suggests. The conditions you may
     * write are a CLOSED vocabulary (six fixed keys plus three open
     * prefixes), so read this rather than guessing a field name: an unknown
     * one is a 400.
     */
    fields: () => t.get<Unmodelled>('/v1/bot-routes/fields'),
    /**
     * Create a route. Answers **201**.
     *
     * `botId` and `name` are required; `priority` (0–10000), `enabled`,
     * `channelTypes`, `conditions` (max 20), `brandId` and `evaluate`
     * (`'conversation_start' | 'every_message'`) are optional and defaulted by
     * the COLUMN, not the schema.
     */
    create: (body: Unmodelled) => t.post<Unmodelled>('/v1/bot-routes', body),
    /** Every create field, optional. Unlike `bots.update`, an empty body is accepted. */
    update: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/bot-routes/${encodeURIComponent(id)}`, body),
    /**
     * Dry-run the routing table against a hypothetical visitor.
     *
     * A read dressed as a POST — the body carries a page, a context, a
     * contact and a `moment`, which is too much structure for a query string
     * — and it WRITES NOTHING: no conversation is read, no contact, no stored
     * visitor context.
     *
     * Answers `{ selected, routes, event }`. `selected` is the route that
     * would answer or `null`; `routes` is every ENABLED route in evaluation
     * order with its verdict (`matched`, `not_eligible_at_moment`,
     * `channel_excluded`, `brand_excluded`, `condition_failed`); `event` is
     * the object the conditions were evaluated against, which is where you
     * find out that a field path resolves to nothing.
     *
     * A failed condition reports `actual` — the value the field resolved to.
     * `undefined` means the visitor has no such attribute; a real value means
     * routing works and the expectation was wrong. Different bugs, identical
     * symptom.
     *
     * `moment` defaults to `conversation_start` and is the field to reach for
     * when a route "works on the first message and then stops": at
     * `follow_up` only routes that opted into `every_message` are eligible at
     * all.
     *
     * This is the production decision, not an approximation of it — the
     * function the worker calls on every inbound message is a wrapper over
     * the one that answers here.
     */
    resolve: (body: Unmodelled = {}) => t.post<Unmodelled>('/v1/bot-routes/resolve', body),
    /**
     * **200 with `{ deleted: true }`, not a 204.**
     *
     * A literal `true`, so there is nothing to branch on. Note it differs
     * from the sibling `brands.delete`, which answers `{ id }` — the two
     * deletes on this surface confirm themselves differently.
     */
    delete: (id: string) => t.del<Unmodelled>(`/v1/bot-routes/${encodeURIComponent(id)}`),
  };
}
