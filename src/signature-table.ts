/**
 * Which outbound surfaces Chatly signs, and what each one signs.
 *
 * ═══ THE TABLE IS THE POINT ═══════════════════════════════════════════════
 *
 * Split out of `signatures.ts` (650-line ceiling) so the data and the
 * verifier can each be read on its own. `signatures.ts` re-exports
 * everything here, so `import … from './signatures.js'` is unchanged and the
 * published entry point is unchanged.
 *
 *   | surface                   | header(s)                                             | base string                      | `t` unit |
 *   | ------------------------- | ----------------------------------------------------- | -------------------------------- | -------- |
 *   | `unified_v2`              | `x-chatly-signature-v2: t=…,v1=…`                     | `<t>.<METHOD>.<path>.<rawBody>`  | seconds  |
 *   | `agent_delivery`          | `x-chatly-signature: t=…,v1=…`                        | `<t>.<rawBody>`                  | seconds  |
 *   | `event_webhook`           | `x-livechat-signature: t=…,v1=…`                      | `<t>.<rawBody>`                  | seconds  |
 *   | `ai_tool_call`            | `x-chatly-signature: t=…,v1=…`                        | `<t>.<METHOD>.<path>.<rawBody>`  | seconds  |
 *   | `canvas_step`             | `x-chatly-canvas-signature: sha256=…` + `-ts`         | `<ts>.<rawBody>`                 | **ms**   |
 *   | `customer_card`           | `x-chatly-signature: sha256=…` + `x-chatly-timestamp` | `<ts>.<rawBody>`                 | **ms**   |
 *   | `workflow_webhook`        | `x-chatly-signature-v2: t=…,v1=…`                     | `<t>.<rawBody>`                  | seconds  |
 *   | `workflow_webhook_legacy` | `x-chatly-signature: sha256=…`                        | `<rawBody>` — **no timestamp**   | n/a      |
 *
 * **Three surfaces send `x-chatly-signature` and they sign three different
 * strings.** Agent delivery signs `<t>.<body>` under a `t=…,v1=…` value; a
 * tool call signs `<t>.<METHOD>.<path>.<body>` under the same-looking value;
 * a customer-card fetch signs `<ts>.<body>` with the timestamp in a SEPARATE
 * header and the value prefixed `sha256=`. A verifier that keys on the header
 * name can therefore be pointed at the wrong construction while looking
 * completely correct, which is why `surface` is required and is not inferred.
 *
 * ── `unified_v2`, and the one place it collides ──────────────────────────
 *
 * `unified_v2` is the construction every surface is MOVING to:
 * `x-chatly-signature-v2: t=<unix seconds>,v1=<hex>` over
 * `<t>.<METHOD>.<path>.<rawBody>`, sent ALONGSIDE each surface's legacy
 * header so nothing breaks while senders migrate. The method and the path are
 * in the base string for the reason `ai_tool_call` already has them: a `GET`
 * with no body signs `"<t>.."` otherwise, which is identical for every GET
 * that surface ever makes and replayable against any path.
 *
 * `workflow_webhook` ALREADY sends `x-chatly-signature-v2`, and it signs
 * `<t>.<rawBody>` — the v2 header predates the unified base. So the same
 * header name carries two base strings until the workflow sender moves. That
 * is handled here rather than wished away: `workflow_webhook` accepts the
 * unified base as well, whenever the caller supplies `method` and `path`, so
 * a receiver that passes both keeps verifying across the sender's switch.
 * `unified_v2` is strict and accepts only the target base.
 *
 * ── The unit trap, which this repo has paid for twice ────────────────────
 *
 * Two surfaces send MILLISECONDS. A millisecond timestamp read as seconds
 * lands around the year 55,000 — roughly 54,000 years out — so a tolerance
 * check on it rejects every genuine request, and the failure looks like a
 * wrong secret. The signing scheme in `@livechat/shared` shipped the mirror
 * image of this once: it emitted milliseconds in the header while signing a
 * seconds value, and a verifier that followed our own published docs exactly
 * refused 100% of real traffic. So the unit is a property of the SURFACE
 * here, never of the value.
 */

/** Which outbound surface produced the request being verified. */
export type ChatlySignatureSurface =
  | 'unified_v2'
  | 'agent_delivery'
  | 'event_webhook'
  | 'ai_tool_call'
  | 'canvas_step'
  | 'customer_card'
  | 'workflow_webhook'
  | 'workflow_webhook_legacy';

/** Why a verification failed. Stable strings, safe to branch on. */
export type ChatlySignatureFailure =
  | 'unknown_surface'
  | 'missing_secret'
  | 'missing_signature_header'
  | 'duplicate_signature_header'
  | 'malformed_signature_header'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'timestamp_outside_tolerance'
  | 'missing_request_target'
  | 'replay_unprotected'
  | 'signature_mismatch';

