# @chatlychat/sdk-node

## 0.4.0 — 2026-10-14

### Added

- **`verifyChatlySignature` — one verifier for all seven things Chatly
  signs.** `verifyWebhookSignature` handles exactly one of them, the
  `x-livechat-signature` event webhook, so a host terminating an external
  agent, a customer card, a canvas step, an AI tool call or a workflow action
  had to write the other constructions themselves. Three of those surfaces
  send **`x-chatly-signature`** and sign three DIFFERENT base strings —
  `<t>.<body>`, `<t>.<METHOD>.<path>.<body>` and `<ts>.<body>` with the
  timestamp in a separate header — so the function takes a required `surface`
  rather than inferring one from the header name, which cannot be done
  correctly.
- Two surfaces time-stamp in **milliseconds** (`canvas_step`,
  `customer_card`). `toleranceSeconds` stays in seconds and the conversion is
  the function's job: a millisecond timestamp read as seconds lands ~54,000
  years out, so the freshness check rejects everything and the failure looks
  like a wrong secret. When that happens the refusal now names the unit.
- It returns a discriminated union rather than a boolean. `reason` is a stable
  string (`signature_mismatch`, `timestamp_outside_tolerance`,
  `duplicate_signature_header`, …) and `message` is written to be printed.
  It never throws, on any input — per CONTRACT.md §6, a verifier that throws
  is an accepted webhook in a handler that forgot to catch.
- `workflow_webhook_legacy` is refused unless you pass
  `allowUnprotectedReplay: true`. That header signs the body with no
  timestamp, so a captured request verifies forever; the same call also sends
  `x-chatly-signature-v2`, which is replay-bounded, and the refusal says so.
- `CHATLY_SIGNATURE_SURFACES` is exported as data — the header names, base
  strings and units, which is what you want in front of you when a
  verification fails.

### Unchanged

- `verifyWebhookSignature` is untouched and still exported. It is published
  and in use; the new function is the recommended path, not a replacement.

## 0.3.1 — 2026-10-14

- **Publishes `ATTRIBUTION_DIMENSIONS`, which 0.3.0 exported in source and not
  on npm.** The export was added to `src/index.ts` after 0.3.0 was published,
  with no version bump, so the registry's 0.3.0 does not contain it. That
  broke `@chatlychat/cli@0.1.6` outright: pnpm rewrites the CLI's
  `workspace:*` to the published range at pack time, so the installed CLI
  imported a symbol its installed SDK did not provide and every command died
  with `SyntaxError: The requested module '@chatlychat/sdk-node' does not
provide an export named 'ATTRIBUTION_DIMENSIONS'`.
- No other change. Same code, published under a number that reflects it.

## 0.3.0

Three routes paginate that this SDK was treating as single reads, and one that
it was paginating does not paginate at all. The shared manifest's `paged` flag
was wrong in both directions and is now right in both.

### Added

- **`contacts.journeyAll()`, `conversations.unattendedAll()`,
  `conversations.messagesAll()` and `search.queryAll()`.** All four routes
  answer `{ items, nextCursor }` and only `messages` had a single-page form
  that admitted it. `journey`'s cursor is an ISO-8601 instant rather than an
  opaque string, which is why the manifest did not flag it — walk it, never
  construct one.
- `messagesAll` in particular had been missing since the surface was written:
  `conversations.messages` was flagged `paged` the whole time and nothing
  connected the flag to the paginators. A test that reads the manifest and
  asserts both directions — every flagged route has a walker, and nothing
  else does — found it in one run, and now guards it.

### Changed

- **`search.query()` returns the whole envelope**, not just the hits. The
  response carries `facets` and a `tier` beside `items`, and a caller who only
  ever saw hits lost both. `queryAll()` yields hits alone, which is the right
  trade inside a loop.
- `contacts.journey()` and `conversations.unattended()` now return `Page<T>`,
  matching what the routes actually send.
- `macros.list()` returns a bare array and `macros.listAll()` is gone — see
  0.2.2. Two sibling SDKs built a paginator over that route; one of them read
  the bare array as an _empty page_ and returned it with a 200, which is worse
  than an error.

## 0.2.2

Two route facts that 0.2.1 had wrong. Both are breaking for the two methods
involved, and both were methods that could not work as shipped.

### Fixed

