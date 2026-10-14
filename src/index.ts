/**
 * `@chatlychat/sdk-node` — the official Node.js SDK for the Chatly API.
 *
 * Authenticate with a workspace API key (`ck_…`) from server-side code. This
 * is NOT the browser SDK: the key is a bearer credential for the whole
 * workspace and must never be shipped to a browser. For in-page work use
 * `@chatlychat/sdk-js`.
 *
 * The route surface is `packages/sdk-spec/surface.json`, which all ten Chatly
 * SDKs implement; the behavioural contract is `packages/sdk-spec/CONTRACT.md`.
 */
import {
  aiResource,
  billingResource,
  canvasStepsResource,
  botRoutesResource,
  botsResource,
  brandsResource,
  channelsResource,
  contactsResource,
  conversationsResource,
  customerCardEndpointsResource,
  customerCardsResource,
  docsSourcesResource,
  emailTemplatesResource,
  eventsResource,
  kbResource,
  knowledgeGapsResource,
  macrosResource,
  reportsResource,
  searchResource,
  ticketsResource,
  triggersResource,
  webhooksResource,
  workspaceResource,
} from './resources/index.js';
import { Transport, type Query, type TransportOptions } from './transport.js';

export type ClientOptions = TransportOptions;

export {
  ChatlyError,
  ChatlyApiError,
  ChatlyAuthenticationError,
  ChatlyPermissionError,
  ChatlyNotFoundError,
  ChatlyConflictError,
  ChatlyValidationError,
  ChatlyRateLimitError,
  ChatlyServerError,
  ChatlyTransportError,
} from './errors.js';
export {
  DEFAULT_API_URL,
  DEFAULT_RETRY,
  SDK_VERSION,
  type Query,
  type RetryPolicy,
} from './transport.js';
export { autoPaginate, type Page, type PageQuery } from './pagination.js';
export {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  type VerifyWebhookSignatureInput,
} from './webhooks.js';
/*
 * The verifier to reach for. `verifyWebhookSignature` above covers the event
 * webhook only; this one covers all seven outbound constructions, which is
 * what a host terminating more than one of them needs — three of those
 * surfaces send `x-chatly-signature` and sign three DIFFERENT strings, so the
 * header name is not enough to choose a construction from.
 */
export {
  verifyChatlySignature,
  CHATLY_SIGNATURE_SURFACES,
  CHATLY_SIGNATURE_TOLERANCE_SECONDS,
  type ChatlyHeaders,
  type ChatlySignatureFailure,
  type ChatlySignatureSurface,
  type VerifyChatlySignatureInput,
  type VerifyChatlySignatureResult,
} from './signatures.js';
export { chatlyIdentityHash } from './identity.js';
/*
 * A VALUE, not just a type. A caller validating or offering the ten
 * attribution dimensions needs them at runtime — the `chatly` CLI prints them
 * when it refuses a typo, and kept its own second copy until this existed.
 */
export { ATTRIBUTION_DIMENSIONS } from './resources/index.js';
export type {
  AgentHandlingInput,
  AiProviderKey,
  AttributionDimension,
  ConnectAiProviderInput,
  ContactInput,
  CreatableChannelType,
  CreateChannelInput,
  CreateDocsSourceInput,
  CreateWebhookInput,
  CustomerCardInput,
  DiscoverDocsInput,
  DocsProvider,
  EmailTemplateKind,
  EmailTemplateWriteInput,
  EventListQuery,
  KnowledgeGapStatus,
  MergeContactInput,
  MergeTicketsInput,
  MessageInput,
  ReportGranularity,
  ReportRangeQuery,
  ScheduleMessageInput,
  ToneCategory,
  ToneRuleInput,
  TriggerCondition,
  UnsubscribeContactInput,
  UpdateChannelInput,
  UpsertTriggerInput,
  TrackEventInput,
  Unmodelled,
  UsageEventType,
} from './resources/index.js';

/**
 * Reaction payload.
 *
 * Declared here rather than imported from `@livechat/shared`: this package is
 * published to consumers who must not have to install monorepo internals, so
 * it stays dependency-free by design. The shape mirrors
 * `@livechat/shared/reactions` and is covered by the API's own contract tests.
 */
export interface MessageReactions {
  readonly messageId: string;
  readonly entries: ReadonlyArray<{ emoji: string; count: number; reacted: boolean }>;
}

/**
 * Widget behaviour config. Structural, for the same reason as above — pass a
 * plain object; the API validates it against the authoritative zod schema and
 * rejects anything malformed.
 */
export type WidgetFeatureConfig = Record<string, unknown>;

export class ChatlyClient {
  private readonly transport: Transport;

