import type { Transport, Unmodelled } from './common.js';

/** `providerSchema` — the five docs providers. */
export type DocsProvider =
  | 'gitbook'
  | 'forumulate'
  | 'discourse'
  | 'readme'
  | 'website'
  | 'notion'
  | 'confluence'
  | 'zendesk'
  | 'intercom'
  | 'github';

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
  /**
   * The language every page in this source is written in, unless the page
   * itself declares one. Accepted for EVERY provider, unlike the path
   * filters above — it is the only answer for the ones that declare nothing
   * (ReadMe's API has no language concept at all) and for a documentation
   * site whose template omits `lang`.
   *
   * A BCP-47 tag — `es`, `pt-BR`, `zh-Hant`. **Refused with a 400 rather
   * than truncated or ignored** if it is not one, because the value reaches
   * `kb_articles.locale`, a help-centre URL path and an `<html lang>`
   * attribute. Casing is normalised server-side, so `pt-br` is stored and
   * echoed back as `pt-BR`.
   *
   * It LOSES to a language the page declares, so setting it can never
   * relabel a page whose language was already known. To split a space that
   * publishes two languages, connect it twice with `includePaths` and give
   * each source its own tag.
   *
   * On `update` it is the same field plus a third state: `null` CLEARS it
   * (RFC 7396 merge), which restores silence — the next sync writes no
   * language and every stored value stands. `update`'s body is `Unmodelled`,
   * as it is for every other field, so that is not a separate type here.
   */
  defaultLocale?: string;
  /**
   * The language every page is written in EVEN IF the page declares another.
   *
   * Use this only when the pages are genuinely wrong — the case it exists for
   * is a CMS that stamps `lang="en"` on every page of a translation, where
   * `defaultLocale` cannot help because the pages are not silent.
   *
   * **The asymmetry matters more than the feature.** `defaultLocale` loses to
   * a page's declaration, so a mistake in it can never relabel an article
   * that was already correct. This one wins, so a mistake labels EVERY
   * article in the source with a language its readers are not asking for,
   * which hides all of them. Two separate fields rather than one with a flag,
   * deliberately: the safe one must not be reachable into the dangerous one
   * by accident.
   *
   * Same tag rules and the same `null`-clears behaviour on `update`. Clearing
   * restores believing the page, and the next sync relabels everything back.
   */
  forceLocale?: string;
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
