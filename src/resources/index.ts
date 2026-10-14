/**
 * The typed route surface, one file per namespace.
 *
 * Every method here is one entry in `packages/sdk-spec/surface.json`, the
 * manifest all the Chatly backend SDKs implement;
 * `scripts/check-sdk-surface-parity.mjs` fails if any of them drifts from it.
 * Each is a key-accessible route — it carries `@AllowApiKey()` in the API. A
 * route that does not is NOT surface, because a `ck_` key gets 403 from it,
 * and shipping a method that always fails is worse than not shipping it: the
 * failure arrives at runtime, in production, in someone else's integration.
 *
 * Reactions were here once and never worked: a reaction records *who*
 * reacted, and a key is not a person.
 *
 * There is no HTTP in this directory. Paths, query names and bodies only —
 * the transport owns auth, idempotency, retries and the error model, which is
 * what keeps all 142 routes behaving the same way.
 *
 * This was one 401-line `resources.ts` until the surface went from 55 routes
 * to 142; it is split by namespace rather than by layer because the 650-line
 * ceiling is a repo rule and a single file would now be about 1,400.
 */
export { aiResource, type AiProviderKey, type ConnectAiProviderInput } from './ai.js';
export type { ToneCategory, ToneRuleInput } from './ai.js';
export { billingResource, type UsageEventType } from './billing.js';
export { canvasStepsResource } from './canvas-steps.js';
export { botRoutesResource, botsResource } from './bots.js';
export { brandsResource } from './brands.js';
export {
  channelsResource,
  type CreatableChannelType,
  type CreateChannelInput,
  type UpdateChannelInput,
} from './channels.js';
export type { Query, ResourceFactory, Transport, Unmodelled } from './common.js';
export {
  contactsResource,
  type ContactInput,
  type MergeContactInput,
  type UnsubscribeContactInput,
} from './contacts.js';
export {
  conversationsResource,
  type AgentHandlingInput,
  type MessageInput,
  type ScheduleMessageInput,
} from './conversations.js';
export {
  customerCardEndpointsResource,
  customerCardsResource,
  type CustomerCardInput,
} from './customer-cards.js';
export {
  docsSourcesResource,
  type CreateDocsSourceInput,
  type DiscoverDocsInput,
  type DocsProvider,
} from './docs-sources.js';
export {
  emailTemplatesResource,
  type EmailTemplateKind,
  type EmailTemplateWriteInput,
} from './email-templates.js';
export { eventsResource, type EventListQuery, type TrackEventInput } from './events.js';
export { kbResource } from './kb.js';
export { knowledgeGapsResource, type KnowledgeGapStatus } from './knowledge-gaps.js';
export { macrosResource } from './macros.js';
export {
  ATTRIBUTION_DIMENSIONS,
  reportsResource,
  type AttributionDimension,
  type ReportGranularity,
  type ReportRangeQuery,
} from './reports.js';
export { searchResource } from './search.js';
export { ticketsResource, type MergeTicketsInput } from './tickets.js';
export { triggersResource, type TriggerCondition, type UpsertTriggerInput } from './triggers.js';
export { webhooksResource, type CreateWebhookInput } from './webhooks.js';
export { workspaceResource } from './workspace.js';
