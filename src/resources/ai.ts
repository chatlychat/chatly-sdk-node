import type { Transport, Unmodelled } from './common.js';

/** `AI_PROVIDER_KEYS`. The path segment of `test_provider` is parsed against this. */
export type AiProviderKey = 'openai' | 'anthropic' | 'deepgram';

/** `TONE_CATEGORIES` — five, and `PUT /v1/ai/tone` is `.strict()` about them. */
export type ToneCategory = 'empathy' | 'language' | 'formality' | 'personality' | 'warmth';

export interface ConnectAiProviderInput {
  provider: AiProviderKey;
  /** `apiKeySchema`: trimmed, 20–512 chars, and the literal redaction placeholder is refused. */
  apiKey: string;
}

export interface ToneRuleInput {
  category: ToneCategory;
  /** Trimmed, 3–400 characters. */
  rule: string;
  /** Defaults to true server-side. */
  enabled?: boolean;
}

export function aiResource(t: Transport) {
  return {
    /**
     * BYOK provider status, one row per supported provider.
     *
     * An OBJECT — `{ providers: [...] }` — not the bare array the route name
     * suggests. No key value is ever returned, only `keyHint`.
     */
    providers: () => t.get<Unmodelled>('/v1/ai-providers'),
    /**
     * Store a provider key. Answers **201** with
     * `{ provider, validation, reindexQueued }`.
     *
     * `{ provider, apiKey }` — `apiKey`, not `key` or `token`. The
     * ai-providers controller carries class-level `@RequireIdempotencyKey()`,
     * so this write is one of the few that is a 428 in production without the
     * header; the SDK always sends one.
     */
    addProvider: (body: ConnectAiProviderInput) => t.post<Unmodelled>('/v1/ai-providers', body),
    /**
     * Probe a stored key without changing it. Answers 201. No body.
     *
     * The path parameter is the PROVIDER NAME, not an id, and the handler
     * runs `aiProviderKeySchema.parse` on it — anything outside
     * openai/anthropic/deepgram is a 400 rather than a 404.
     */
    testProvider: (provider: AiProviderKey) =>
      t.post<Unmodelled>(`/v1/ai-providers/${encodeURIComponent(provider)}/test`),

    /**
     * Subsidised AI spend against the cap.
     *
     * Note the permission: this one route wants `workspace:billing:read`,
     * not `ai:read` like the rest of `/v1/ai`.
     */
    quota: () => t.get<Unmodelled>('/v1/ai/quota'),

    /** Custom HTTP tools the agent may call. A bare array, ordered by name. */
    tools: () => t.get<ReadonlyArray<Unmodelled>>('/v1/ai/tools'),
    /**
     * Declare a tool. Answers **201**.
     *
     * Only `name`, `description` and `urlTemplate` are required; `method`
     * defaults to GET, `timeoutSeconds` to 20, `enabled` to true,
     * `parameters` to `[]`. Field names worth getting right:
     * `urlTemplate` (not `url`), `bodyTemplate` (not `body`),
     * `secretHeaders` (values are write-only), `signingSecret`,
     * `requiresApproval` (boolean OR `'agent'`/`'end_user'`),
     * `requiresVerifiedIdentity`, `approvalThresholdParam`/`Value`.
     *
     * `confirmTemplate` is `.strict()`, so an extra key there is a 400 rather
     * than a silent strip — and `requiresApproval: 'end_user'` without one is
     * refused.
     */
    createTool: (body: Unmodelled) => t.post<Unmodelled>('/v1/ai/tools', body),
    /** A partial of the create body; omitted fields are left as stored. */
    updateTool: (id: string, body: Unmodelled) =>
      t.patch<Unmodelled>(`/v1/ai/tools/${encodeURIComponent(id)}`, body),
    /**
     * Soft-delete a tool.
     *
     * **200 with `{ deleted: true }`, not a 204.** `macros.delete` is the only
     * genuine empty body on this surface.
     */
    deleteTool: (id: string) => t.del<Unmodelled>(`/v1/ai/tools/${encodeURIComponent(id)}`),

    /** Every tone rule, category then position. A bare array. */
    tone: () => t.get<ReadonlyArray<Unmodelled>>('/v1/ai/tone'),
    /**
     * Replace the whole rule set.
     *
     * The body is `{ rules: [...] }` and is **`.strict()` at both levels** —
     * an unknown key is a 400, not a silent strip, which for once means a
     * misspelling is visible. At most 40 rules, at most 8 per category.
     * `rules: []` is legal and wipes the set.
     *
     * It answers with the same **bare array** the GET does, re-read after the
     * write — not `{ rules }`, and not a 204. Wrapping it is wrong.
     */
    setTone: (rules: ReadonlyArray<ToneRuleInput>) =>
      t.put<ReadonlyArray<Unmodelled>>('/v1/ai/tone', { rules }),
    /**
     * Turn a prose style guide into draft rules. Answers **201** with
     * `{ rules, note }`; nothing is saved until you PUT them.
     *
     * `{ styleGuide }`, `.strict()`, trimmed, 40–20,000 characters. The
     * drafts' `category` is a free string here, deliberately: the model may
     * name a sixth category, and the PUT is where it has to become one of
     * the five.
     */
    generateTone: (styleGuide: string) =>
      t.post<Unmodelled>('/v1/ai/tone/generate', { styleGuide }),
    /** The rendered system instruction. `{ instruction }`; empty is a normal answer. */
    tonePreview: () => t.get<Unmodelled>('/v1/ai/tone/preview'),
  };
}
