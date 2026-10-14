# @chatlychat/sdk-node

Server-side client for the Chatly API. Authenticates with an API key, so it is
for your backend — not a browser, where the key would be readable.

```bash
pnpm add @chatlychat/sdk-node
```

## Quick start

```ts
import { ChatlyClient } from '@chatlychat/sdk-node';

const chatly = new ChatlyClient({
  apiKey: process.env.CHATLY_API_KEY!, // ck_live_…
  apiUrl: 'https://api.chatlychat.com', // optional
});

const contacts = await chatly.contacts.list({ limit: 20 });
```

Create a key under **Workspace → Developer → API keys**. The token is shown
once and stored only as a hash — if you lose it, revoke and mint another.

Make `whoami()` your first call. It returns the workspace the key belongs to
and the scopes it actually holds, so a mis-scoped key fails loudly at
integration time instead of surfacing as a puzzling 403 from an unrelated
endpoint in production:

```ts
const { workspaceId, scopes } = await chatly.whoami();
```

It is the only api-keys route a key may call: minting or listing keys with a
key would let a leaked read-only key escalate itself.

## What the client can do

Every method below maps to an endpoint that accepts key authentication. Scope
the key to only what your integration needs; a key can never do more than the
scopes ticked when it was created.

| Call                                                   | Scope required       |
| ------------------------------------------------------ | -------------------- |
| `chatly.whoami()`                                      | `workspace:read`     |
| `chatly.contacts.list({ cursor?, limit? })`            | `contacts:read`      |
| `chatly.contacts.upsert({ email, name, … })`           | `contacts:write`     |
| `chatly.conversations.list({ cursor?, limit? })`       | `conversations:read` |
| `chatly.conversations.messages(conversationId)`        | `conversations:read` |
| `chatly.conversations.send({ conversationId, body })`  | `messages:write`     |
| `chatly.search.query('refund', { … })`                 | `search:read`        |
| `chatly.search.kb('refund')`                           | `search:read`        |
| `chatly.events.track({ contactId, name, properties })` | `contacts:write`     |

Messages you send with a key are recorded as sent by an integration, not by
the person who created the key — a key outlives whoever issued it, so
attributing its writes to them would be wrong the moment they leave.

## Not included, and why

Reactions and channel/widget configuration are absent on purpose. A reaction
records _who_ reacted and a key is not a person, so those endpoints require a
signed-in user. Channel configuration needs a scope no key can hold. Both used
to be here and both returned 403 to every caller.

## Idempotency

Writes accept an idempotency key so a retry after a network failure does not
duplicate work:

```ts
await chatly.withIdempotencyKey('order-4471-refund').contacts.upsert({ … });
```

## Verifying anything Chatly signs

`verifyChatlySignature` is the one to use. You tell it which **surface** you
are terminating, hand it the raw body and the request's headers, and it checks
the construction that surface actually uses:

```ts
import { verifyChatlySignature } from '@chatlychat/sdk-node';

const result = verifyChatlySignature({
  surface: 'event_webhook',
  body: rawBody, // the EXACT bytes, before JSON.parse
  headers: req.headers,
  secret: process.env.CHATLY_WEBHOOK_SECRET!,
});

if (!result.ok) {
  console.warn('rejected', result.reason, result.message);
  return res.status(400).end();
}
```

Pass the raw body — re-serialising parsed JSON reorders keys and changes
whitespace, so the digest will not match. On a refusal, `reason` is a stable
string to branch on (`signature_mismatch`, `timestamp_outside_tolerance`,
`missing_signature_header`, …) and `message` is a sentence written to be
printed. It never throws.

### The seven surfaces

