import type { Transport, Unmodelled } from './common.js';

export interface CustomerCardInput {
  /** Letters, digits, underscore and hyphen only, 1–64. */
  key: string;
  title: string;
  /** https, no embedded credentials, no private address — our server fetches it. */
  url: string;
  /** Header NAMES and values. At most 10; the `x-chatly-*` trio is reserved. */
  headers?: Record<string, string>;
  /** REQUIRED. There is no default — omitting it is a 400. */
  ttlSeconds: number;
  enabled?: boolean;
}

export function customerCardsResource(t: Transport) {
  return {
    /**
     * Configured cards. A bare array, header NAMES only — no values, no
     * secrets, ever.
     */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/customer-cards'),
    /**
     * Configure a card. Answers **201**, and it is the only response that
     * carries `secret`.
     *
     * The body is `.strict()`, so an unknown key is a 400 rather than a
     * silent strip — the one place on this surface where a typo is visible.
     * `ttlSeconds` is required.
     */
    create: (body: CustomerCardInput) => t.post<Unmodelled>('/v1/customer-cards', body),
    /**
     * Patch a card. `.strict()` partial, plus `position` (0–1000), which is
     * NOT a create field.
     *
     * An absent field is unchanged; `headers: {}` clears them.
     */
    update: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/customer-cards/${encodeURIComponent(id)}`, body),
    /** New signing secret, shown once. 201, no body up. The old one dies immediately. */
    rotateSecret: (id: string) =>
      t.post<Unmodelled>(`/v1/customer-cards/${encodeURIComponent(id)}/rotate-secret`),
    /** **200 with `{ ok: true }`, not a 204.** */
    delete: (id: string) => t.del<Unmodelled>(`/v1/customer-cards/${encodeURIComponent(id)}`),
  };
}

/**
 * One signing secret per card ENDPOINT, instead of one per card.
 *
 * A single card request carries several cards — Chatly batches by url and
 * headers — and before this it was signed with ONE of their per-card secrets,
 * named to you in `x-chatly-card-id`. So a receiver serving six cards had to
 * hold six secrets and select by that header, and could not predict which it
 * would need: a card still in Chatly's cache is not in the request, so the
 * signer changed with the cache. Give the url its own secret and all of that
 * goes away — one secret, verified once per request, and no
 * `x-chatly-card-id` on the wire at all.
 *
 * **The per-card secret still works.** It is the documented fallback for any
 * url with no endpoint secret, so an existing integration keeps verifying
 * untouched; the endpoint secret takes precedence the moment `create`
 * returns, which is why you deploy it first.
 */
export function customerCardEndpointsResource(t: Transport) {
  return {
    /**
     * A bare array, like `customerCards.list`. `cardKeys` is the cards
     * pointing at each url — empty means that secret signs nothing, which is
     * how you spot a url you re-pointed. Never a secret, a prefix of one or a
     * hash of one: a pending rotation reads `pendingSecretSet: true`.
     */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/customer-card-endpoints'),
    /**
     * Give one card url its own secret. **201 `{ endpoint, secret }`** — one
     * of only two responses that carry the value, and it is `cce_`-prefixed,
     * deliberately not the card's `cc_`.
     *
     * Deploy the secret to your endpoint BEFORE calling this: from the moment
     * it returns, every request to that url is signed with it.
     *
     * The url is compared byte for byte against your cards' urls, trailing
     * slash included, and a url no configured card uses is a 400 rather than
     * a secret that silently never signs anything. A url that already has one
     * is a 409 — rotate it instead.
     */
    create: (url: string) => t.post<Unmodelled>('/v1/customer-card-endpoints', { url }),
    /**
     * Mint the NEXT secret. **It signs nothing yet** — the response carries
     * `active: false`, and the current secret keeps signing until
     * `activateSecret`.
     *
     * That two-step IS the overlap window, and it is an order of operations
     * rather than a span of time: Chatly emits one signature per request, so
     * there is nothing a time window could overlap. Mint, deploy, activate.
     * Calling this again before activating replaces the pending secret.
     */
    rotateSecret: (id: string) =>
      t.post<Unmodelled>(`/v1/customer-card-endpoints/${encodeURIComponent(id)}/rotate-secret`),
    /**
     * Promote the pending secret. From here it is the only one that signs and
     * the previous one is gone. A 409 if nothing is pending.
     */
    activateSecret: (id: string) =>
      t.post<Unmodelled>(`/v1/customer-card-endpoints/${encodeURIComponent(id)}/activate-secret`),
    /**
     * Remove the endpoint secret. **200 with `{ ok: true }`.** Signing for
     * that url reverts to the leading card's own secret and
     * `x-chatly-card-id` comes back — a change at your verifier, not a
     * cleanup.
     */
    delete: (id: string) =>
      t.del<Unmodelled>(`/v1/customer-card-endpoints/${encodeURIComponent(id)}`),
  };
}
