import { listable } from '../pagination.js';

import type { Query, Transport, Unmodelled } from './common.js';

export interface MergeTicketsInput {
  /**
   * The ticket that LOSES — it is closed and its history moves to the one in
   * the path. `{ loserId }`, not `{ sourceTicketId }`: a merge can only be
   * read one way and the route is `:winnerId/merge`.
   */
  loserId: string;
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
    /**
     * The conversations a ticket covers. A bare array.
     *
     * `subject`, `status` and `channelType` are nullable: the join is a LEFT
     * one, so a hard-deleted conversation still yields a row.
     */
    conversations: (id: string) =>
      t.get<ReadonlyArray<Unmodelled>>(`/v1/tickets/${encodeURIComponent(id)}/conversations`),
    /** Splits and follow-ups, both directions, each list capped at 25. */
    lineage: (id: string) => t.get<Unmodelled>(`/v1/tickets/${encodeURIComponent(id)}/lineage`),
    /**
     * Status transitions, oldest first.
     *
     * An OBJECT, not an array: `{ ticketId, status, currentStatusForSeconds,
     * items, truncated }`. The three siblings are not derivable from the rows
     * — `status` comes from the ticket, not the last transition — and
     * `truncated` is what distinguishes a capped timeline from a short one.
     * There is no cursor, so beyond 500 transitions the rest are simply not
     * fetchable.
     */
    statusHistory: (id: string) =>
      t.get<Unmodelled>(`/v1/tickets/${encodeURIComponent(id)}/status-history`),
    /**
     * Logged time: `{ items, totalMinutes, billableMinutes }`.
     *
     * Another `items` without a `nextCursor` — an object, not a page.
     */
    time: (id: string) => t.get<Unmodelled>(`/v1/tickets/${encodeURIComponent(id)}/time`),
    /**
     * How many open tickets a CONVERSATION has — `{ openTickets }`.
     *
     * The path parameter is a conversation id, not a ticket id and not a
     * queue id, which the route's shape invites you to assume. A conversation
     * the key cannot see raises rather than answering 0.
     */
    openCount: (conversationId: string) =>
      t.get<Unmodelled>(`/v1/tickets/open-count/${encodeURIComponent(conversationId)}`),
  };
}
