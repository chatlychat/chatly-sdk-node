import { listable, listableAt } from '../pagination.js';

import type { Query, Transport, Unmodelled } from './common.js';

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

/**
 * What `recordOutcome` sends.
 *
 * `valueCents` and `currency` are REFUSED by the API on anything but
 * `purchased` — a 400, not a silently dropped field, because a caller who
 * believed a value was recorded is worse off than one who got an error. And
 * `outcomeRef` is REQUIRED on `purchased`: your own order id, unique per
 * workspace forever, enforced by a unique index. It is what makes a retry a
 * no-op instead of a second purchase, and it is the only such guard on the
 * `cb_` bot surface, which takes no `Idempotency-Key` header at all.
 */
export interface ConversationOutcomeInput {
  outcome: 'resolved' | 'escalated' | 'purchased';
  /** Required in practice on `escalated` — it is what the human picking the thread up reads. */
  reason?: string;
  /** Pin it to a message — your own last reply, usually. */
  messageId?: string;
  /** `purchased` only. The minor unit of `currency`. */
  valueCents?: number;
  /** `purchased` only. ISO-4217, three letters. */
  currency?: string;
  /** `purchased` only, and required there. Your order id. */
  outcomeRef?: string;
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

export function conversationsResource(t: Transport) {
  const messagePages = listableAt<Unmodelled>(
    t,
    (id) => `/v1/conversations/${encodeURIComponent(id)}/messages`,
  );
  const unattendedPages = listable<Unmodelled>(t, '/v1/conversations/unattended');
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
    messages: messagePages.page,
    /**
     * Every message in the thread, oldest cursor first.
     *
     * This was missing: the route is cursor-paginated and the manifest flags
     * it, and nothing connected that flag to this SDK until a test read the
     * manifest and asked.
     */
    messagesAll: messagePages.all,
    send: (body: MessageInput) =>
      t.post<Unmodelled>(
        `/v1/conversations/${encodeURIComponent(body.conversationId)}/messages`,
        body,
      ),
    /**
     * Open conversations with no agent reply yet — the queue a bot or a rota
     * works from. Cursor-paginated; `unattendedAll` walks it.
     *
     * The envelope carries `total` beside `items`/`nextCursor` — the badge
     * number, which ignores the cursor.
     */
    unattended: unattendedPages.list,
    unattendedAll: unattendedPages.listAll,
    /** Is a human or a bot driving this thread right now. */
    agentHandling: (id: string) =>
      t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/agent-handling`),
    /** Hand the thread to a bot, or take it back. `{ state, reason? }`. */
    setAgentHandling: (id: string, body: AgentHandlingInput) =>
      t.put<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/agent-handling`, body),
    /**
     * Hand an open thread back to an assistant, after a human took it.
     * Answers **201** with `{ returned: true, conversationId, botId, botName, returnedAt }`.
     *
     * The reverse of an escalation, and it did not exist before 2026-10-13:
     * handoff was one-directional, so once a person answered one question the
     * assistant was out of the conversation for good.
     *
     * `botId` is REQUIRED and is not defaulted to whoever owned it before. A
     * thread three assistants have touched has no obvious "the" bot, and
     * guessing wrong means the visitor talks to the returns agent about a
     * size exchange. `bots.list()` has the choices.
     *
     * Refuses, rather than quietly doing nothing:
     *   - a `pending` conversation — a human was summoned and has not
     *     finished, and answering over a colleague mid-reply is worse than
     *     silence;
     *   - `snoozed`, `closed` or `merged` — a promise, or somebody's
     *     deliberate end;
     *   - a `paused` or `draft` bot, which would answer nothing while the
     *     thread had left the human queue.
     *
     * A thread that bot ALREADY owns is a success and a no-op, not a 409: a
     * retry, or two teammates pressing the same button, should not fail for
     * a state that is already what was asked for.
     *
     * Distinct from `setAgentHandling`, which is a BYO agent reporting its
     * own progress — that route can only make the caller the owner or stop
     * being one. This one moves a thread to somebody else, which is why it
     * needs `conversations:assign` rather than `conversations:write`.
     */
    returnToBot: (id: string, body: { botId: string }) =>
      t.post<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/return-to-bot`, body),
    /**
     * Report how a conversation ended, so the AI funnels count it. **201.**
     *
     * Three words, and each one is written where a report already looks:
     *
     *   `resolved`   an `ai_resolutions` row with `source = 'agent_report'`
     *                (migration 0609). The deflection funnel's AI-resolved
     *                bucket and the per-assistant funnel's `resolvedByAi`
     *                both count it — the same bucket the visitor's own
     *                "✓ This answered" chip lands in. This is the word that
     *                did not exist before: that table had one writer, the
     *                widget chip, and the fallback heuristic needs
     *                `closed_at`, which no bot can set.
     *   `escalated`  `EscalationsService`, which is not merely a record: the
     *                conversation moves to `pending`, bot ownership is
     *                released and your `reason` is posted to the receiving
     *                human as an internal note. The SAME effect as the bot
     *                surface's `POST /v1/bot/conversations/{id}/handoff`,
     *                reported in outcome vocabulary.
     *   `purchased`  a `conversation.purchased` event on the contact. It can
     *                complete a conversion goal (`goals` with
     *                `triggerKind: 'cdp_event'`) and it shows on the contact
     *                timeline.
     *
     * **Chatly has no revenue report.** `valueCents` is stored on the event
     * and summed by nothing — stated here, in the response's `feeds` field
     * and in the guide, because the one wrong conclusion to draw is that this
     * populates a revenue dashboard.
     *
     * Nothing here CLOSES the conversation. Reporting an outcome is
     * reporting, not finishing.
     *
     * `created: false` in the response means an equal outcome was already on
     * record and this call changed nothing — a replayed resolution inside
     * 24h, an escalation inside 60s, or a purchase whose `outcomeRef` we
     * already hold. It is a success either way.
     */
    recordOutcome: (id: string, body: ConversationOutcomeInput) =>
      t.post<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/outcomes`, body),
    /**
     * What is already on record for this thread — `{ conversationId, items }`.
     *
     * An object that CARRIES `items` and has no cursor, like `linked`: read
     * `items` yourself rather than pointing a paginator at it. Merged from
     * three tables, newest first, each arm capped at 20.
     *
     * Every row carries `source`, and that is the field to read: it tells
     * your own `agent_report` apart from the visitor's `visitor_chip`, and an
     * escalation a human requested (`agent_request`) apart from one a bot
     * gave up on (`bot_handoff`).
     */
    outcomes: (id: string) =>
      t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/outcomes`),
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
    /**
     * Cancel a pending send.
     *
     * Typed as returning the cancelled row, NOT `void`. This route reads like
     * a delete and is not one: the handler carries
     * `@ZodResponse(scheduledMessageSchema)` and answers 200 with the row it
     * just cancelled, so a caller can show what it called off. Declaring
     * `void` meant the body was parsed and then thrown away by the type —
     * reachable only by casting. `macros.delete` is the only real 204 on this
     * surface.
     */
    cancelScheduled: (scheduledId: string) =>
      t.del<Unmodelled>(`/v1/conversations/scheduled-messages/${encodeURIComponent(scheduledId)}`),
    /**
     * Conversations merged into or out of this thread — `{ items }`.
     *
     * An object that CARRIES `items` and has no `nextCursor`. Any
     * "has items, therefore a page" heuristic types this wrong and a
     * paginator over it walks forever or stops at one page; take the object
     * and read `items` yourself.
     */
    linked: (id: string) => t.get<Unmodelled>(`/v1/conversations/${encodeURIComponent(id)}/linked`),
    /**
     * The inbox badge numbers: four scalars plus per-inbox, per-team and
     * per-label buckets.
     *
     * The one query parameter is spelled **`brand`** and takes a brand UUID.
     * Not `brandId` — it is a raw `@Query('brand')` with no schema at all, so
     * `brandId` is neither read nor rejected and you get unscoped counts with
     * a 200. An empty value is a harmless no-op.
     *
     * Also an object carrying arrays and no cursor: not a page, not an array.
     */
    unreadCounts: (query: { brand?: string } = {}) =>
      t.get<Unmodelled>('/v1/conversations/unread-counts', {
        ...(query.brand === undefined ? {} : { brand: query.brand }),
      }),
    /**
     * Patch rich blocks on a message already delivered.
     *
     * Two path parameters, in this order: the CONVERSATION id, then the
     * MESSAGE id. Both are parsed as UUID v7 in the handler, so a v4 id is a
     * 400 even though the signature says `string`.
     *
     * The body is `{ patches }`, 1–50 entries, each `{ id, set }` and
     * `.strict()`. A patch's `id` is a BLOCK id — resolvable at the top level
     * or inside a grid's `cards` — not the message's and not the
     * conversation's. `set` may not contain `type`, an unknown block id is a
     * 404, and an invalid merged envelope refuses the WHOLE batch rather than
     * the one patch.
     *
     * `id` in the response is the message id.
     */
    updateBlocks: (
      id: string,
      messageId: string,
      body: { patches: ReadonlyArray<{ id: string; set: Record<string, unknown> }> },
    ) =>
      t.patch<Unmodelled>(
        `/v1/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/blocks`,
        body,
      ),
  };
}