  public readonly contacts: ReturnType<typeof contactsResource>;
  public readonly conversations: ReturnType<typeof conversationsResource>;
  public readonly tickets: ReturnType<typeof ticketsResource>;
  public readonly macros: ReturnType<typeof macrosResource>;
  public readonly kb: ReturnType<typeof kbResource>;
  public readonly search: ReturnType<typeof searchResource>;
  public readonly events: ReturnType<typeof eventsResource>;
  public readonly webhooks: ReturnType<typeof webhooksResource>;
  public readonly reports: ReturnType<typeof reportsResource>;
  public readonly channels: ReturnType<typeof channelsResource>;
  public readonly billing: ReturnType<typeof billingResource>;
  /** `canvas_steps` in the manifest; camelCase here, per CONTRACT.md §9. */
  public readonly canvasSteps: ReturnType<typeof canvasStepsResource>;
  public readonly workspace: ReturnType<typeof workspaceResource>;
  public readonly ai: ReturnType<typeof aiResource>;
  public readonly bots: ReturnType<typeof botsResource>;
  /** `bot_routes` in the manifest; camelCase here, per CONTRACT.md §9. */
  public readonly botRoutes: ReturnType<typeof botRoutesResource>;
  public readonly brands: ReturnType<typeof brandsResource>;
  public readonly customerCards: ReturnType<typeof customerCardsResource>;
  /** `customer_card_endpoints` in the manifest; camelCase here, per CONTRACT.md §9. */
  public readonly customerCardEndpoints: ReturnType<typeof customerCardEndpointsResource>;
  public readonly docsSources: ReturnType<typeof docsSourcesResource>;
  public readonly emailTemplates: ReturnType<typeof emailTemplatesResource>;
  public readonly knowledgeGaps: ReturnType<typeof knowledgeGapsResource>;
  public readonly triggers: ReturnType<typeof triggersResource>;

  public constructor(opts: ClientOptions);
  public constructor(transport: Transport);
  public constructor(optsOrTransport: ClientOptions | Transport) {
    /*
     * Every namespace is built from THIS instance's transport.
     *
     * The previous design hand-wrote a `derive` clone that re-bound each
     * namespace one by one, and forgot `search` — so a client returned by
     * `withIdempotencyKey` had search methods still closed over the PARENT's
     * dispatch. Harmless while both were reads against the same base URL, and
     * a live bug the moment anything on `search` became a write. Building
     * namespaces in the constructor from one transport makes the class of bug
     * unreachable rather than tested for.
     */
    this.transport =
      optsOrTransport instanceof Transport ? optsOrTransport : new Transport(optsOrTransport);
    const t = this.transport;
    this.contacts = contactsResource(t);
    this.conversations = conversationsResource(t);
    this.tickets = ticketsResource(t);
    this.macros = macrosResource(t);
    this.kb = kbResource(t);
    this.search = searchResource(t);
    this.events = eventsResource(t);
    this.webhooks = webhooksResource(t);
    this.reports = reportsResource(t);
    this.channels = channelsResource(t);
    this.billing = billingResource(t);
    this.canvasSteps = canvasStepsResource(t);
    this.workspace = workspaceResource(t);
    this.ai = aiResource(t);
    this.bots = botsResource(t);
    this.botRoutes = botRoutesResource(t);
    this.brands = brandsResource(t);
    this.customerCards = customerCardsResource(t);
    this.customerCardEndpoints = customerCardEndpointsResource(t);
    this.docsSources = docsSourcesResource(t);
    this.emailTemplates = emailTemplatesResource(t);
    this.knowledgeGaps = knowledgeGapsResource(t);
    this.triggers = triggersResource(t);
  }

  /**
   * Pin a specific `Idempotency-Key` for one or more upcoming writes.
   *
   * Returns a derived client (the original is unchanged). Use this when you
   * want to retry the *same* logical operation across process boundaries: the
   * API treats two writes with the same key + same body as a single accepted
   * operation and replays the cached response. Two writes with the same key
   * but a different body return HTTP 409.
   *
   * You do not need this for ordinary retries — the SDK already reuses one key
   * across its own attempts of a single call.
   *
   *   ```ts
   *   const key = crypto.randomUUID();
   *   for (let attempt = 0; attempt < 3; attempt++) {
   *     try {
   *       return await chatly.withIdempotencyKey(key).contacts.upsert(body);
   *     } catch (err) { ...backoff }
   *   }
   *   ```
   */
  public withIdempotencyKey(key: string): ChatlyClient {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('withIdempotencyKey: key must be a non-empty string');
    }
    return new ChatlyClient(this.transport.withPinnedKey(key));
  }

  /**
   * Describe the credential this client is using: which workspace it belongs
   * to and which scopes it was granted.
   *
   * `GET /v1/api-keys/whoami` is one of two routes on the api-keys
   * controller that accepts an API key (managing keys with a key is a
   * privilege-escalation shape). It is the call to make first: it turns a
   * mis-scoped key into an obvious error at integration time rather than a
   * 403 from an unrelated endpoint later.
   *
   * It was reachable over raw HTTP but appeared in no SDK and no doc, so
   * there was no way for an integrator to discover it.
   */
  public async whoami(): Promise<{ workspaceId: string; scopes: readonly string[] }> {
    return this.transport.get<{ workspaceId: string; scopes: readonly string[] }>(
      '/v1/api-keys/whoami',
    );
  }

  /**
   * Who the caller is, whichever kind of caller it is.
   *
   * Discriminated on `principal`. A `ck_` key gets the same object as
   * `whoami()` — there is no user behind a key — and a session token gets the
   * user plus their active membership. The handler's own docblock calls it
   * "the liveness check every SDK wants": a key with no useful scope still
   * gets a 200, and that answer is true.
   *
   * Prefer this over `whoami()` in code that may run with either credential.
   * `whoami()` stays because it is the narrower, key-only question and names
   * the scopes.
   */
  public async me(): Promise<Record<string, unknown>> {
    return this.transport.get<Record<string, unknown>>('/v1/me');
  }

  /**
   * Call any route, including the key-accessible ones with no typed method
   * here. Goes through the same auth, idempotency, retry and error handling.
   *
   *   ```ts
   *   const flags = await chatly.request<Flags>('GET', '/v1/feature-flags');
   *   ```
   */
  public async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    return this.transport.send<T>(method, path, options.query ?? {}, options.body);
  }
}
