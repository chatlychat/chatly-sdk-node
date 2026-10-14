import type { Transport, Unmodelled } from './common.js';

/**
 * `USAGE_EVENT_TYPES` — the closed four-value list.
 *
 * `/v1/billing/usage` and `/v1/billing/usage/daily` both reject an absent,
 * empty or unrecognised value with a 400, thrown before anything is read.
 */
export type UsageEventType =
  | 'conversation.opened'
  | 'message.sent.agent'
  | 'message.sent.bot'
  | 'ai.tokens';

export function billingResource(t: Transport) {
  return {
    /** The plan catalogue this deployment can actually sell. */
    plans: () => t.get<ReadonlyArray<Unmodelled>>('/v1/billing/plans'),
    /** Plan, seats, period and balance in one object. */
    summary: () => t.get<Unmodelled>('/v1/billing'),
    /**
     * Usage for ONE meter over a window.
     *
     * `eventType` is required — the handler validates it against a closed
     * list and throws before doing anything else, so a call without it is a
     * 400, not a summary of everything. Four SDKs shipped this as an
     * optional argument and one sent no query at all, which made it a method
     * that could never succeed.
     */
    usage: (eventType: UsageEventType, range: { from?: string; to?: string } = {}) =>
      t.get<Unmodelled>('/v1/billing/usage', { eventType, ...range }),
    /**
     * The daily series for ONE meter.
     *
     * Same mandatory `eventType` gate as `usage`, same four values, same
     * error. `from`/`to` are ISO instants, `to` exclusive; omitted they
     * default to the current UTC month. `to <= from` is a 400 and the window
     * is capped at 365 days.
     *
     * `days` in the response is DENSE — one bucket per UTC day in the window,
     * zeros included — so do not infer a gap from a missing key.
     */
    usageDaily: (eventType: UsageEventType, range: { from?: string; to?: string } = {}) =>
      t.get<Unmodelled>('/v1/billing/usage/daily', { eventType, ...range }),
    /**
     * The monthly rollup — and it does NOT take `eventType`.
     *
     * This is the asymmetry worth knowing: `/usage` and `/usage/daily`
     * require `eventType` and 400 without it, while `/usage/monthly` does not
     * read the parameter at all and always rolls up all four meters. Passing
     * it here is not an error and not a filter — it is silently ignored, and
     * you get everything back looking like you asked for it.
     *
     * The one parameter is `month`, as `YYYY-MM` in UTC; anything else is a
     * 400 from a hand-written parser, and omitting it means the current
     * month. The response carries an `items` key and NO `nextCursor`, so it
     * is an object, not a page.
     */
    usageMonthly: (query: { month?: string } = {}) =>
      t.get<Unmodelled>('/v1/billing/usage/monthly', {
        ...(query.month === undefined ? {} : { month: query.month }),
      }),
    /**
     * Stripe invoices, newest first.
     *
     * Cursor-paginated, but under **`data`**, not `items` — the one route on
     * the surface that spells the envelope differently
     * (`{ data, nextCursor }`). That is why it is an `object` and not a
     * `page`, and why there is no `invoicesAll`: a generic walker keyed on
     * `items` would read `undefined` and report an empty page forever.
     *
     * `cursor` is the previous row's ISO `createdAt`, not an opaque token,
     * and an unparsable one is silently the first page rather than a 400.
     * `limit` is clamped 1–100, default 25.
     */
    invoices: (query: { cursor?: string; limit?: number } = {}) =>
      t.get<Unmodelled>('/v1/billing/invoices', {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
  };
}
