/**
 * Minting a v2 signature — the other direction from `signatures.ts`.
 *
 * Verifying is what a customer's handler does, and it lives next door.
 * Minting is what a TEST harness and the `chatly listen` tunnel do, and both
 * live outside this monorepo's reach: `apps/cli` builds with plain `tsc` and
 * publishes `dist` declaring only `@chatlychat/sdk-node`, so an import of
 * `@livechat/shared` from there would emit a reference to a package that is
 * not on npm and `npm i -g @chatlychat/cli` would fail at run time with
 * MODULE_NOT_FOUND — a break nothing in the monorepo would see, because
 * there the import resolves.
 *
 * Its own file because `signatures.ts` reached 680 of the repository's
 * 650-line ceiling the moment this was added to it.
 *
 * So there are two implementations of one construction — this one, published,
 * and `packages/shared/src/webhook-signature/v2.ts`, which the API and the
 * worker send with. That is the same trade ADR 0056 records for the eleven
 * hand-written SDKs, and it is only safe because the two are held against
 * each other: `packages/shared/src/webhook-signature/v2.parity.spec.ts`
 * calls BOTH real functions and asserts byte-identical output over a corpus
 * chosen for where they could differ. A spec asserting each against its own
 * expected string would pass while they disagree.
 */
import { createHmac } from 'node:crypto';

/** Which string a v2 signature was taken over. */
export type ChatlyV2MintBase = 'target' | 'body';

export interface MintChatlyV2Input {
  /**
   * `target` signs `<t>.<METHOD>.<path>.<rawBody>` and `body` signs
   * `<t>.<rawBody>`. There is no default: the two are indistinguishable
   * without the marker this emits, which is the whole reason the marker
   * exists, so a caller has to say which one it means.
   */
  readonly base: ChatlyV2MintBase;
  readonly secret: string;
  /** Unix SECONDS, not milliseconds. */
  readonly timestampSeconds: number;
  /** The exact bytes that will be sent as the body. */
  readonly body: string;
  /** Required for `target`, ignored for `body`. */
  readonly method?: string;
  /** `pathname + search` of the request line, required for `target`. */
  readonly path?: string;
}

/** The exact string the MAC is taken over, exported so a test can pin it. */
export function chatlyV2BaseString(input: MintChatlyV2Input): string {
  const t = String(input.timestampSeconds);
  if (input.base === 'body') {
    return `${t}.${input.body}`;
  }
  return `${t}.${(input.method ?? '').toUpperCase()}.${input.path ?? ''}.${input.body}`;
}

/**
 * The `x-chatly-signature-v2` value for one request: `t=…,v1=…,b=…`.
 *
 * `b=t` for the unified base and `b=b` for the body base. **An absent marker
 * means the body base** — every signature minted before the marker existed
 * was that construction, so a verifier must keep reading its absence that
 * way rather than as "unknown".
 */
export function signChatlyV2(input: MintChatlyV2Input): string {
  const digest = createHmac('sha256', input.secret).update(chatlyV2BaseString(input)).digest('hex');
  return `t=${String(input.timestampSeconds)},v1=${digest},b=${input.base === 'target' ? 't' : 'b'}`;
}

/**
 * `pathname + search` of a destination URL, or `null` when it will not parse.
 *
 * `null` rather than a throw, and rather than a `'/'` fallback: a guessed
 * path signs a string the receiver cannot reproduce, which arrives as
 * "signature mismatch" and sends an integrator hunting their own secret.
 */
export function chatlyV2SigningPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
