import type { Transport, Unmodelled } from './common.js';

export function brandsResource(t: Transport) {
  return {
    /**
     * Every brand, with usage counts. A bare array, no query parameters at
     * all — the handler reads none.
     *
     * A list element carries a `usage` object (`channels`, `conversations`,
     * `triggers`, `workflows`) that the create/update/delete responses do
     * NOT, so the list row and the single brand are different shapes.
     */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/brands'),
    /**
     * Create a brand. Answers **201**.
     *
     * `name` and `slug` are required. `domain` and `replyDomain` are two
     * different things — the help-centre hostname and the outbound-mail
     * hostname — and `logoUrl`, `primaryColor`, `supportEmail`, `replyDomain`
     * and `icons` are FLAT in the request although they are stored inside a
     * `branding` object and never appear under that name on the wire.
     *
     * `isDefault: true` demotes every other brand.
     */
    create: (body: Unmodelled) => t.post<Unmodelled>('/v1/brands', body),
    /** Every create field, optional — `slug` included. `icons` merges per icon. */
    update: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/brands/${encodeURIComponent(id)}`, body),
    /**
     * Soft-delete. **200 with `{ id }`, not a 204** — the id it retired is the
     * caller's only confirmation.
     *
     * A 409 if the brand is the default, or if any channel still points at it.
     */
    delete: (id: string) => t.del<Unmodelled>(`/v1/brands/${encodeURIComponent(id)}`),
  };
}
