/**
 * Fixtures for the `verifyChatlySignature` specs.
 *
 * ═══ WHY THESE SIGN BY HAND, AND WHY THEY ARE NOT AN IMPORT ═══════════════
 *
 * Every signature here is built with `node:crypto` from the base string
 * written out literally, rather than imported from
 * `@livechat/shared/webhook-signature`. Two reasons, and the second is the
 * load-bearing one:
 *
 *  1. The specs beside this file are mirrored verbatim into the public
 *     `chatlychat/chatly-sdk-node` repository, and `sync-sdk-repos.mjs`
 *     DROPS any spec that imports a private workspace package.
 *     `index.spec.ts` lost all thirty-eight of its tests that way once, over
 *     a ten-line array helper, and the mirror's CI is the only CI this
 *     project has that runs.
 *
 *  2. A test that signs with the same function the verifier was written from
 *     proves the two agree, not that either is right. Writing the base string
 *     out — `${t}.${body}`, `${t}.${METHOD}.${path}.${body}`, `${ts}.${body}`,
 *     `${body}` — makes the construction readable beside the assertion, so a
 *     change to it has to be made twice and deliberately.
 *
 * ── Why it lives in `src/test/` ──────────────────────────────────────────
 *
 * `tsconfig.build.json` excludes `src/test/**` as well as `*.spec.ts`, so
 * nothing in here reaches `dist/` or the published tarball — four packages in
 * this repo once shipped their own compiled specs to npm. `tsconfig.json`
 * still reads it, so it is typechecked.
 */
import { createHmac } from 'node:crypto';

import type {
  ChatlySignatureSurface,
  VerifyChatlySignatureInput,
  VerifyChatlySignatureResult,
} from '../signatures.js';

export const SECRET = 'whsec_surface_secret';
export const OTHER_SECRET = 'whsec_a_different_surface';
export const BODY = '{"id":"evt_1","type":"message.created"}';

/** Unix seconds and milliseconds for one fixed instant. */
export const NOW_SECONDS = 1_760_000_000;
export const NOW_MS = NOW_SECONDS * 1000;

export function hmac(secret: string, base: string): string {
  return createHmac('sha256', secret).update(base).digest('hex');
}

/** Narrow a result to its failure arm, with a message naming what happened. */
export function refused(result: VerifyChatlySignatureResult): {
  reason: string;
  message: string;
} {
  if (result.ok) {
    throw new Error('expected a refusal, got ok: true');
  }
  return { reason: result.reason, message: result.message };
}

/**
 * The per-surface table these tests walk.
 *
 * `headersFor` builds a genuine request for that surface at `tsSeconds`;
 * `extra` carries whatever else the surface needs in the input (the method
 * and path for a tool call, the legacy opt-in for the old workflow header).
 */
export interface SurfaceCase {
  readonly surface: ChatlySignatureSurface;
  readonly headersFor: (opts: {
    secret: string;
    body: string;
    tsSeconds: number;
  }) => Record<string, string>;
  readonly extra?: Partial<VerifyChatlySignatureInput>;
  /** Milliseconds surfaces: a seconds timestamp here is the unit mistake. */
  readonly unit: 'seconds' | 'milliseconds' | null;
}

export const TOOL_METHOD = 'GET';
export const TOOL_PATH = '/orders/4471?expand=lines';

export const CASES: readonly SurfaceCase[] = [
  {
    surface: 'agent_delivery',
    unit: 'seconds',
    headersFor: ({ secret, body, tsSeconds }) => ({
      'x-chatly-signature': `t=${String(tsSeconds)},v1=${hmac(secret, `${String(tsSeconds)}.${body}`)}`,
    }),
  },
  {
    surface: 'event_webhook',
    unit: 'seconds',
    headersFor: ({ secret, body, tsSeconds }) => ({
      'x-livechat-signature': `t=${String(tsSeconds)},v1=${hmac(secret, `${String(tsSeconds)}.${body}`)}`,
    }),
  },
  {
    surface: 'ai_tool_call',
    unit: 'seconds',
    extra: { method: TOOL_METHOD, path: TOOL_PATH },
    headersFor: ({ secret, body, tsSeconds }) => ({
      'x-chatly-signature':
        `t=${String(tsSeconds)},` +
        `v1=${hmac(secret, `${String(tsSeconds)}.${TOOL_METHOD}.${TOOL_PATH}.${body}`)}`,
    }),
  },
  {
    surface: 'canvas_step',
    unit: 'milliseconds',
    headersFor: ({ secret, body, tsSeconds }) => {
      const ts = String(tsSeconds * 1000);
      return {
        'x-chatly-canvas-ts': ts,
        'x-chatly-canvas-signature': `sha256=${hmac(secret, `${ts}.${body}`)}`,
      };
    },
  },
  {
    surface: 'customer_card',
    unit: 'milliseconds',
    headersFor: ({ secret, body, tsSeconds }) => {
      const ts = String(tsSeconds * 1000);
      return {
        'x-chatly-timestamp': ts,
        'x-chatly-signature': `sha256=${hmac(secret, `${ts}.${body}`)}`,
      };
    },
  },
  {
    surface: 'workflow_webhook',
    unit: 'seconds',
    headersFor: ({ secret, body, tsSeconds }) => ({
      // The real action sends all three; a v2 verifier reads only this one.
      'x-chatly-signature': `sha256=${hmac(secret, body)}`,
      'x-chatly-timestamp': String(tsSeconds),
      'x-chatly-signature-v2': `t=${String(tsSeconds)},v1=${hmac(secret, `${String(tsSeconds)}.${body}`)}`,
    }),
  },
  {
    surface: 'workflow_webhook_legacy',
    unit: null,
    extra: { allowUnprotectedReplay: true },
    headersFor: ({ secret, body }) => ({
      'x-chatly-signature': `sha256=${hmac(secret, body)}`,
    }),
  },
];
