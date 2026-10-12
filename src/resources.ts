import { listable, type Page, type PageQuery } from './pagination.js';
import type { Query, Transport } from './transport.js';

/*
 * The typed route surface.
 *
 * Every method here is one entry in `packages/sdk-spec/surface.json`, the
 * manifest all ten Chatly SDKs implement; `scripts/check-sdk-surface-parity.mjs`
 * fails if any of them drifts from it. Each is a key-accessible route — it
 * carries `@AllowApiKey()` in the API. A route that does not is NOT surface,
 * because a `ck_` key gets 403 from it, and shipping a method that always
 * fails is worse than not shipping it: the failure arrives at runtime, in
 * production, in someone else's integration.
 *
 * Reactions and channel configuration were here once and neither worked. A
 * reaction records *who* reacted and a key is not a person; channel writes
 * need `channels:write`, which no key-accessible route grants.
 *
 * There is no HTTP in this file. Paths and bodies only — the transport owns
 * auth, idempotency, retries and the error model, which is what keeps all 55
 * routes behaving the same way.
 */

/**
 * ── These shapes are READ OFF THE ZOD SCHEMAS, not guessed ───────────────
 *
 * The API validates every body with zod and zod DROPS unknown keys. A write
 * with the wrong key name therefore returns 200 having done nothing, which no
 * caller can distinguish from success. Three of this SDK's own writes were
 * built that way until the Ruby SDK's author read the controllers:
 *
 *   contacts.merge        sent { sourceContactId } — schema wants { mergedId }
 *   contacts.addTags      sent { tags: [...] }     — schema wants { tag }, ONE
 *   contacts.unsubscribe  sent { }                 — `unsubscribed` is REQUIRED
 *
 * The first two silently did nothing. The third 400'd, which is the lucky
 * case. If you add a method here, open the schema.
 */
export interface MergeContactInput {
  /** The contact to merge INTO the target, and then retire. `contactMergeSchema`. */
  mergedId: string;
}

export interface UnsubscribeContactInput {
  /** Required. `false` re-subscribes. */
  unsubscribed: boolean;
  reason?: string;
}

export interface AgentHandlingInput {
  /** `setAgentHandlingSchema` — the settable states, not the read states. */
  state: string;
  reason?: string | null;
}

export interface ScheduleMessageInput {
  body: string;
  /** ISO 8601 with offset. */
  sendAt: string;
}

export interface ContactInput {
  externalId?: string;
  email?: string;
  phone?: string;
  name?: string;
  attributes?: Record<string, unknown>;
}

export interface MessageInput {
  conversationId: string;
  body: string;
  /**
   * Mirrors `messageKindSchema`, all five members.
   *
   * `attachment_only` was missing here — the union listed four — so TypeScript
   * refused the one kind you send when there are no words, only a file.
   */
  kind?: 'text' | 'rich' | 'note' | 'system_event' | 'attachment_only';
}

export interface MergeTicketsInput {
  /**
   * The ticket that LOSES — it is closed and its history moves to the one in
   * the path. `{ loserId }`, not `{ sourceTicketId }`: a merge can only be
   * read one way and the route is `:winnerId/merge`.
   */
  loserId: string;
}

export interface TrackEventInput {
  contactId: string;
  name: string;
  properties?: Record<string, unknown>;
}

/** Query for `events.list` — a page, optionally one contact's. */
export interface EventListQuery extends PageQuery {
  /** Restrict the stream to one contact. Omit for the whole workspace. */
  contactId?: string;
}

/** A result shape we do not model field-by-field. The API validates; we pass through. */
export type Unmodelled = Record<string, unknown>;

