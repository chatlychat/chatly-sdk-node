/**
 * The published contract of `verifyChatlySignature`: what you hand it, and
 * what it hands back.
 *
 * ═══ WHY THIS IS A REAL SEAM ══════════════════════════════════════════════
 *
 * Two independent reasons, and the second one is the load-bearing half.
 *
 * 1. **A type declaration cannot import an implementation.** Everything here
 *    is `type`/`interface` over `signature-table.ts`'s vocabulary — a
 *    surface, a base, a failure reason, a header map. Nothing in this file
 *    can reach `createHmac`, a policy decision or a comparison, so the cut
 *    is one the compiler enforces rather than one a convention asks for.
 *    It is also the cut with no cycle: `signatures.ts` imports these, and
 *    `verifyChatlySignature` calls itself through `applyV2Policy`, so any
 *    seam that took CODE out of that recursion would have to import back.
 *
 * 2. **This is the half a consumer reads.** `@chatlychat/sdk-node` is the
 *    reference implementation the seven other backend SDKs are checked
 *    against, and what they are checked against is this shape: `surface`,
 *    `body`, `headers`, `secret`, the three policy switches, and a
 *    discriminated result whose `reason` is the field the cross-SDK vector
 *    corpus compares. The field docblocks below are the specification those
 *    ports are written from. They are not notes about an algorithm; they are
 *    the contract, and the algorithm is `signatures.ts`.
 *
 * Fifth split out of `signatures.ts` for the repo's 650-line ceiling, after
 * `signature-table.ts` (the data), `signature-mint.ts` (the other direction),
 * `signature-caller-input.ts` (what the caller got wrong) and
 * `signature-message.ts` (refusal text). `signatures.ts` re-exports all three
 * names here, so `import … from './signatures.js'` and the package entry
 * point are both unchanged.
 */
import type {
  ChatlyHeaders,
  ChatlySignatureBase,
  ChatlySignatureFailure,
  ChatlySignatureSurface,
} from './signature-table.js';

/**
 * How hard to insist on the unified v2 construction.
 *
 * The three policies and why `'prefer'` is the default are in `signatures.ts`'s
 * header, which is where the decision is taken. (That sentence read "see this
 * file's header" while this type lived there; the only edit is the pointer.)
 */
export type ChatlyV2Policy = 'prefer' | 'require' | 'ignore';

export interface VerifyChatlySignatureInput {
  /** Which surface this request came from. See `signature-table.ts`. */
  readonly surface: ChatlySignatureSurface;
  /**
   * The EXACT bytes received, before any JSON parsing. Re-serialising parsed
   * JSON reorders keys and changes whitespace, and the digest will not match.
   */
  readonly body: string | Uint8Array;
  /** The request's headers. Looked up case-insensitively. */
  readonly headers: ChatlyHeaders;
  /**
   * The secret for THIS surface, or every secret that is currently live on
   * it. No secret verifies across two surfaces.
   */
  readonly secret: string | readonly string[];
  /**
   * Freshness window, always in SECONDS whatever unit the surface's timestamp
   * is in. Defaults to {@link CHATLY_SIGNATURE_TOLERANCE_SECONDS}. Rejects
   * stale AND far-future timestamps. Pass `Infinity` only when re-verifying
   * something out of an archive.
   */
  readonly toleranceSeconds?: number;
  /**
   * The HTTP method of the request, which is inside the signed string on
   * `unified_v2` and `ai_tool_call`. Case is normalised. Supplying it on any
   * surface is what lets `v2: 'prefer'` pick up the v2 header when it
   * appears.
   */
  readonly method?: string;
  /**
   * `pathname + search` of the request, which is inside the signed string on
   * `unified_v2` and `ai_tool_call`. Never the scheme or the host — see
   * `toolRequestPath` in `@livechat/shared/ai-tools`.
   */
  readonly path?: string;
  /** How hard to insist on the v2 header. Default `'prefer'`. */
  readonly v2?: ChatlyV2Policy;
  /**
   * `workflow_webhook_legacy` only, and required there.
   *
   * That surface signs the body with NO timestamp, so a captured request
   * verifies forever and this function cannot bound a replay. Verifying it
   * has to be a deliberate choice, so the default is a refusal that names
   * `workflow_webhook` instead.
   */
  readonly allowUnprotectedReplay?: boolean;
  /** Escape hatch for tests. Unix MILLISECONDS. */
  readonly nowMs?: number;
}

export type VerifyChatlySignatureResult =
  | {
      readonly ok: true;
      /**
       * What actually verified — `'unified_v2'` when the v2 header was
       * preferred over the surface asked for.
       */
      readonly surface: ChatlySignatureSurface;
      /**
       * When the sender says it signed, in Unix milliseconds — normalised, so
       * a seconds surface and a milliseconds surface are comparable. `null`
       * on `workflow_webhook_legacy`, which sends no timestamp.
       */
      readonly timestampMs: number | null;
      /** Which string the matching MAC was taken over. */
      readonly base: ChatlySignatureBase;
      /**
       * Index into the `secret` array that verified, or `0` for a single
       * secret. During a rotation this is how you learn the old secret is
       * no longer in use.
       */
      readonly secretIndex: number;
    }
  | {
      readonly ok: false;
      readonly surface: ChatlySignatureSurface;
      readonly reason: ChatlySignatureFailure;
      /** A sentence written to be printed to whoever has to fix it. */
      readonly message: string;
    };
