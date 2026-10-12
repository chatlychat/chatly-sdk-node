import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** Node 14.17+ has `crypto.randomUUID`; the SDK targets Node 20+ so it's safe. */
function nodeRandomUuid(): string {
  return randomUUID();
}

export interface ClientOptions {
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
}

/** Query for {@link ChatlyClient.events}.list — a page, optionally one contact's. */
export interface EventListQuery extends PageQuery {
  /** Restrict the stream to one contact. Omit for the whole workspace. */
  contactId?: string;
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
  kind?: 'text' | 'rich' | 'note' | 'system_event';
}

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
  private readonly base: string;
  private readonly baseHeaders: Headers;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  /**
   * When set, every write made through this client instance uses this
   * exact `Idempotency-Key` instead of minting a fresh UUID per call.
   * Created via {@link withIdempotencyKey}; the original client is left
   * untouched (the method returns a derived view, not a mutation).
   */
  private readonly pinnedIdempotencyKey: string | null;

  public constructor(opts: ClientOptions) {
    /*
     * Production, not a dev hostname.
     *
     * This was `https://api.livechat.local`, which resolves nowhere — so a
     * developer who followed the published docs and omitted `apiUrl` got an
     * SDK whose every call failed, and the docs page carried a warning
     * telling each reader to override it. Reported by a customer who
     * integrated from the docs alone, not caught here, because every test in
     * this package passes an explicit `apiUrl`.
     *
     * A self-hosted install still overrides it; that is the only caller that
     * ever should.
     */
    this.base = opts.apiUrl ?? 'https://api.chatlychat.com';
    this.baseHeaders = new Headers({
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': '@chatlychat/sdk-node/0.1.0',
    });
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.pinnedIdempotencyKey = null;
  }

  /**
   * Private clone constructor — used by {@link withIdempotencyKey} so we
   * can return a derived client without mutating the original (and
   * without re-running the public ctor's defaulting logic).
   */
  private static derive(parent: ChatlyClient, pinnedIdempotencyKey: string | null): ChatlyClient {
    const child = Object.create(ChatlyClient.prototype) as ChatlyClient;
    Object.assign(child, {
      base: parent.base,
      baseHeaders: parent.baseHeaders,
      timeoutMs: parent.timeoutMs,
      fetchFn: parent.fetchFn,
      pinnedIdempotencyKey,
    });
    // The route bags are field-initialized below the class body via the
    // arrow-property pattern; re-bind them so they target the derived
    // instance and call the child's `post`/`get`.
    (child as { contacts: typeof parent.contacts }).contacts = {
      list: (q: PageQuery = {}) => child.get<Page<unknown>>('/v1/contacts', { ...q }),
      upsert: (body: ContactInput) => child.post<unknown>('/v1/contacts', body),
    };
    (child as { conversations: typeof parent.conversations }).conversations = {
      list: (q: PageQuery = {}) => child.get<Page<unknown>>('/v1/conversations', { ...q }),
      messages: (conversationId: string, q: PageQuery = {}) =>
        child.get<Page<unknown>>(`/v1/conversations/${conversationId}/messages`, { ...q }),
      send: (body: MessageInput) =>
        child.post<unknown>(`/v1/conversations/${body.conversationId}/messages`, body),
    };
    (child as { events: typeof parent.events }).events = {
      track: (input: { contactId: string; name: string; properties?: Record<string, unknown> }) =>
        child.post<unknown>('/v1/cdp/events', input),
      list: (q: EventListQuery = {}) => child.get<Page<unknown>>('/v1/cdp/events', { ...q }),
    };
    // `search` was never rebound here, so a derived client's search methods
    // still called the PARENT's `get`. Harmless today because both are reads
    // against the same base URL, and a live bug the moment anything on
    // `search` becomes a write or the derived client differs by more than a
    // pinned key. `derivedSurfaceMatches` in the spec fails if any namespace
    // is forgotten again — TypeScript only caught `messages` because that
    // namespace was already rebound.
    (child as { search: typeof parent.search }).search = {
      query: (q: string, opts: Record<string, unknown> = {}) =>
        child.get<unknown>('/v1/search', { q, ...opts }),
      kb: (q: string, opts: Record<string, unknown> = {}) =>
        child.get<unknown>('/v1/search', { q, 'kinds[]': 'kb', ...opts }),
    };
    return child;
  }

  /**
   * Pin a specific `Idempotency-Key` for one or more upcoming writes.
   *
   * Returns a derived client (the original is unchanged). Use this when
   * you want to retry the *same* logical operation: the API treats two
   * writes with the same key + same body as a single accepted operation
   * and replays the cached response. Two writes with the same key but a
   * different body return HTTP 409.
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
    return ChatlyClient.derive(this, key);
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
    return this.get<{ workspaceId: string; scopes: readonly string[] }>('/v1/api-keys/whoami', {});
  }

  public contacts = {
    list: (q: PageQuery = {}) => this.get<Page<unknown>>('/v1/contacts', { ...q }),
    upsert: (body: ContactInput) => this.post<unknown>('/v1/contacts', body),
  };

  public conversations = {
    list: (q: PageQuery = {}) => this.get<Page<unknown>>('/v1/conversations', { ...q }),
    /**
     * Read a thread before replying to it.
     *
     * The MCP server has exposed this as `get_messages` since it shipped and
     * the SDK did not, so an integrator writing "read the conversation, then
     * decide" against the SDK had to hand-roll the request while the same
     * capability sat behind a tool call.
     */
    messages: (conversationId: string, q: PageQuery = {}) =>
      this.get<Page<unknown>>(`/v1/conversations/${conversationId}/messages`, { ...q }),
    send: (body: MessageInput) =>
      this.post<unknown>(`/v1/conversations/${body.conversationId}/messages`, body),
  };

  /**
   * Reactions and channel configuration are deliberately absent.
   *
   * Both were here and neither worked: a reaction records *who* reacted, and
   * a key is not a person, so those routes require a signed-in user and
   * return 403 to any key. Channel configuration needs `channels:write`,
   * which no key-accessible route grants. Shipping methods that always fail
   * is worse than not shipping them — the failure arrives at runtime, in
   * production, in someone else's integration.
   */

  /** Full-text search across contacts, conversations, messages, tickets, KB. */
  public search = {
    query: (q: string, opts: Record<string, unknown> = {}) =>
      this.get<unknown>('/v1/search', { q, ...opts }),
    /**
     * Help-centre articles only.
     *
     * The same `/v1/search` route narrowed to `kinds[]=kb`, which is exactly
     * what the MCP server's `search_kb` tool does. Worth its own method
     * because "find the article that answers this" is the common case and
     * getting there otherwise means knowing the `kinds[]` parameter exists.
     */
    kb: (q: string, opts: Record<string, unknown> = {}) =>
      this.get<unknown>('/v1/search', { q, 'kinds[]': 'kb', ...opts }),
  };

  public events = {
    track: (input: { contactId: string; name: string; properties?: Record<string, unknown> }) =>
      this.post<unknown>('/v1/cdp/events', input),
    /**
     * Read back what was tracked — the same `/v1/cdp/events` collection
     * {@link track} writes to, cursor-paginated newest-first.
     *
     * The SDK could write events and never read them, so "did my tracking
     * call actually land?" had no answer outside the dashboard. Pass
     * `contactId` to scope the stream to one person.
     */
    list: (q: EventListQuery = {}) => this.get<Page<unknown>>('/v1/cdp/events', { ...q }),
  };

  private async get<T>(path: string, q: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
    return this.dispatch<T>(url, { method: 'GET' });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    // Production API requires Idempotency-Key on every write. The
    // `pinnedIdempotencyKey` path is the supported way to retry the
    // SAME logical operation (set via `withIdempotencyKey(key)`); when
    // unset we mint a fresh UUID per call so a fetch-level network
    // retry inside this SDK still won't double-write upstream.
    const idempotencyKey = this.pinnedIdempotencyKey ?? nodeRandomUuid();
    return this.dispatch<T>(new URL(`${this.base}${path}`), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  /** PATCH. Same idempotency contract as `post` — it is a write. */
  private async patch<T>(path: string, body: unknown): Promise<T> {
    const idempotencyKey = this.pinnedIdempotencyKey ?? nodeRandomUuid();
    return this.dispatch<T>(new URL(`${this.base}${path}`), {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  private async dispatch<T>(url: URL, init: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      // Merge base auth/content headers with any per-call overrides
      // (e.g. `idempotency-key` from `post`). Previously this dropped
      // per-call headers because it reassigned `headers` wholesale —
      // which silently broke the idempotency contract on every write.
      const headers = new Headers(this.baseHeaders);
      if (init.headers !== undefined) {
        new Headers(init.headers).forEach((value, name) => {
          headers.set(name, value);
        });
      }
      const res = await this.fetchFn(url.toString(), {
        ...init,
        signal: ctrl.signal,
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`livechat ${res.status}: ${text}`);
      }
      if (res.status === 204) {
        return undefined as T;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Freshness window for `t`, in seconds. Matches what the docs recommend. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookSignatureInput {
  /**
   * The EXACT bytes we POSTed. Pass the raw body — re-serialising parsed JSON
   * reorders keys and changes whitespace, and the digest will not match.
   */
  body: string | Uint8Array;
  /** The `x-livechat-signature` header value: `t=<unix seconds>,v1=<hex>`. */
  signatureHeader: string;
  /** The endpoint's `whsec_…` signing secret.  */
  secret: string;
  /**
   * How far `t` may be from now before the delivery is treated as a replay.
   * Defaults to {@link WEBHOOK_SIGNATURE_TOLERANCE_SECONDS}; pass `Infinity`
   * only when re-verifying an archived delivery.
   */
  toleranceSeconds?: number;
  /** Escape hatch for tests. Unix seconds. */
  nowSeconds?: number;
}

/**
 * Verify the signature header on a webhook delivery from the platform.
 *
 * `v1` is HMAC-SHA256 over `` `${t}.${body}` `` — the timestamp is bound INTO
 * the digest, which is what makes the replay window enforceable at all.
 *
 * This used to HMAC the body ALONE, so it rejected every genuine delivery the
 * platform sent: the producer has always signed `${t}.${body}` and our own
 * published documentation has always described that construction. Anyone
 * following either the SDK or the docs got a hard "invalid signature" on 100%
 * of real traffic. The wire format is unchanged — only this verifier was wrong.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const parts = new Map<string, string>();
  for (const part of input.signatureHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      parts.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }

  const rawTs = parts.get('t');
  const tag = parts.get('v1');
  if (rawTs === undefined || tag === undefined) {
    return false;
  }
  const issuedAt = Number.parseInt(rawTs, 10);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  const tolerance = input.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - issuedAt) > tolerance) {
    return false;
  }

  const hmac = createHmac('sha256', input.secret);
  hmac.update(`${rawTs}.`);
  hmac.update(typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : input.body);
  const a = Buffer.from(tag, 'hex');
  const b = Buffer.from(hmac.digest('hex'), 'hex');
  // Length check first: timingSafeEqual throws on a length mismatch, and a
  // thrown verifier is an accepted webhook in a handler that forgot try/catch.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Compute the `userHash` the widget needs for identity verification.
 *
 * When a workspace turns identity verification on, the widget must prove the
 * `externalId` it claims was issued by the customer's backend rather than
 * typed into a browser console -- otherwise anyone can open a chat as anyone
 * else's account. This is the backend half of that handshake:
 *
 *   const userHash = chatlyIdentityHash(process.env.CHATLY_IDV_SECRET, user.id);
 *   // then render:
 *   // Chatly('identify', { externalId: user.id, userHash, email: user.email })
 *
 * It lived in the API's own source as a comment-only snippet, where the
 * people who need it -- customers integrating their backend -- could never
 * import it.
 *
 * The secret is the workspace's identity-verification secret. It must never
 * reach the browser; only the digest does.
 */
export function chatlyIdentityHash(secret: string, externalId: string): string {
  if (secret.length === 0) {
    throw new Error('chatlyIdentityHash: secret is empty');
  }
  if (externalId.length === 0) {
    throw new Error('chatlyIdentityHash: externalId is empty');
  }
  return createHmac('sha256', secret).update(externalId).digest('hex');
}
