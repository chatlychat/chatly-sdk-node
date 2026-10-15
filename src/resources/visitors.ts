import type { Transport, Unmodelled } from './common.js';

/**
 * `chatly.visitors.*` — opening a thread with someone who has not written.
 *
 * ─── ONE METHOD, AND WHY THE OTHER TWO ARE NOT HERE ──────────────────────
 *
 * `GET /v1/visitors/live` and `GET /v1/visitors/{contactId}/pages` sit on the
 * same controller and carry no `@AllowApiKey()`, so a `ck_` key gets 403 from
 * both. They are not surface: shipping a method that always fails is worse
 * than not shipping it, because the failure arrives at runtime in someone
 * else's integration.
 */
export function visitorsResource(t: Transport) {
  return {
    /**
     * Open a conversation with a contact who did **not** write first.
     *
     * `POST /v1/visitors/{contactId}/start-conversation` — scope
     * `conversations:write`. No body and no query parameters: the contact id
     * is the whole input. Answers `{ conversationId }`.
     *
     * ─── A 403 HERE IS PROBABLY NOT YOUR SCOPES ────────────────────────────
     *
     * This is **off by default per workspace**. The flag is
     * `settings.proactiveOutreach.apiKeysMayStartConversations`; an owner or
     * admin turns it on with `PATCH /v1/workspace/settings`, which needs a
     * signed-in person and so is not reachable from this SDK, and you can
     * read its current value with `chatly.workspace.settings()`, which is.
     *
     * So a `ChatlyPermissionError` from this method means one of two quite
     * different things, and the workspace setting is the likelier: the scope
     * is not the opt-in. `conversations:write` was already grantable and is
     * already held by keys minted for ticket bulk actions and schedule-send,
     * so opening this route on the permission alone would have handed cold
     * outreach to credentials nobody re-reviewed. Check the setting before
     * you go looking at your key.
     *
     * ─── THE OTHER TWO THINGS TO KNOW ──────────────────────────────────────
     *
     * **Rate limit: three per contact per hour**, counted per workspace and
     * per CONTACT rather than per caller — the abuse shape is N threads at
     * one person, which a per-caller limit cannot see. The fourth call in an
     * hour is a `ChatlyRateLimitError`, and on THAT one `retryAfter` is
     * **null**: the server puts the window's remaining TTL in the body, at
     * `error.details.retryAfterSeconds`, and sends no `Retry-After` header
     * for it. That is measured, not assumed — the only thing synthesising a
     * plain `Retry-After` derives it from the `Retry-After-{bucket}` headers
     * `@nestjs/throttler` emits, and this refusal is not a throttler
     * refusal. So the route answers two different 429s: this one, where the
     * advice is readable only from `error.body`, and one from the inherited
     * global buckets (30/second, 100/15 minutes), where `retryAfter` is
     * populated as usual.
     *
     * **An offline visitor is not notified.** The greeting is persisted and
     * the widget renders it from history on their next page view; no email,
     * no push, no provider message, and nothing queued or dropped. An
     * integration that needs to reach someone who has left the site wants an
     * email or SMS conversation, not this.
     *
     * The controller declares `@RequireIdempotencyKey()` at class level with
     * no opt-out on this handler, so the key is **required**, not merely
     * honoured — without it the API answers 428 in production. The SDK mints
     * one per call, and `withIdempotencyKey` pins one if you want a retry of
     * the same logical outreach to replay rather than open a second thread.
     */
    startConversation: (contactId: string) =>
      t.post<Unmodelled>(`/v1/visitors/${encodeURIComponent(contactId)}/start-conversation`),
  };
}