/**
 * Headers as a server framework hands them over.
 *
 * Structurally compatible with Node's `IncomingHttpHeaders` and with
 * `Object.fromEntries(request.headers)` from a `Request`. A `Headers`
 * instance is not accepted directly, on purpose: it is not a plain object and
 * silently reading `undefined` off one is exactly the class of bug the
 * README's three-way-wrong snippet was.
 */
export type ChatlyHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** Five minutes, matching `SIGNATURE_TOLERANCE_SECONDS` on the producing side. */
export const CHATLY_SIGNATURE_TOLERANCE_SECONDS = 300;

/** The header the unified construction travels in, on every surface. */
export const CHATLY_V2_SIGNATURE_HEADER = 'x-chatly-signature-v2';

/**
 * Not a header name: the timestamp is the digest header's own `t=` field.
 *
 * A sentinel rather than a boolean, so a surface that moves its timestamp
 * into a header of its own needs only a table edit.
 */
export const IN_SIGNATURE = 'in-signature';

/**
 * Which string the MAC is taken over.
 *
 * - `body`        → `<t>.<rawBody>`
 * - `target`      → `<t>.<METHOD>.<path>.<rawBody>` (the unified base)
 * - `body_only`   → `<rawBody>`, no timestamp anywhere — unbounded replay
 */
export type ChatlySignatureBase = 'body' | 'target' | 'body_only';

export interface SurfaceSpec {
  /** The header carrying the digest. */
  readonly signatureHeader: string;
  /**
   * Where `t` comes from: the name of the header carrying it on its own, or
   * the sentinel {@link IN_SIGNATURE} when it is the digest header's own `t=`
   * field, or `null` when the surface sends none.
   *
   * Typed `string | null` rather than `'in-signature' | string | null`,
   * because a literal in a union with `string` is absorbed by it and reads as
   * a type that narrows when it does not.
   */
  readonly timestampFrom: string | null;
  /** `t=…,v1=<hex>` or `sha256=<hex>`. */
  readonly format: 'tv1' | 'sha256';
  /** The unit of whatever `timestampFrom` yields. `null` when there is none. */
  readonly unit: 'seconds' | 'milliseconds' | null;
  /** The string the MAC is taken over. */
  readonly base: ChatlySignatureBase;
  /**
   * True when the UNIFIED base is also accepted on this surface's own
   * header, for a sender mid-migration. Only `workflow_webhook`, which sent
   * `x-chatly-signature-v2` before the base gained the method and path.
   */
  readonly alsoAcceptsTargetBase?: true;
  /** A one-line description, for an error message and for documentation. */
  readonly describe: string;
}

/**
 * The table, as data.
 *
 * Exported because it is the thing to read when a verification fails, and
 * because keeping it as data rather than a `switch` is what lets a test
 * assert that every surface in the union has an entry — a surface added to
 * the type and forgotten here would otherwise be an `unknown_surface`
 * refusal at runtime with a green suite.
 */
export const CHATLY_SIGNATURE_SURFACES: Readonly<Record<ChatlySignatureSurface, SurfaceSpec>> = {
  unified_v2: {
    signatureHeader: CHATLY_V2_SIGNATURE_HEADER,
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    base: 'target',
    describe:
      'the unified v2 signature, sent alongside every surface’s legacy header, over ' +
      't.METHOD.path.body',
  },
  agent_delivery: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    base: 'body',
    describe: "external-agent push delivery, signed with the bot's signingSecret",
  },
  event_webhook: {
    signatureHeader: 'x-livechat-signature',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    base: 'body',
    describe: "event webhook, signed with that subscription's whsec_ secret",
  },
  ai_tool_call: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    base: 'target',
    describe: "custom AI tool call, signed with that tool's secret over t.METHOD.path.body",
  },
  canvas_step: {
    signatureHeader: 'x-chatly-canvas-signature',
    timestampFrom: 'x-chatly-canvas-ts',
    format: 'sha256',
    unit: 'milliseconds',
    base: 'body',
    describe: 'canvas / interactive-step callback, timestamp in MILLISECONDS',
  },
  customer_card: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: 'x-chatly-timestamp',
    format: 'sha256',
    unit: 'milliseconds',
    base: 'body',
    describe: 'customer-card fetch, timestamp in MILLISECONDS',
  },
  workflow_webhook: {
    signatureHeader: CHATLY_V2_SIGNATURE_HEADER,
    timestampFrom: IN_SIGNATURE,
    format: 'tv1',
    unit: 'seconds',
    base: 'body',
    // The one surface that sent the v2 header before the base gained the
    // method and path. See this file's header.
    alsoAcceptsTargetBase: true,
    describe: 'workflow "call a webhook" action, replay-bounded v2 header',
  },
  workflow_webhook_legacy: {
    signatureHeader: 'x-chatly-signature',
    timestampFrom: null,
    format: 'sha256',
    unit: null,
    base: 'body_only',
    describe: 'workflow action, LEGACY header over the body alone — no replay protection',
  },
};
