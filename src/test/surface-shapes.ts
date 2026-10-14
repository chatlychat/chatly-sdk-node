/**
 * The response shape THIS SDK's decoder expects from each of the 142 routes.
 *
 * ═══ READ THIS BEFORE CHANGING A VALUE ════════════════════════════════════
 *
 * Hand-written, from the handlers — deliberately NOT read from
 * `surface.json`, even though the suite loads that manifest for the path
 * templates. A fixture derived from the manifest agrees with whatever the
 * manifest says, including when it is wrong, and that is not a hypothetical:
 * `macros.list` was marked `paged: true` for a day while its handler is
 * `@PaginationExempt` and answers a bare array. Two SDKs built paginators
 * over it and raised a decode error against the real API with green suites,
 * because their fakes answered every route with `{ items, nextCursor }`.
 *
 * So this column is a second opinion. `surface-lock.spec.ts` feeds each
 * method the shape declared HERE and asserts the value it hands back really
 * has that shape; `scripts/check-sdk-surface-parity.mjs` then diffs this
 * column — via `surface.lock.json` — against the manifest's own `shape`,
 * across all eight backend SDKs. Eight independently written columns have to
 * agree with the server, so a wrong manifest row needs eight authors to
 * misread one handler.
 *
 * ═══ THE ROWS THAT LOOK WRONG AND ARE NOT ═════════════════════════════════
 *
 * Three DELETEs answer with a body and one is a real 204. `macros.delete` is
 * the only `empty` on the whole surface; `contacts.remove_tag` answers with
 * the surviving contact, `conversations.cancel_scheduled` with the row it
 * cancelled. Nine more deletes added in the 55→142 expansion all answer 200
 * with a small object: `{ deleted: true }` (`ai.delete_tool`,
 * `bot_routes.delete`), `{ ok: true }` (`triggers.delete`,
 * `customer_cards.delete`), `{ id }` (`brands.delete`), `{ kept }`
 * (`docs_sources.delete`) and `{ restored }` (`email_templates.delete`). The
 * confirmation shapes are all different, which is why none of them is worth
 * guessing.
 *
 * Six routes carry an `items` key and are NOT pages, because they have no
 * `nextCursor`: `billing.usage_monthly`, `conversations.linked`,
 * `tickets.status_history`, `tickets.time`, `macros.templates` and
 * `conversations.unread_counts` (which carries three bucket arrays instead).
 * Any "has `items`, therefore a page" heuristic types every one of them
 * wrong. `billing.invoices` is the mirror image — genuinely cursor-paginated,
 * but under **`data`** — so it is an object too, and has no walker.
 *
 * And a PUT that answers with a bare array: `ai.set_tone` re-reads the rule
 * set after writing it and returns the same array the GET does.
 */
export type Shape = 'array' | 'page' | 'object' | 'empty';