| `surface`                 | Header(s)                                                      | Signed string                   | `t` unit         |
| ------------------------- | -------------------------------------------------------------- | ------------------------------- | ---------------- |
| `agent_delivery`          | `x-chatly-signature: t=…,v1=…`                                 | `<t>.<rawBody>`                 | seconds          |
| `event_webhook`           | `x-livechat-signature: t=…,v1=…`                               | `<t>.<rawBody>`                 | seconds          |
| `ai_tool_call`            | `x-chatly-signature: t=…,v1=…`                                 | `<t>.<METHOD>.<path>.<rawBody>` | seconds          |
| `canvas_step`             | `x-chatly-canvas-signature: sha256=…` and `x-chatly-canvas-ts` | `<ts>.<rawBody>`                | **milliseconds** |
| `customer_card`           | `x-chatly-signature: sha256=…` and `x-chatly-timestamp`        | `<ts>.<rawBody>`                | **milliseconds** |
| `workflow_webhook`        | `x-chatly-signature-v2: t=…,v1=…`                              | `<t>.<rawBody>`                 | seconds          |
| `workflow_webhook_legacy` | `x-chatly-signature: sha256=…`                                 | `<rawBody>` — no timestamp      | n/a              |

Three of them send **`x-chatly-signature`** and sign three different strings,
which is why `surface` is required rather than inferred from the header: a
verifier that keys on the header name can be pointed at the wrong
construction while looking completely correct.

`ai_tool_call` additionally needs `method` and `path` (`pathname + search`,
never the host), because both are inside the signed string. `toleranceSeconds`
defaults to 300 and is always in **seconds**, whatever unit the surface's
timestamp uses — the conversion is this function's job, and getting it wrong
by hand puts the freshness check about 54,000 years out and rejects
everything.

**Prefer `workflow_webhook` over `workflow_webhook_legacy`.** Every workflow
webhook call sends both headers. The legacy one signs the body with no
timestamp, so a captured request verifies forever and nothing can bound a
replay; `verifyChatlySignature` refuses it unless you pass
`allowUnprotectedReplay: true`, and if you do, make the endpoint idempotent.

### `verifyWebhookSignature` (still supported)

The original single-scheme verifier. It handles `event_webhook` only and takes
the header value rather than the header bag. It is published, in use, and not
going away:

```ts
import { verifyWebhookSignature } from '@chatlychat/sdk-node';

const ok = verifyWebhookSignature({
  body: rawBody, // the EXACT bytes, before JSON.parse
  signatureHeader: req.headers['x-livechat-signature'] as string,
  secret: process.env.CHATLY_WEBHOOK_SECRET!,
});
```

The scheme is `t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 over
`` `${t}.${body}` ``. The timestamp is inside the signed string, so a captured
delivery stops verifying once it falls outside `toleranceSeconds`.

> **This example was wrong until 2026-10-12, in three ways** — it said
> `payload` (the field is `body`), `signature` (it is `signatureHeader`) and
> `x-chatly-signature` (webhooks use **`x-livechat-signature`**). In
> TypeScript the old snippet was a compile error; in plain JavaScript it was
> worse than returning `false`, because the verifier splits
> `input.signatureHeader` first and an absent one throws a `TypeError` out of
> your webhook handler.
>
> The header name is the trap worth knowing: **`x-chatly-signature` is real,
> but it belongs to four other surfaces** — external-agent deliveries, custom
> AI tool calls, customer cards and the workflow `fire_webhook` action — and
> each of those constructs its base string differently. Outbound event
> webhooks are the one surface using `x-livechat-signature`. Do not share one
> verifier across them without checking the construction.

---

## About this repository

This is a **mirror**. `@chatlychat/sdk-node` is built from a private monorepo where the rest
of the platform, its migrations and its contract checks live, so a pull request here
cannot be merged directly — but a patch is still the fastest way to get something
fixed and we will port it with attribution.

What you can do here: read the source, run the tests, open an issue, or open a PR
and we will treat the diff as the proposal.

Issues: https://github.com/chatlychat/chatly-sdk-node/issues · Docs: https://chatlychat.com/docs
