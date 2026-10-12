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

## Verifying webhooks

```ts
import { verifyWebhookSignature } from '@chatlychat/sdk-node';

const ok = verifyWebhookSignature({
  body: rawBody, // the EXACT bytes, before JSON.parse
  signatureHeader: req.headers['x-livechat-signature'] as string,
  secret: process.env.CHATLY_WEBHOOK_SECRET!,
});
```

Pass the raw body — re-serialising parsed JSON reorders keys and changes
whitespace, so the digest will not match.

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
