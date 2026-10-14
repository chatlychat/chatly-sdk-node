/**
 * Every manifest entry, paired with the call that should produce it.
 *
 * Written out by hand on purpose. A table generated FROM the client's own
 * shape would pass whatever the client happens to do, which is the mistake
 * the first parity gate made — it searched each SDK's source TEXT for path
 * strings and scored three SDKs 55/55 for routes they had not implemented,
 * because their authors had written the paths into doc comments explaining
 * two bogus manifest rows. This table says what each method is supposed to
 * do; `surface-lock.spec.ts` catches the disagreement.
 *
 * Arguments are throwaway but DISTINCTIVE, so the recorded path can be turned
 * back into the manifest's template by position. Bodies are the real field
 * names — a method whose body shape is wrong still records the right path, so
 * this file is not where that is caught; `resource-params.spec.ts` is.
 */
import type { ChatlyClient } from '../index.js';

/** Throwaway values, distinctive enough to find again in the recorded path. */
export const ARG = {
  id: 'ID1',
  slug: 'SLUG1',
  tag: 'TAG1',
  conversationId: 'CONV1',
  messageId: 'MSG1',
  deliveryId: 'DLV1',
  scheduledId: 'SCHED1',
  teamId: 'TEAM1',
  contactId: 'CONT1',
  provider: 'openai',
  kind: 'workspace_invite',
} as const;

/**
 * Throwaway https URLs for the three bodies that carry one.
 *
 * They are never fetched — the transport is a fake — but
 * `scripts/check-published-package-hosts.mjs` scans every non-`.spec.` file
 * under `src/` of a published package, and rightly so: a non-production host
 * literal in shipped source is how `api.livechat.local` became every
 * customer's default. These carry the opt-out marker because they are
 * fixtures rather than defaults, and the marker is a visible act where a
 * path allowlist would have been silent.
 */
const FIXTURE_WEBHOOK_URL = 'https://hooks.example.org/chatly'; // host-gate:allow
const FIXTURE_TOOL_URL = 'https://api.example.org/refunds'; // host-gate:allow
const FIXTURE_CARD_URL = 'https://api.example.org/cards/orders'; // host-gate:allow

export interface Invocation {
  key: string;
  call: () => Promise<unknown>;
}

