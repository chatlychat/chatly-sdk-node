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
  billingResource,
  channelsResource,
  contactsResource,
  conversationsResource,
  eventsResource,
  kbResource,
  macrosResource,
  reportsResource,
  searchResource,
  ticketsResource,
  webhooksResource,
  workspaceResource,
} from './resources.js';
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
export { chatlyIdentityHash } from './identity.js';
export type {
  AgentHandlingInput,
  ContactInput,
  EventListQuery,
  MergeContactInput,
  MergeTicketsInput,
  MessageInput,
  ScheduleMessageInput,
  UnsubscribeContactInput,
  TrackEventInput,
  Unmodelled,
} from './resources.js';

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
  public readonly workspace: ReturnType<typeof workspaceResource>;

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
    this.workspace = workspaceResource(t);
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
   * `GET /v1/api-keys/whoami` is deliberately the ONLY route on the api-keys
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
   * Call any route, including the 85 key-accessible ones with no typed method
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
