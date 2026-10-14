import type { Query, Transport, Unmodelled } from './common.js';

export function macrosResource(t: Transport) {
  return {
    /**
     * The macro library. NOT cursor-paginated.
     *
     * The handler carries `@PaginationExempt` and answers with a bare array,
     * capped at 200 and ordered by usage rank — so there is no `nextCursor`
     * and no `listAll`. The shared manifest said `paged: true` for a day and
     * two SDKs built a paginator over it; both raised a decode error on the
     * real response while their test suites stayed green, because a fake
     * transport that answers every route with a page envelope agrees with the
     * mistake.
     */
    list: (query: Query = {}) => t.get<ReadonlyArray<Unmodelled>>('/v1/macros', query),
    /**
     * One macro by id.
     *
     * The handler runs `uuidV7Schema.parse(id)` before touching the service,
     * so a v4 id or a slug is a 400 here, not a 404.
     */
    get: (id: string) => t.get<Unmodelled>(`/v1/macros/${encodeURIComponent(id)}`),
    create: (body: Unmodelled) => t.post<Unmodelled>('/v1/macros', body),
    update: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/macros/${encodeURIComponent(id)}`, body),
    /** The only genuine 204 on the whole surface: `@HttpCode(204)`, no body. */
    delete: (id: string) => t.del<void>(`/v1/macros/${encodeURIComponent(id)}`),
    /**
     * The macro-action catalogue: every action key a macro may reference.
     *
     * An OBJECT, `{ limit, actions }` — not the bare array the route name
     * suggests. The array is nested under `actions` and `limit` is the
     * per-macro action ceiling (`MACRO_ACTION_LIMIT`), which a caller needs in
     * order to validate a macro before POSTing it. Reaching for `[0]` on this
     * response gets `undefined`.
     *
     * Worth knowing when you write a macro: a macro row referencing an action
     * the registry no longer has throws **422**, not 400, from both
     * `macros.create` and `macros.update`.
     */
    actions: () => t.get<Unmodelled>('/v1/macros/actions'),
    /**
     * The starter-template catalogue.
     *
     * Also an object — `{ items, total }` — and deliberately NOT a page: there
     * is no `nextCursor` and no `hasMore`, so a client that decodes it as a
     * cursor envelope gets an empty walk. `total` is the whole count, because
     * the list is the whole list.
     */
    templates: () => t.get<Unmodelled>('/v1/macros/templates'),
    /**
     * One template by SLUG, not by id — `@Param('slug')`.
     *
     * The handler deliberately does not check the slug against the enum, so an
     * unknown slug is a 404 rather than a 400.
     */
    template: (slug: string) =>
      t.get<Unmodelled>(`/v1/macros/templates/${encodeURIComponent(slug)}`),
  };
}
