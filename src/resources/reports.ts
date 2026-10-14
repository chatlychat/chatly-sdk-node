import type { Query, Transport, Unmodelled } from './common.js';

/**
 * ── THE REPORT WINDOW IS NOT SPELLED THE SAME WAY TWICE ──────────────────
 *
 * No reports route validates its query with zod. They read raw
 * `@Query('name')` strings and clamp with `Math.min/Math.max`, so a
 * misspelled window parameter is not a 400 — it is silently the DEFAULT
 * window, and the report comes back looking plausible. That is worse than the
 * zod-strips-unknown-keys trap, because there is no schema to read.
 *
 * Verbatim from the handlers, 2026-10-12:
 *
 *   attribution       `dimension`, `days`  (1–90, default 30)
 *   cohorts           `weeks`              (2–26, default 8)   — NOT `days`
 *   response_times    `days`               (1–90, default 30)
 *   sources           `days`               (1–90, default  7)  — not 30
 *   voice             `days`               (1–365, default 30) — not 90
 *   teams, labels     `days`, `from`, `to`, `group_by`, `business_hours`
 *   themes            `date`               (one batch date)
 *   themes/{id}/conversations   nothing at all
 *
 * `group_by` and `business_hours` are SNAKE_CASE on the wire. The typed
 * options below take the camelCase a TS caller expects and map them, so
 * passing `groupBy` cannot quietly become the default granularity.
 *
 * `days`/`weeks` are clamped silently. `from`/`to` must be supplied together
 * or it is a 400, `to <= from` is a 400, a span over the route's maximum is a
 * 400 (explicit ranges are rejected, not clamped), and `group_by: 'hour'`
 * over 14 days is a 400.
 */

/**
 * The 10 dimensions `reports/attribution` accepts — the server's
 * `PAGE_CONTEXT_KEYS`. An unknown value is a 400, not a default.
 *
 * A runtime ARRAY with the type derived from it, not a bare union, because a
 * caller needs the list at runtime to offer or validate a choice. The `chatly`
 * CLI prints it when it refuses a typo, and before this it kept its own second
 * copy to do so.
 *
 * This is deliberately a copy of `PAGE_CONTEXT_KEYS` in `@livechat/shared`
 * rather than an import: this package publishes to npm with ZERO
 * dependencies, so it cannot reach a workspace package.
 * `check-page-context-single-source.mjs` carries the carve-out and the
 * reason, and the parity gate pins the route itself.
 */
export const ATTRIBUTION_DIMENSIONS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'referrer_url',
  'page_url_at_open',
  'device_type',
  'browser',
  'os',
] as const;

export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

export type ReportGranularity = 'hour' | 'day' | 'week' | 'month';

/** The window `reports.teams` and `reports.labels` accept — and only those two. */
export interface ReportRangeQuery {
  /** Clamped 1–366, default 30. Ignored when `from`/`to` are given. */
  days?: number;
  /** `YYYY-MM-DD` or a full ISO instant. Must be paired with `to` or it is a 400. */
  from?: string;
  to?: string;
  /** Sent as `group_by`. `'hour'` over a 14-day span is a 400. */
  groupBy?: ReportGranularity;
  /** Sent as `business_hours`. Only `'true'`/`'1'` read as true server-side. */
  businessHours?: boolean;
}

function rangeQuery(q: ReportRangeQuery): Query {
  return {
    ...(q.days === undefined ? {} : { days: q.days }),
    ...(q.from === undefined ? {} : { from: q.from }),
    ...(q.to === undefined ? {} : { to: q.to }),
    // Snake_case on the wire. `groupBy` is not a parameter the API reads.
    ...(q.groupBy === undefined ? {} : { group_by: q.groupBy }),
    ...(q.businessHours === undefined ? {} : { business_hours: q.businessHours }),
  };
}

export function reportsResource(t: Transport) {
  return {
    overview: (query: Query = {}) => t.get<Unmodelled>('/v1/reports/overview', query),
    agents: (query: Query = {}) => t.get<Unmodelled>('/v1/reports/agents', query),
    conversationsByDay: (query: Query = {}) =>
      t.get<Unmodelled>('/v1/reports/conversations-by-day', query),
    sla: (query: Query = {}) => t.get<Unmodelled>('/v1/reports/sla', query),

    /**
     * Where conversations came from, broken down on one page-context key.
     *
     * A bare ARRAY of rows, not an envelope. `dimension` defaults to
     * `utm_source` when omitted but an unrecognised value is a 400 — the
     * handler calls `isAttributionDimension` and throws before querying, so
     * there is no "unknown dimension falls back" behaviour to lean on.
     * `days` is clamped 1–90.
     */
    attribution: (query: { dimension?: AttributionDimension; days?: number } = {}) =>
      t.get<ReadonlyArray<Unmodelled>>('/v1/reports/attribution', {
        ...(query.dimension === undefined ? {} : { dimension: query.dimension }),
        ...(query.days === undefined ? {} : { days: query.days }),
      }),

    /**
     * The weekly retention grid.
     *
     * The window is **`weeks`**, 2–26, default 8. There is no `days`
     * parameter on this route: sending one is not an error and not a window —
     * it is ignored and you get the default 8 weeks back, with `weeks: 8` in
     * the response echoing the window you did not ask for.
     */
    cohorts: (query: { weeks?: number } = {}) =>
      t.get<Unmodelled>('/v1/reports/cohorts', {
        ...(query.weeks === undefined ? {} : { weeks: query.weeks }),
      }),

    /** `days` 1–90, default 30. */
    responseTimes: (query: { days?: number } = {}) =>
      t.get<Unmodelled>('/v1/reports/response-times', {
        ...(query.days === undefined ? {} : { days: query.days }),
      }),

    /** A bare array of channel rows. `days` 1–90, default **7** — not 30. */
    sources: (query: { days?: number } = {}) =>
      t.get<ReadonlyArray<Unmodelled>>('/v1/reports/sources', {
        ...(query.days === undefined ? {} : { days: query.days }),
      }),

    /** `days` 1–365 here, where the sibling rollups cap at 90. */
    voice: (query: { days?: number } = {}) =>
      t.get<Unmodelled>('/v1/reports/voice', {
        ...(query.days === undefined ? {} : { days: query.days }),
      }),

    /** Per-team rollup. One of the two routes that takes `from`/`to`/`group_by`. */
    teams: (query: ReportRangeQuery = {}) =>
      t.get<Unmodelled>('/v1/reports/teams', rangeQuery(query)),

    /** Per-label rollup, capped at the 50 busiest labels. Same window as `teams`. */
    labels: (query: ReportRangeQuery = {}) =>
      t.get<Unmodelled>('/v1/reports/labels', rangeQuery(query)),

    /**
     * The latest clustered-themes batch.
     *
     * The only window here is **`date`**, and it selects ONE batch date
     * (`YYYY-MM-DD`), not a range. Omit it for the newest batch. `days`,
     * `from` and `to` are not read on this route.
     */
    themes: (query: { date?: string } = {}) =>
      t.get<Unmodelled>('/v1/reports/themes', {
        ...(query.date === undefined ? {} : { date: query.date }),
      }),

    /**
     * The conversation ids in one theme — `{ conversationIds }`.
     *
     * `id` is a THEME id (`conversation_themes.id`), not a conversation id.
     * The route takes no query parameters at all: no cursor, no limit, and
     * the batch cap of 5,000 is the only bound. An unknown or purged id
     * answers 200 with an empty list, not 404.
     */
    themeConversations: (id: string) =>
      t.get<Unmodelled>(`/v1/reports/themes/${encodeURIComponent(id)}/conversations`),
  };
}