export const EXPECTED_SHAPE: Readonly<Record<string, Shape>> = {
  'root.whoami': 'object',
  'root.me': 'object',

  'contacts.list': 'page',
  'contacts.get': 'object',
  'contacts.upsert': 'object',
  'contacts.bulk_upsert': 'object',
  'contacts.merge': 'object',
  'contacts.add_tags': 'object',
  // A DELETE with a body: the surviving contact, same object as the tag POST.
  'contacts.remove_tag': 'object',
  'contacts.unsubscribe': 'object',
  'contacts.journey': 'page',
  // `{ cards: [...] }` — the collection key is `cards`, not `items`.
  'contacts.cards': 'object',
  'contacts.mood': 'object',

  'conversations.list': 'page',
  'conversations.get': 'object',
  'conversations.messages': 'page',
  'conversations.send': 'object',
  'conversations.unattended': 'page',
  'conversations.agent_handling': 'object',
  'conversations.set_agent_handling': 'object',
  'conversations.return_to_bot': 'object',
  'conversations.record_outcome': 'object',
  /*
   * An object that CARRIES `items` and has no cursor, like
   * `conversations.linked`. A "has items, therefore a page" heuristic types
   * this wrong, and the route is `@PaginationExempt` in the API.
   */
  'conversations.outcomes': 'object',
  'conversations.generated_replies': 'array',
  'conversations.generate_reply': 'object',
  'conversations.scheduled_messages': 'array',
  'conversations.schedule_message': 'object',
  // Also a DELETE with a body: the row it just cancelled.
  'conversations.cancel_scheduled': 'object',
  // `{ items }` with no cursor. An object, not a page.
  'conversations.linked': 'object',
  'conversations.unread_counts': 'object',
  'conversations.update_blocks': 'object',

  'tickets.list': 'page',
  'tickets.comments': 'array',
  'tickets.for_conversation': 'array',
  'tickets.queues': 'array',
  'tickets.merge': 'object',
  'tickets.split': 'object',
  'tickets.bulk': 'object',
  'tickets.conversations': 'array',
  'tickets.lineage': 'object',
  // `{ ticketId, status, currentStatusForSeconds, items, truncated }`.
  'tickets.status_history': 'object',
  // `{ items, totalMinutes, billableMinutes }` — `items`, no cursor.
  'tickets.time': 'object',
  'tickets.open_count': 'object',

  // @PaginationExempt, bare array, capped at 200 by usage rank. The one that
  // cost two SDKs a decode error.
  'macros.list': 'array',
  'macros.get': 'object',
  'macros.create': 'object',
  'macros.update': 'object',
  // The ONLY 204 here: @HttpCode(204), and the handler returns nothing.
  'macros.delete': 'empty',
  // `{ limit, actions }` — the array is nested under `actions`.
  'macros.actions': 'object',
  // `{ items, total }` and explicitly NOT a page: no cursor, no hasMore.
  'macros.templates': 'object',
  'macros.template': 'object',

  'kb.articles': 'page',
  'kb.article': 'object',
  'kb.collections': 'array',

  'search.query': 'page',

  'events.track': 'object',
  'events.list': 'page',

  'webhooks.deliveries': 'page',
  'webhooks.delivery': 'object',
  'webhooks.redeliver': 'object',
  'webhooks.list': 'array',
  'webhooks.delete': 'object',
  'webhooks.create': 'object',
  // `{ eventTypes: [...] }` — one key wrapping a flat array of names.
  'webhooks.events': 'object',
  'webhooks.schema_versions': 'object',
  'webhooks.set_schema_version': 'object',

  'reports.overview': 'object',
  // Arrays, both of them — per-agent rows and per-day buckets, no envelope.
  'reports.agents': 'array',
  'reports.conversations_by_day': 'array',
  'reports.sla': 'object',
  'reports.attribution': 'array',
  'reports.sources': 'array',
  'reports.cohorts': 'object',
  'reports.labels': 'object',
  'reports.response_times': 'object',
  'reports.teams': 'object',
  'reports.themes': 'object',
  // `{ conversationIds }`.
  'reports.theme_conversations': 'object',
  'reports.voice': 'object',

  'channels.list': 'array',
  'channels.get': 'object',
  // A bare array of channel-type STRINGS, not objects.
  'channels.adapters': 'array',
  'channels.create': 'object',
  'channels.update': 'object',
  'channels.rotate_secret': 'object',

  'billing.plans': 'array',
  'canvas_steps.get': 'object',
  'canvas_steps.resolve': 'object',
  'billing.usage': 'object',
  'billing.summary': 'object',
  // Cursor-paginated under `data`, not `items`. Object, and no walker.
  'billing.invoices': 'object',
  // Has an `items` key and no cursor. Object.
  'billing.usage_monthly': 'object',
  'billing.usage_daily': 'object',

  // The credential census: `{ items, total, truncated }`. An object and not
  // a page — nine heterogeneous sources with no common sort key, so there is
  // nothing to keyset on and no walker.
  'workspace.secrets': 'object',
  'workspace.mine': 'array',
  'workspace.settings': 'object',
  'workspace.labels': 'array',
  'workspace.inboxes': 'array',
  'workspace.team_members': 'array',
  'workspace.agent_skills': 'object',
  'workspace.key_scopes': 'array',

  // `{ providers: [...] }`, not a bare array.
  'ai.providers': 'object',
  'ai.add_provider': 'object',
  'ai.test_provider': 'object',
  'ai.quota': 'object',
  'ai.tools': 'array',
  'ai.create_tool': 'object',
  'ai.update_tool': 'object',
  // 200 with `{ deleted: true }` — a soft delete, not a 204.
  'ai.delete_tool': 'object',
  'ai.tone': 'array',
  // A PUT answering with the re-read bare array. Not `{ rules }`, not 204.
  'ai.set_tone': 'array',
  'ai.generate_tone': 'object',
  'ai.tone_preview': 'object',

  // `{ items, nextCursor, hasMore }` — buildPaginatedResponse.
  'bots.list': 'page',
  'bots.get': 'object',
  'bots.create': 'object',
  'bots.update': 'object',
  'bots.update_external': 'object',
  'bots.rotate_external_secret': 'object',
  'bots.deliveries': 'page',
  'bots.delivery': 'object',
  'bots.redeliver': 'object',
  'bots.test_delivery': 'object',
  // One object: `{ botType, ledger, unit, volume, latency, reliability,
  // outcomes }`. Not a page and not an array — one bot, one window.
  'bots.analytics': 'object',

  'bot_routes.list': 'array',
  'bot_routes.resolve': 'object',
  // `{ fields, prefixes, operators, evaluate }`, not a bare array.
  'bot_routes.fields': 'object',
  'bot_routes.create': 'object',
  'bot_routes.update': 'object',
  // 200 with `{ deleted: true }`.
  'bot_routes.delete': 'object',

  'brands.list': 'array',
  'brands.create': 'object',
  'brands.update': 'object',
  // 200 with `{ id }` — a different confirmation shape to bot_routes.delete.
  'brands.delete': 'object',

  'customer_cards.list': 'array',
  'customer_cards.create': 'object',
  'customer_cards.update': 'object',
  'customer_cards.rotate_secret': 'object',
  // 200 with `{ ok: true }`.
  'customer_cards.delete': 'object',

  // A bare array, like the card list — not `{ items }`, no cursor.
  'customer_card_endpoints.list': 'array',
  // 201 `{ endpoint, secret }` — `secret` BESIDE `endpoint`, matching the
  // card create rather than inventing a second convention for the same act.
  'customer_card_endpoints.create': 'object',
  // 201 `{ secret, active: false }`. The `active` flag is not decoration: the
  // secret signs nothing until it is activated.
  'customer_card_endpoints.rotate_secret': 'object',
  // 201 `{ activated: true }`.
  'customer_card_endpoints.activate_secret': 'object',
  // 200 with `{ ok: true }`.
  'customer_card_endpoints.delete': 'object',

  'docs_sources.list': 'array',
  'docs_sources.providers': 'array',
  // A POST answering 201 with a bare array of spaces.
  'docs_sources.discover': 'array',
  'docs_sources.create': 'object',
  'docs_sources.update': 'object',
  // 200 with `{ kept }`.
  'docs_sources.delete': 'object',
  'docs_sources.sync': 'object',
  'docs_sources.webhook': 'object',

  'email_templates.list': 'array',
  'email_templates.update': 'object',
  // 200 with `{ restored }`, and it does NOT return the template.
  'email_templates.delete': 'object',
  'email_templates.preview': 'object',

  'knowledge_gaps.list': 'array',
  'knowledge_gaps.update': 'object',
  // `{ gap, articleId, reason }` — the gap is NESTED.
  'knowledge_gaps.draft': 'object',

  // `{ items, nextCursor, hasMore }`.
  'triggers.list': 'page',
  'triggers.create': 'object',
  // 200 with `{ ok: true }`, not a 204.
  'triggers.delete': 'object',
};

/**
 * Anti-vacuity floor on the distribution.
 *
 * A column that said `object` 142 times would satisfy every other assertion
 * in the suite and would still be worthless. These counts come from reading
 * the handlers. All four must stay represented, and `empty` must stay at
 * exactly one until a second real 204 ships.
 *
 * The five `customer_card_endpoints` routes moved this from
 * `{ array: 31, page: 13, object: 106 }` on 2026-10-13: one bare-array list
 * and four objects.
 *
 * `bots.analytics` took `object` from 110 to 111 on 2026-10-13. One object
 * and not a page: it is one bot's rollup over one window, and the thing that
 * would make it a page — a row per bot — is what
 * `GET /v1/reports/analytics/assistants` already answers.
 */
export const EXPECTED_DISTRIBUTION = { array: 33, page: 13, object: 115, empty: 1 } as const;
