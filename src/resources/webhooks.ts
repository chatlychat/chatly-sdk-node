import { listable } from '../pagination.js';

import type { Transport, Unmodelled } from './common.js';

export interface CreateWebhookInput {
  url: string;
  description?: string;
  /**
   * **`eventTypes`, not `events`.** Required and at least one, validated
   * against a closed 41-value allow-list — an unknown name is a 400.
   *
   * Three old spellings are refused on purpose: `ticket.transitioned` is now
   * `ticket.status_changed` and `survey.submitted` is now
   * `survey.response_received`.
   */
  eventTypes: ReadonlyArray<string>;
  /** Omitted, the endpoint takes the latest. An unrecognised id is a 400 here. */
  schemaVersion?: string;
}

export function webhooksResource(t: Transport) {
  const deliveryPages = listable<Unmodelled>(t, '/v1/webhooks/deliveries');
  return {
    /**
     * The webhook ENDPOINTS, a bare array.
     *
     * Note the rename: this used to be the delivery page, which is now
     * `deliveries`/`deliveriesAll`. The manifest names the two
     * `webhooks.list` (this, `GET /v1/webhooks`) and `webhooks.deliveries`
     * (`GET /v1/webhooks/deliveries`), and having `list` point at the second
     * one meant there was no method at all for the first.
     *
     * No `secret` comes back here — only the create response ever carries it.
     */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/webhooks'),
    /**
     * Register an endpoint. Answers **201**, and it is the ONLY response that
     * carries `secret` — there is no reveal route and no rotation route, so
     * store it when you get it.
     *
     * You do not supply the secret; the server mints it.
     */
    create: (body: CreateWebhookInput) => t.post<Unmodelled>('/v1/webhooks', body),
    /**
     * Remove an endpoint. `{ ok: true }` with a 200, not a 204.
     *
     * Opened to API keys on 2026-10-14 for the reason the create route
     * already made: a key that can ADD a delivery target and not remove one
     * can only ever add. The workaround that was recommended instead —
     * pointing the endpoint at a dead URL — leaves the subscription alive and
     * the delivery log filling with failures, which is worse.
     *
     * It was missing from the manifest for a day after the decorator went on,
     * and three SDK authors found it independently by reading the handler.
     */
    delete: (id: string) => t.del<Unmodelled>(`/v1/webhooks/${encodeURIComponent(id)}`),
    /**
     * The subscribable event catalogue.
     *
     * An object, `{ eventTypes: [...] }` — a single key wrapping a flat array
     * of NAMES. No descriptions, no grouping, and nothing per-workspace.
     */
    events: () => t.get<Unmodelled>('/v1/webhooks/events'),
    /** `{ latest, versions }`, oldest first. `isDeprecated` is advisory only. */
    schemaVersions: () => t.get<Unmodelled>('/v1/webhooks/schema-versions'),
    /**
     * Pin one endpoint to a schema version.
     *
     * The body field is **`schemaVersion`** and the schema is `.strict()`, so
     * `{ version }` is a 400 rather than a silent no-op — which is lucky,
     * because `GET /v1/webhooks/schema-versions` calls the same thing
     * `versions[].version`. The two names are not interchangeable.
     *
     * `missingEventTypes` in the response is a list of event NAMES you would
     * gain by upgrading, not a count.
     */
    setSchemaVersion: (id: string, schemaVersion: string) =>
      t.patch<Unmodelled>(`/v1/webhooks/${encodeURIComponent(id)}/schema-version`, {
        schemaVersion,
      }),

    /**
     * The delivery log, cursor-paginated. `deliveriesAll` walks it.
     *
     * Built by `buildPaginatedResponse`, so the envelope carries `hasMore`
     * beside `items` and `nextCursor`.
     */
    deliveries: deliveryPages.list,
    deliveriesAll: deliveryPages.listAll,
    /** One delivery, with its request, response and attempt history. */
    delivery: (id: string) =>
      t.get<Unmodelled>(`/v1/webhooks/deliveries/${encodeURIComponent(id)}`),
    /** Send it again. The receiver sees the same payload with a fresh signature. */
    redeliver: (id: string) =>
      t.post<Unmodelled>(`/v1/webhooks/deliveries/${encodeURIComponent(id)}/redeliver`),
  };
}