- **`billing.usage()` could never succeed.** `GET /v1/billing/usage` reports
  ONE meter over a window and validates `eventType` against a closed list
  before doing anything else, so a call with no query is a 400 — not a
  summary of everything. The signature is now
  `usage(eventType, { from, to })`. Four of the eight Chatly SDKs shipped it
  as optional and one sent no query at all.
- **`macros.list()` is not paginated.** The shared manifest marked it
  `paged`, and the handler is `@PaginationExempt`: it answers a bare array,
  capped at 200 and ordered by usage rank. `macros.listAll()` is gone, and
  `list()` returns the array. Two sibling SDKs built a paginator over it and
  raised a decode error on the real response — with green test suites, because
  a fake transport that answers every route with a page envelope agrees with
  the mistake.

## 0.2.1

Identical to 0.2.0 in content. npm left 0.2.0 in a **staged** state — a
publish that reserves the version without making it installable, which
`npm view` does not list and `npm install` answers with ETARGET — so the
number is unusable and 0.2.1 is the first release of this surface.

## 0.2.0 (never installable)

The typed surface goes from 9 methods to 55, and the SDK gains the behaviour
`packages/sdk-spec/CONTRACT.md` requires of every Chatly SDK.

### Added

- **55 typed methods** across 13 namespaces — contacts, conversations,
  tickets, macros, KB, search, CDP events, webhook deliveries, reports,
  channels, billing and workspace — every one a route an API key can actually
  call. The list is `packages/sdk-spec/surface.json`, shared with the Python,
  Go, Ruby, PHP, Java, .NET and Rust SDKs, and each SDK proves its coverage by
  executing every method and writing `surface.lock.json`.
- **A typed error hierarchy.** `ChatlyApiError` with `status`, `code`,
  `message`, `requestId`, `body` and `retryAfter`, plus
  `ChatlyAuthenticationError` (401), `ChatlyPermissionError` (403),
  `ChatlyNotFoundError` (404), `ChatlyConflictError` (409),
  `ChatlyValidationError` (400/422), `ChatlyRateLimitError` (429),
  `ChatlyServerError` (5xx) and a separate `ChatlyTransportError` for a
  request that never got a response. Previously every failure was
  `new Error("livechat 403: …")`, so telling "wrong key" from "missing scope"
  meant matching on a string.
- **Retries.** Three attempts by default on a connection failure, a 429 or a
  5xx, with exponential backoff and jitter, honouring `Retry-After`. Never on
  any other 4xx. One idempotency key is reused across the attempts of a single
  call, which is the only reason the header is safe to retry under.
- **Auto-pagination.** `listAll()` on every cursor-paginated list, as an async
  generator. It stops on a null cursor and throws rather than looping forever
  if the server repeats one.
- **`request(method, path, { query, body })`** — the escape hatch. 86 of the
  141 key-accessible routes have no typed method; this reaches all of them
  through the same auth, idempotency, retry and error handling.
- `chatlyIdentityHash` and `verifyWebhookSignature` are unchanged and still
  exported from the package root.

### Fixed

- **Three writes sent key names the API discards.** zod strips unknown keys,
  so each returned 200 having done nothing: `contacts.merge` sent
  `{ sourceContactId }` where the schema wants `{ mergedId }`;
  `contacts.addTags` sent `{ tags: [...] }` where the route takes one
  `{ tag }`; `contacts.unsubscribe` sent `{}` where `unsubscribed` is
  required. `tickets.merge` now takes `{ loserId }`.
- **`search.kb()` was not narrowing anything.** It sent `kinds[]=kb`, and the
  search query schema is a zod object with a key named `kinds`, so the
  bracketed key was stripped and the search ran across contacts,
  conversations, messages and tickets — returning a valid 200 the caller could
  not tell from a filtered one. It now sends a plain repeated `kinds`.
- **`retryAfter` was always null on a real 429.** The API's throttler names
  its buckets and emits `Retry-After-{bucket}`, never a plain `Retry-After`.
  The SDK reads both now and takes the longest; the API also derives the plain
  header.
- **`MessageInput.kind` was missing `attachment_only`** — the one kind you
  send when there are no words, only a file.
- Error bodies are read from the API's real nested envelope,
  `{ error: { code, message } }`, with a flat body as a fallback for proxy
  errors.
- `withIdempotencyKey()` no longer hand-rebuilds each namespace. The previous
  clone forgot `search`, so a derived client's search methods still dispatched
  through the parent — harmless while both were reads, a live bug the moment
  one was not.
- The published tarball no longer contains the compiled test files.

## 0.1.0

First release.