export function contactsResource(t: Transport) {
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
      t.del<void>(`/v1/contacts/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`),
    /**
     * Opt the contact out of outbound email, or back in.
     *
     * `unsubscribed` is required — there is no default, and omitting it is a
     * 400. Honoured across campaigns and workflows.
     */
    unsubscribe: (id: string, body: UnsubscribeContactInput) =>
      t.post<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/unsubscribe`, body),
    /** The contact's timeline: conversations, events, tickets, in one ordered read. */
    journey: (id: string, query: Query = {}) =>
      t.get<Unmodelled>(`/v1/contacts/${encodeURIComponent(id)}/journey`, query),
  };
}

export function conversationsResource(t: Transport) {
  return {
    ...listable<Unmodelled>(t, '/v1/conversations'),
    get: (id: string) => t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}`),
    /**
     * Read a thread before replying to it.
     *
     * The MCP server has exposed this as `get_messages` since it shipped and
     * the SDK did not, so an integrator writing "read the conversation, then
     * decide" against the SDK had to hand-roll the request while the same
     * capability sat behind a tool call.
     */
    messages: (conversationId: string, query: PageQuery & Query = {}) =>
      t.get<Page<Unmodelled>>(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        query,
      ),
    send: (body: MessageInput) =>
      t.post<Unmodelled>(
        `/v1/conversations/${encodeURIComponent(body.conversationId)}/messages`,
        body,
      ),
    /** Open conversations with no agent reply yet — the queue a bot or a rota works from. */
    unattended: (query: Query = {}) => t.get<Unmodelled>('/v1/conversations/unattended', query),
    /** Is a human or a bot driving this thread right now. */
    agentHandling: (id: string) =>
      t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/agent-handling`),
    /** Hand the thread to a bot, or take it back. `{ state, reason? }`. */
    setAgentHandling: (id: string, body: AgentHandlingInput) =>
      t.put<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/agent-handling`, body),
    /** Drafts the AI produced for this thread, newest first. */
    generatedReplies: (id: string, query: Query = {}) =>
      t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/generated-replies`, query),
    /** Ask for a draft now. Returns the draft; it is not sent until you send it. */
    generateReply: (id: string, body: Unmodelled = {}) =>
      t.post<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/generated-replies`, body),
    scheduledMessages: (id: string, query: Query = {}) =>
      t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/scheduled-messages`, query),
    scheduleMessage: (id: string, body: ScheduleMessageInput) =>
      t.post<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/scheduled-messages`, body),
    cancelScheduled: (scheduledId: string) =>
      t.del<void>(`/v1/conversations/scheduled-messages/${encodeURIComponent(scheduledId)}`),
  };
}

