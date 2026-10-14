import { listable, listableAt } from '../pagination.js';

import type { Transport, Unmodelled } from './common.js';

export interface MergeContactInput {
  /** The contact to merge INTO the target, and then retire. `contactMergeSchema`. */
  mergedId: string;
}

export interface UnsubscribeContactInput {
  /** Required. `false` re-subscribes. */
  unsubscribed: boolean;
  reason?: string;
}

export interface ContactInput {
  externalId?: string;
  email?: string;
  phone?: string;
  name?: string;
  attributes?: Record<string, unknown>;
}

export function contactsResource(t: Transport) {
  const journeyPages = listableAt<Unmodelled>(
    t,
    (id) => `/v1/contacts/${encodeURIComponent(id)}/journey`,
  );
  return {
    ...listable<Unmodelled>(t, '/v1/contacts'),
    get: (id: string) => t.get<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}`),
    upsert: (body: ContactInput) => t.post<Unmodelled>('/v1/contacts', body),
    /** Up to the API's documented batch ceiling per call. One idempotency key covers the batch. */
    bulkUpsert: (contacts: ReadonlyArray<ContactInput>) =>
      t.post<Unmodelled>('/v1/contacts/bulk', { contacts }),
    merge: (id: string, body: MergeContactInput) =>
      t.post<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/merge`, body),
    /**
     * Add ONE tag. The route's body is `{ tag }`, singular.
     *
     * Kept plural in the cross-language manifest (`contacts.add_tags`) because
     * eight SDKs have locked that name, but the wire shape is one tag per
     * call: loop for several. This sent `{ tags: [...] }`, which zod dropped,
     * so it returned 200 and added nothing.
     */
    addTags: (id: string, tag: string) =>
      t.post<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/tags`, { tag }),
    removeTag: (id: string, tag: string) =>
      t.del<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`),
    /**
     * Opt the contact out of outbound email, or back in.
     *
     * `unsubscribed` is required — there is no default, and omitting it is a
     * 400. Honoured across campaigns and workflows.
     */
    unsubscribe: (id: string, body: UnsubscribeContactInput) =>
      t.post<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/unsubscribe`, body),
    /**
     * The contact's timeline: conversations, events and tickets, in one
     * ordered read. Cursor-paginated — `journeyAll` walks it.
     *
     * The cursor here is an ISO-8601 instant rather than an opaque string,
     * which is why the shared manifest failed to flag this route as paged for
     * a day. It is still a cursor: walk it, never construct one.
     */
    journey: journeyPages.page,
    journeyAll: journeyPages.all,
    /**
     * The operator's live customer cards for this contact. Answers **201**.
     *
     * A POST that is a READ. It is not a create: the create is
     * `customerCards.create`. POST rather than GET because the response is
     * per contact and per conversation, is cacheable by nobody, and a GET
     * would put a conversation id in access logs beside the contact's email.
     *
     * The path parameter is `contactId` here, not `id` — the only contacts
     * route spelled that way. The body is `.strict()` with one optional
     * field, `conversationId`, so `{}` always goes up (an absent body is a
     * 400) and any other key is a 400 rather than a silent strip.
     *
     * The collection key in the response is **`cards`**, not `items`. An
     * unknown contact answers `{ cards: [] }`, not a 404.
     */
    cards: (contactId: string, body: { conversationId?: string } = {}) =>
      t.post<Unmodelled>(`/v1/contacts/${encodeURIComponent(contactId)}/cards`, body),
    /**
     * Weekly sentiment buckets.
     *
     * The window is `days`, and its FLOOR is 7 — not 1, the way the sibling
     * `journey` route's `days` is. Max 365, default 90. No cursor, no limit.
     * Empty `buckets` is a normal "not enough signal" answer.
     */
    mood: (id: string, query: { days?: number } = {}) =>
      t.get<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/mood`, {
        ...(query.days === undefined ? {} : { days: query.days }),
      }),
  };
}
