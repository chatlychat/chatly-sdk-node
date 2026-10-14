import type { Transport, Unmodelled } from './common.js';

/** `providerSchema` — the five docs providers. */
export type DocsProvider = 'gitbook' | 'forumulate' | 'discourse' | 'readme' | 'website';

export interface DiscoverDocsInput {
  provider: DocsProvider;
  /**
   * REQUIRED, and `''` is legal: a public Discourse category needs no key and
   * the sitemap crawler reads only what any visitor can.
   */
  token: string;
  /** Schema-optional, but a 400 for any self-hosted provider that needs an address. */
  baseUrl?: string;
}

export interface CreateDocsSourceInput {
  provider: DocsProvider;
  /** REQUIRED; may be the empty string. */
  token: string;
  baseUrl?: string;
  /** REQUIRED. `organizationId`, not `orgId`. */
  organizationId: string;
  /** REQUIRED. `spaceId`, not `space`. Both come from `discover`. */
  spaceId: string;
  label?: string;
  /** `publishOnSync`, not `publish`. */
  publishOnSync?: boolean;
  /** `syncIntervalMinutes`, not `interval`. 15–10080. */
  syncIntervalMinutes?: number;
  /** Forumulate and sitemap-read sites only; a 400 for the other providers. */
  includePaths?: ReadonlyArray<string>;
  excludePaths?: ReadonlyArray<string>;
}

export function docsSourcesResource(t: Transport) {
  return {
    /** Connected sources. A bare array; no query parameters. */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/docs-sources'),
    /** The static provider registry — `{ name, label, needsBaseUrl, needsToken }`. */
    providers: () => t.get<ReadonlyArray<Unmodelled>>('/v1/docs-sources/providers'),
    /**
     * List the spaces a credential can see, before connecting one. Answers
     * **201** with a bare array.
     *
     * The three fields are FLAT — `provider`, `token`, `baseUrl`. There is no
     * `credentials` wrapper, which is the shape most people reach for first.
     * An item's `id` and `organizationId` are what `create` wants as
     * `spaceId` and `organizationId`.
     *
     * It writes nothing and still requires an `Idempotency-Key`, because the
     * controller declares it class-wide; the SDK always sends one.
     */
    discover: (body: DiscoverDocsInput) =>
      t.post<ReadonlyArray<Unmodelled>>('/v1/docs-sources/discover', body),
    /** Connect a space. Answers **201**. No field ever carries the token back. */
    create: (body: CreateDocsSourceInput) => t.post<Unmodelled>('/v1/docs-sources', body),
    /**
     * Patch a source. All fields optional.
     *
     * `status` accepts only `'active'` and `'paused'` — `'error'` is a
     * read-only state. The limits differ from create for no reason worth
     * relying on: `token` is 1–500 here against max 400 there, and `baseUrl`
     * 500 against 300.
     *
     * Send at least `{}`: the body is parsed, and an absent body is a 400.
     */
    update: (id: string, body: Unmodelled = {}) =>
      t.patch<Unmodelled>(`/v1/docs-sources/${encodeURIComponent(id)}`, body),
    /**
     * Disconnect. **200 with `{ kept }`, not a 204** — how many articles
     * stayed behind. None are deleted.
     */
    delete: (id: string) => t.del<Unmodelled>(`/v1/docs-sources/${encodeURIComponent(id)}`),
    /**
     * Queue a sync. Answers **201** with `{ queued: true, full }`.
     *
     * The flag is **`full`**, not `force` and not `fullSync`; it drops the
     * incremental watermark first. Default false, because a scheduled sync
     * must stay a delta or every space is re-read on every pass.
     *
     * The body is parsed even when empty, so `{}` always goes up.
     */
    sync: (id: string, body: { full?: boolean } = {}) =>
      t.post<Unmodelled>(`/v1/docs-sources/${encodeURIComponent(id)}/sync`, body),
    /**
     * Ask the PROVIDER to start pushing change events to us. Answers **201**
     * with `{ subscribed, reason? }`.
     *
     * This is a subscribe, not a receiver — despite the path. The inbound
     * receiver is a different, `@Public()` route (`POST
     * /v1/webhooks/docs/{sourceId}`) which is correctly absent from the
     * manifest and must never get an API-key SDK method.
     *
     * `subscribed: false` with a `reason` is a SUCCESS, not an error: a
     * read-only token cannot manage webhooks, which is the common case and a
     * fact to report rather than throw on.
     */
    webhook: (id: string) =>
      t.post<Unmodelled>(`/v1/docs-sources/${encodeURIComponent(id)}/webhook`),
  };
}