export function ticketsResource(t: Transport) {
  return {
    ...listable<Unmodelled>(t, '/v1/tickets'),
    comments: (id: string, query: Query = {}) =>
      t.get<Unmodelled>(`/v1/tickets/${encodeURIComponent(id)}/comments`, query),
    /** The ticket auto-created from a conversation, if there is one. */
    forConversation: (conversationId: string) =>
      t.get<Unmodelled>(`/v1/tickets/for-conversation/${encodeURIComponent(conversationId)}`),
    queues: () => t.get<Unmodelled>('/v1/tickets/queues'),
    /** `id` is the WINNER; the body names the loser. */
    merge: (id: string, body: MergeTicketsInput) =>
      t.post<Unmodelled>(`/v1/tickets/${encodeURIComponent(id)}/merge`, body),
    split: (id: string, body: Unmodelled) =>
      t.post<Unmodelled>(`/v1/tickets/${encodeURIComponent(id)}/split`, body),
    /** One status, assignee or queue change applied to many tickets under one key. */
    bulk: (body: Unmodelled) => t.post<Unmodelled>('/v1/tickets/bulk', body),
  };
}

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
    create: (body: Unmodelled) => t.post<Unmodelled>('/v1/macros', body),
    update: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/macros/${encodeURIComponent(id)}`, body),
    delete: (id: string) => t.del<void>(`/v1/macros/${encodeURIComponent(id)}`),
  };
}

export function kbResource(t: Transport) {
  return {
    ...listable<Unmodelled>(t, '/v1/kb/articles'),
    /** One article by slug — the same slug the help centre serves it under. */
    article: (slug: string) => t.get<Unmodelled>(`/v1/kb/articles/${encodeURIComponent(slug)}`),
    collections: () => t.get<Unmodelled>('/v1/kb/collections'),
  };
}

export function searchResource(t: Transport) {
  return {
    /** Full-text across contacts, conversations, messages, tickets and the KB. */
    query: (q: string, opts: Query = {}) => t.get<Unmodelled>('/v1/search', { q, ...opts }),
    /**
     * Help-centre articles only.
     *
     * Sends `kinds=kb` as a repeated PLAIN key. It used to send `kinds[]=kb`,
     * and `searchQuerySchema` is an object schema, so zod stripped the
     * bracketed key and the search ran UNNARROWED — this method returned
     * contacts, conversations, messages and tickets with a 200 and nothing to
     * indicate the filter had been ignored. The MCP server's `search_kb` tool
     * and the dashboard sent the same spelling. The schema now folds
     * `kinds[]` and a scalar `kinds` as well, but the plain repeated key is
     * the form to send.
     */
    kb: (q: string, opts: Query = {}) =>
      t.get<Unmodelled>('/v1/search', { q, kinds: ['kb'], ...opts }),
  };
}

export function eventsResource(t: Transport) {
  const page = listable<Unmodelled>(t, '/v1/cdp/events');
  return {
    track: (input: TrackEventInput) => t.post<Unmodelled>('/v1/cdp/events', input),
    /**
     * Read back what was tracked — the same `/v1/cdp/events` collection
     * `track` writes to, cursor-paginated newest-first.
     *
     * The SDK could write events and never read them, so "did my tracking
     * call actually land?" had no answer outside the dashboard. Pass
     * `contactId` to scope the stream to one person.
     */
    list: (query: EventListQuery = {}) => page.list(query as PageQuery & Query),
    listAll: page.listAll,
  };
}

export function webhooksResource(t: Transport) {
  return {
    ...listable<Unmodelled>(t, '/v1/webhooks/deliveries'),
    /** One delivery, with its request, response and attempt history. */
    delivery: (id: string) =>
      t.get<Unmodelled>(`/v1/webhooks/deliveries/${encodeURIComponent(id)}`),
    /** Send it again. The receiver sees the same payload with a fresh signature. */
    redeliver: (id: string) =>
      t.post<Unmodelled>(`/v1/webhooks/deliveries/${encodeURIComponent(id)}/redeliver`),
  };
}

export function reportsResource(t: Transport) {
  return {
    overview: (query: Query = {}) => t.get<Unmodelled>('/v1/reports/overview', query),
    agents: (query: Query = {}) => t.get<Unmodelled>('/v1/reports/agents', query),
    conversationsByDay: (query: Query = {}) =>
      t.get<Unmodelled>('/v1/reports/conversations-by-day', query),
    sla: (query: Query = {}) => t.get<Unmodelled>('/v1/reports/sla', query),
  };
}

export function channelsResource(t: Transport) {
  return {
    list: (query: Query = {}) => t.get<Unmodelled>('/v1/channels', query),
    get: (id: string) => t.get<Unmodelled>(`/v1/channels/${encodeURIComponent(id)}`),
  };
}

export function billingResource(t: Transport) {
  return {
    /** The plan catalogue this deployment can actually sell. */
    plans: () => t.get<Unmodelled>('/v1/billing/plans'),
    /**
     * Usage for ONE meter over a window.
     *
     * `eventType` is required — the handler validates it against a closed
     * list and throws before doing anything else, so a call without it is a
     * 400, not a summary of everything. Four SDKs shipped this as an
     * optional argument and one sent no query at all, which made it a method
     * that could never succeed.
     */
    usage: (eventType: string, range: { from?: string; to?: string } = {}) =>
      t.get<Unmodelled>('/v1/billing/usage', { eventType, ...range }),
  };
}

export function workspaceResource(t: Transport) {
  return {
    settings: () => t.get<Unmodelled>('/v1/workspace/settings'),
    labels: () => t.get<Unmodelled>('/v1/labels'),
    inboxes: () => t.get<Unmodelled>('/v1/inboxes'),
    /**
     * One team's roster. The only team read an API key can make.
     *
     * The workspace-wide `GET /v1/teams` list carries no `@AllowApiKey()` —
     * it reads a calling user id, and a key is not a person — so it answers
     * every key with 403. This manifest listed it anyway for a day, because
     * the script that derived the key-accessible surface took the nearest
     * `@AllowApiKey()` in either direction and credited the list route with
     * the decorator belonging to this one. Get a team id from a workflow, an
     * inbox's `settings.routingTeamId`, or a conversation's `teamId`.
     */
    teamMembers: (teamId: string) =>
      t.get<Unmodelled>(`/v1/teams/${encodeURIComponent(teamId)}/members`),
    /**
     * The workspace's skill taxonomy — the distinct labels routing matches on.
     *
     * `GET /v1/agents` has no handler at all; the agents controller serves
     * only `/agents/skills` and `/agents/{userId}/skills`. There is no
     * key-accessible way to list the people with a seat here.
     */
    agentSkills: () => t.get<Unmodelled>('/v1/agents/skills'),
  };
}
