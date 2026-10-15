/**
 * The constants and hand-written signers the signature corpus is built from.
 *
 * Split from `signature-vectors.ts` (650-line ceiling). Every digest is
 * HMAC-SHA256 over a base string written out literally; nothing here calls
 * the code under test. See that file's header for why.
 */
import { createHmac } from 'node:crypto';

export interface SignatureVector {
  readonly name: string;
  readonly input: {
    readonly surface: string;
    /** UTF-8. Verified as BYTES — one vector carries non-ASCII to prove it. */
    readonly body: string;
    /** A string, or an array for a header that arrived more than once. */
    readonly headers: Readonly<Record<string, string | readonly string[]>>;
    readonly secret: string | readonly string[];
    readonly method?: string;
    readonly path?: string;
    readonly v2?: 'prefer' | 'require' | 'ignore';
    readonly allowUnprotectedReplay?: boolean;
    readonly toleranceSeconds?: number;
    /** Unix MILLISECONDS. Every vector pins the clock. */
    readonly nowMs: number;
  };
  readonly expect:
    | {
        readonly ok: true;
        readonly surface: string;
        readonly base: 'body' | 'target' | 'body_only';
        readonly secretIndex: number;
        readonly timestampMs: number | null;
      }
    | { readonly ok: false; readonly surface: string; readonly reason: string };
}

export const SECRET = 'whsec_vector_secret';
export const OLD = 'whsec_vector_old';
export const BODY = '{"id":"evt_1","type":"message.created"}';
// Non-ASCII on purpose: a port that HMACs UTF-16 code units, or Latin-1, or
// a "string length" instead of bytes fails exactly this vector.
export const UTF8_BODY = '{"text":"café — 你好 🙂"}';
export const T = 1_760_000_000;
export const NOW = T * 1000;
export const MS = String(NOW + 789);
export const METHOD = 'POST';
export const PATH = '/hooks/chatly?tenant=acme';

export function mac(secret: string, base: string): string {
  return createHmac('sha256', secret).update(base, 'utf8').digest('hex');
}

export const tv1 = (secret: string, base: string, t = T): string =>
  `t=${String(t)},v1=${mac(secret, base)}`;
export const bodyBase = (body = BODY, t = T): string => `${String(t)}.${body}`;
export const targetBase = (body = BODY, t = T, method = METHOD, path = PATH): string =>
  `${String(t)}.${method}.${path}.${body}`;
export const v2t = (secret = SECRET, body = BODY, t = T): string =>
  `${tv1(secret, targetBase(body, t), t)},b=t`;

export const okT = (
  surface: string,
  base: 'body' | 'target' | 'body_only',
  timestampMs: number | null,
  secretIndex = 0,
) => ({ ok: true, surface, base, secretIndex, timestampMs }) as const;
export const no = (surface: string, reason: string) => ({ ok: false, surface, reason }) as const;

export const target = { method: METHOD, path: PATH } as const;