export function invocations(chatly: ChatlyClient): Invocation[] {
  return [
    { key: 'root.whoami', call: () => chatly.whoami() },
    { key: 'root.me', call: () => chatly.me() },

    { key: 'contacts.list', call: () => chatly.contacts.list() },
    { key: 'contacts.get', call: () => chatly.contacts.get(ARG.id) },
    { key: 'contacts.upsert', call: () => chatly.contacts.upsert({ email: 'a@b.test' }) },
    {
      key: 'contacts.bulk_upsert',
      call: () => chatly.contacts.bulkUpsert([{ email: 'a@b.test' }]),
    },
    {
      key: 'contacts.merge',
      call: () =>
        chatly.contacts.merge(ARG.id, { mergedId: '0192b0de-0000-7000-8000-000000000001' }),
    },
    { key: 'contacts.add_tags', call: () => chatly.contacts.addTags(ARG.id, ARG.tag) },
    { key: 'contacts.remove_tag', call: () => chatly.contacts.removeTag(ARG.id, ARG.tag) },
    {
      key: 'contacts.unsubscribe',
      call: () => chatly.contacts.unsubscribe(ARG.id, { unsubscribed: true }),
    },
    { key: 'contacts.journey', call: () => chatly.contacts.journey(ARG.id) },
    { key: 'contacts.cards', call: () => chatly.contacts.cards(ARG.contactId) },
    { key: 'contacts.mood', call: () => chatly.contacts.mood(ARG.id, { days: 30 }) },

    { key: 'conversations.list', call: () => chatly.conversations.list() },
    { key: 'conversations.get', call: () => chatly.conversations.get(ARG.id) },
    { key: 'conversations.messages', call: () => chatly.conversations.messages(ARG.id) },
    {
      key: 'conversations.send',
      call: () => chatly.conversations.send({ conversationId: ARG.id, body: 'hi' }),
    },
    { key: 'conversations.unattended', call: () => chatly.conversations.unattended() },
    { key: 'conversations.agent_handling', call: () => chatly.conversations.agentHandling(ARG.id) },
    {
      key: 'conversations.set_agent_handling',
      call: () => chatly.conversations.setAgentHandling(ARG.id, { state: 'bot' }),
    },
    {
      key: 'conversations.return_to_bot',
      call: () => chatly.conversations.returnToBot(ARG.conversationId, { botId: ARG.id }),
    },
    {
      key: 'conversations.record_outcome',
      call: () =>
        chatly.conversations.recordOutcome(ARG.conversationId, {
          outcome: 'purchased',
          outcomeRef: 'order-1',
          valueCents: 12_900,
          currency: 'GBP',
        }),
    },
    { key: 'conversations.outcomes', call: () => chatly.conversations.outcomes(ARG.id) },
    {
      key: 'conversations.generated_replies',
      call: () => chatly.conversations.generatedReplies(ARG.id),
    },
    { key: 'conversations.generate_reply', call: () => chatly.conversations.generateReply(ARG.id) },
    {
      key: 'conversations.scheduled_messages',
      call: () => chatly.conversations.scheduledMessages(ARG.id),
    },
    {
      key: 'conversations.schedule_message',
      call: () =>
        chatly.conversations.scheduleMessage(ARG.id, {
          body: 'later',
          sendAt: '2030-01-01T00:00:00Z',
        }),
    },
    {
      key: 'conversations.cancel_scheduled',
      call: () => chatly.conversations.cancelScheduled(ARG.scheduledId),
    },
    { key: 'conversations.linked', call: () => chatly.conversations.linked(ARG.id) },
    { key: 'conversations.unread_counts', call: () => chatly.conversations.unreadCounts() },
    {
      key: 'conversations.update_blocks',
      call: () =>
        chatly.conversations.updateBlocks(ARG.id, ARG.messageId, {
          patches: [{ id: 'blk_1', set: { text: 'done' } }],
        }),
    },

    { key: 'tickets.list', call: () => chatly.tickets.list() },
    { key: 'tickets.comments', call: () => chatly.tickets.comments(ARG.id) },
    {
      key: 'tickets.for_conversation',
      call: () => chatly.tickets.forConversation(ARG.conversationId),
    },
    { key: 'tickets.queues', call: () => chatly.tickets.queues() },
    { key: 'tickets.merge', call: () => chatly.tickets.merge(ARG.id, { loserId: 't2' }) },
    { key: 'tickets.split', call: () => chatly.tickets.split(ARG.id, {}) },
    { key: 'tickets.bulk', call: () => chatly.tickets.bulk({}) },
    { key: 'tickets.conversations', call: () => chatly.tickets.conversations(ARG.id) },
    { key: 'tickets.lineage', call: () => chatly.tickets.lineage(ARG.id) },
    { key: 'tickets.status_history', call: () => chatly.tickets.statusHistory(ARG.id) },
    { key: 'tickets.time', call: () => chatly.tickets.time(ARG.id) },
    { key: 'tickets.open_count', call: () => chatly.tickets.openCount(ARG.conversationId) },

    { key: 'macros.list', call: () => chatly.macros.list() },
    { key: 'macros.get', call: () => chatly.macros.get(ARG.id) },
    { key: 'macros.create', call: () => chatly.macros.create({ name: 'm' }) },
    { key: 'macros.update', call: () => chatly.macros.update(ARG.id, { name: 'm2' }) },
    { key: 'macros.delete', call: () => chatly.macros.delete(ARG.id) },
    { key: 'macros.actions', call: () => chatly.macros.actions() },
    { key: 'macros.templates', call: () => chatly.macros.templates() },
    { key: 'macros.template', call: () => chatly.macros.template(ARG.slug) },

    { key: 'kb.articles', call: () => chatly.kb.list() },
    { key: 'kb.article', call: () => chatly.kb.article(ARG.slug) },
    { key: 'kb.collections', call: () => chatly.kb.collections() },

    { key: 'search.query', call: () => chatly.search.query('refunds') },

    { key: 'events.track', call: () => chatly.events.track({ contactId: ARG.id, name: 'signup' }) },
    { key: 'events.list', call: () => chatly.events.list() },

    { key: 'webhooks.deliveries', call: () => chatly.webhooks.deliveries() },
    { key: 'webhooks.delivery', call: () => chatly.webhooks.delivery(ARG.id) },
    { key: 'webhooks.redeliver', call: () => chatly.webhooks.redeliver(ARG.id) },
    { key: 'webhooks.list', call: () => chatly.webhooks.list() },
    { key: 'webhooks.delete', call: () => chatly.webhooks.delete('wh_1') },
    {
      key: 'webhooks.create',
      call: () =>
        chatly.webhooks.create({
          url: FIXTURE_WEBHOOK_URL,
          eventTypes: ['conversation.created'],
        }),
    },
    { key: 'webhooks.events', call: () => chatly.webhooks.events() },
    { key: 'webhooks.schema_versions', call: () => chatly.webhooks.schemaVersions() },
    {
      key: 'webhooks.set_schema_version',
      call: () => chatly.webhooks.setSchemaVersion(ARG.id, '2026-10-12'),
    },

    { key: 'reports.overview', call: () => chatly.reports.overview() },
    { key: 'reports.agents', call: () => chatly.reports.agents() },
    { key: 'reports.conversations_by_day', call: () => chatly.reports.conversationsByDay() },
    { key: 'reports.sla', call: () => chatly.reports.sla() },
    {
      key: 'reports.attribution',
      call: () => chatly.reports.attribution({ dimension: 'utm_source', days: 30 }),
    },
    { key: 'reports.sources', call: () => chatly.reports.sources({ days: 7 }) },
    { key: 'reports.cohorts', call: () => chatly.reports.cohorts({ weeks: 8 }) },
    { key: 'reports.labels', call: () => chatly.reports.labels({ groupBy: 'day' }) },
    { key: 'reports.response_times', call: () => chatly.reports.responseTimes({ days: 30 }) },
    { key: 'reports.teams', call: () => chatly.reports.teams({ businessHours: true }) },
    { key: 'reports.themes', call: () => chatly.reports.themes({ date: '2026-10-12' }) },
    {
      key: 'reports.theme_conversations',
      call: () => chatly.reports.themeConversations(ARG.id),
    },
    { key: 'reports.voice', call: () => chatly.reports.voice({ days: 30 }) },

    { key: 'channels.list', call: () => chatly.channels.list() },
    { key: 'channels.get', call: () => chatly.channels.get(ARG.id) },
    { key: 'channels.adapters', call: () => chatly.channels.adapters() },
    {
      key: 'channels.create',
      call: () => chatly.channels.create({ type: 'api', name: 'Ops', publicId: 'ops' }),
    },
    { key: 'channels.update', call: () => chatly.channels.update(ARG.id, { enabled: false }) },
    { key: 'channels.rotate_secret', call: () => chatly.channels.rotateSecret(ARG.id) },

    { key: 'canvas_steps.get', call: () => chatly.canvasSteps.get(ARG.id) },
    {
      key: 'canvas_steps.resolve',
      call: () =>
        chatly.canvasSteps.resolve(ARG.id, { canvas: { v: 1, canvasId: 'c', blocks: [] } }),
    },
    { key: 'billing.plans', call: () => chatly.billing.plans() },
    { key: 'billing.usage', call: () => chatly.billing.usage('ai.tokens') },
    { key: 'billing.summary', call: () => chatly.billing.summary() },
    { key: 'billing.invoices', call: () => chatly.billing.invoices({ limit: 25 }) },
    { key: 'billing.usage_monthly', call: () => chatly.billing.usageMonthly({ month: '2026-10' }) },
    { key: 'billing.usage_daily', call: () => chatly.billing.usageDaily('ai.tokens') },

    { key: 'workspace.secrets', call: () => chatly.workspace.secrets() },
    { key: 'workspace.mine', call: () => chatly.workspace.mine() },
    { key: 'workspace.settings', call: () => chatly.workspace.settings() },
    { key: 'workspace.labels', call: () => chatly.workspace.labels() },
    { key: 'workspace.inboxes', call: () => chatly.workspace.inboxes() },
    { key: 'workspace.team_members', call: () => chatly.workspace.teamMembers(ARG.teamId) },
    { key: 'workspace.agent_skills', call: () => chatly.workspace.agentSkills() },
    { key: 'workspace.key_scopes', call: () => chatly.workspace.keyScopes() },

    { key: 'ai.providers', call: () => chatly.ai.providers() },
    {
      key: 'ai.add_provider',
      call: () => chatly.ai.addProvider({ provider: 'openai', apiKey: 'x'.repeat(24) }),
    },
    { key: 'ai.test_provider', call: () => chatly.ai.testProvider('openai') },
    { key: 'ai.quota', call: () => chatly.ai.quota() },
    { key: 'ai.tools', call: () => chatly.ai.tools() },
    {
      key: 'ai.create_tool',
      call: () =>
        chatly.ai.createTool({
          name: 'refund.lookup',
          description: 'Look up a refund',
          urlTemplate: FIXTURE_TOOL_URL,
        }),
    },
    { key: 'ai.update_tool', call: () => chatly.ai.updateTool(ARG.id, { enabled: false }) },
    { key: 'ai.delete_tool', call: () => chatly.ai.deleteTool(ARG.id) },
    { key: 'ai.tone', call: () => chatly.ai.tone() },
    {
      key: 'ai.set_tone',
      call: () => chatly.ai.setTone([{ category: 'warmth', rule: 'Be kind.' }]),
    },
    { key: 'ai.generate_tone', call: () => chatly.ai.generateTone('g'.repeat(64)) },
    { key: 'ai.tone_preview', call: () => chatly.ai.tonePreview() },

    { key: 'bots.list', call: () => chatly.bots.list() },
    { key: 'bots.get', call: () => chatly.bots.get(ARG.id) },
    {
      key: 'bots.create',
      call: () => chatly.bots.create({ name: 'Ada', systemPrompt: 'p'.repeat(24) }),
    },
    { key: 'bots.update', call: () => chatly.bots.update(ARG.id, { status: 'paused' }) },
    {
      key: 'bots.update_external',
      call: () => chatly.bots.updateExternal(ARG.id, { timeoutSeconds: 20 }),
    },
    {
      key: 'bots.rotate_external_secret',
      call: () => chatly.bots.rotateExternalSecret(ARG.id),
    },
    { key: 'bots.deliveries', call: () => chatly.bots.deliveries(ARG.id) },
    {
      key: 'bots.delivery',
      call: () => chatly.bots.delivery(ARG.id, ARG.deliveryId),
    },
    {
      key: 'bots.redeliver',
      call: () => chatly.bots.redeliver(ARG.id, ARG.deliveryId),
    },
    { key: 'bots.test_delivery', call: () => chatly.bots.testDelivery(ARG.id) },
    {
      /*
       * `days` and nothing else. The route REFUSES `from`/`to`/`weeks`/`date`
       * with a 400 rather than stripping them, so a call built from the wrong
       * window vocabulary fails loudly instead of answering for 30 days.
       */
      key: 'bots.analytics',
      call: () => chatly.bots.analytics(ARG.id, { days: 30 }),
    },

    { key: 'bot_routes.list', call: () => chatly.botRoutes.list() },
    {
      key: 'bot_routes.resolve',
      call: () => chatly.botRoutes.resolve({ page: { path: '/shop' } }),
    },
    { key: 'bot_routes.fields', call: () => chatly.botRoutes.fields() },
    {
      key: 'bot_routes.create',
      call: () =>
        chatly.botRoutes.create({ botId: '0192b0de-0000-7000-8000-000000000002', name: 'EN' }),
    },
    { key: 'bot_routes.update', call: () => chatly.botRoutes.update(ARG.id, { enabled: false }) },
    { key: 'bot_routes.delete', call: () => chatly.botRoutes.delete(ARG.id) },

    { key: 'brands.list', call: () => chatly.brands.list() },
    { key: 'brands.create', call: () => chatly.brands.create({ name: 'Acme', slug: 'acme' }) },
    { key: 'brands.update', call: () => chatly.brands.update(ARG.id, { name: 'Acme Ltd' }) },
    { key: 'brands.delete', call: () => chatly.brands.delete(ARG.id) },

    { key: 'customer_cards.list', call: () => chatly.customerCards.list() },
    {
      key: 'customer_cards.create',
      call: () =>
        chatly.customerCards.create({
          key: 'orders',
          title: 'Orders',
          url: FIXTURE_CARD_URL,
          ttlSeconds: 60,
        }),
    },
    {
      key: 'customer_cards.update',
      call: () => chatly.customerCards.update(ARG.id, { position: 1 }),
    },
    { key: 'customer_cards.rotate_secret', call: () => chatly.customerCards.rotateSecret(ARG.id) },
    { key: 'customer_cards.delete', call: () => chatly.customerCards.delete(ARG.id) },

    { key: 'customer_card_endpoints.list', call: () => chatly.customerCardEndpoints.list() },
    {
      key: 'customer_card_endpoints.create',
      call: () => chatly.customerCardEndpoints.create(FIXTURE_CARD_URL),
    },
    {
      key: 'customer_card_endpoints.rotate_secret',
      call: () => chatly.customerCardEndpoints.rotateSecret(ARG.id),
    },
    {
      key: 'customer_card_endpoints.activate_secret',
      call: () => chatly.customerCardEndpoints.activateSecret(ARG.id),
    },
    {
      key: 'customer_card_endpoints.delete',
      call: () => chatly.customerCardEndpoints.delete(ARG.id),
    },

    { key: 'docs_sources.list', call: () => chatly.docsSources.list() },
    { key: 'docs_sources.providers', call: () => chatly.docsSources.providers() },
    {
      key: 'docs_sources.discover',
      call: () => chatly.docsSources.discover({ provider: 'gitbook', token: 'tok' }),
    },
    {
      key: 'docs_sources.create',
      call: () =>
        chatly.docsSources.create({
          provider: 'gitbook',
          token: 'tok',
          organizationId: 'org_1',
          spaceId: 'space_1',
        }),
    },
    {
      key: 'docs_sources.update',
      call: () => chatly.docsSources.update(ARG.id, { status: 'paused' }),
    },
    { key: 'docs_sources.delete', call: () => chatly.docsSources.delete(ARG.id) },
    { key: 'docs_sources.sync', call: () => chatly.docsSources.sync(ARG.id, { full: true }) },
    { key: 'docs_sources.webhook', call: () => chatly.docsSources.webhook(ARG.id) },

    { key: 'email_templates.list', call: () => chatly.emailTemplates.list() },
    {
      key: 'email_templates.update',
      call: () =>
        chatly.emailTemplates.update('workspace_invite', { subject: 'Join', body: 'Hello' }),
    },
    {
      key: 'email_templates.delete',
      call: () => chatly.emailTemplates.delete('workspace_invite'),
    },
    {
      key: 'email_templates.preview',
      call: () =>
        chatly.emailTemplates.preview({
          kind: 'workspace_invite',
          subject: 'Join',
          body: 'Hello',
        }),
    },

    { key: 'knowledge_gaps.list', call: () => chatly.knowledgeGaps.list({ status: 'open' }) },
    { key: 'knowledge_gaps.update', call: () => chatly.knowledgeGaps.update(ARG.id, 'resolved') },
    { key: 'knowledge_gaps.draft', call: () => chatly.knowledgeGaps.draft(ARG.id) },

    { key: 'triggers.list', call: () => chatly.triggers.list() },
    {
      key: 'triggers.create',
      call: () =>
        chatly.triggers.create({
          name: 'Greet',
          eventType: 'conversation.created',
          enabled: true,
          conditions: [],
          actions: [{ type: 'send_message', params: { body: 'hi' } }],
        }),
    },
    { key: 'triggers.delete', call: () => chatly.triggers.delete(ARG.id) },
  ];
}

/**
 * The auto-paginating form for each `page` route.
 *
 * One per page entry and nothing else — `surface-lock.spec.ts` asserts that
 * correspondence, which is the floor that stops this table quietly shrinking
 * while the suite stays green.
 */
export function walkers(chatly: ChatlyClient): Record<string, () => AsyncIterable<unknown>> {
  return {
    'contacts.list': () => chatly.contacts.listAll(),
    'contacts.journey': () => chatly.contacts.journeyAll('c_1'),
    'conversations.list': () => chatly.conversations.listAll(),
    'conversations.messages': () => chatly.conversations.messagesAll('k_1'),
    'conversations.unattended': () => chatly.conversations.unattendedAll(),
    'tickets.list': () => chatly.tickets.listAll(),
    'kb.articles': () => chatly.kb.listAll(),
    'search.query': () => chatly.search.queryAll('refunds'),
    'events.list': () => chatly.events.listAll(),
    'webhooks.deliveries': () => chatly.webhooks.deliveriesAll(),
    'bots.list': () => chatly.bots.listAll(),
    'bots.deliveries': () => chatly.bots.deliveriesAll(ARG.id),
    'triggers.list': () => chatly.triggers.listAll(),
  };
}
