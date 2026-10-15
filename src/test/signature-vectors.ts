/**
 * The cross-SDK signature vectors: one corpus, eight verifiers.
 *
 * ═══ WHY A CORPUS AND NOT EIGHT SPEC FILES ════════════════════════════════
 *
 * `verifyChatlySignature` is ported by hand into seven other languages
 * (ADR 0056 records why the SDKs are hand-written). Eight implementations of
 * one decision table drift the way the two price tables did, and the drift
 * that matters is not "does it verify a good signature" — every port gets
 * that right on day one — but the refusals: which REASON a stale
 * millisecond timestamp gets, whether a `b=b` marker on `unified_v2` is a
 * mismatch, whether a duplicated header is refused or trial-verified. A port
 * that disagrees there is a customer whose handler branches on `reason`
 * behaving differently by language.
 *
 * So the cases are DATA. `signature-vectors.spec.ts` writes them to
 * `signature-vectors.json` and fails if that file differs; every other SDK
 * carries a byte-identical copy and runs its own verifier over every vector.
 *
 * ═══ HOW THE EXPECTATIONS WERE WRITTEN ════════════════════════════════════
 *
 * By hand, from the decision table in `signatures.ts` — never by running the
 * verifier and recording what it said. A corpus recorded from the reference
 * implementation agrees with the reference implementation's bugs; this one
 * is checked AGAINST it, and the sdk-node spec is the first port that has to
 * pass.
 *
 * Every digest is HMAC-SHA256 over a base string written out literally.
 *
 * `message` is not in the corpus. It is written to be read by a human in the
 * caller's language and its wording is each SDK's own; `reason` is the
 * stable string, and it is the one compared.
 */ import {
  BODY,
  METHOD,
  MS,
  NOW,
  OLD,
  PATH,
  SECRET,
  T,
  UTF8_BODY,
  bodyBase,
  mac,
  no,
  okT,
  target,
  targetBase,
  tv1,
  v2t,
  type SignatureVector,
} from './signature-vector-kit.js';
import { REFUSAL_VECTORS } from './signature-vectors-refusals.js';

export type { SignatureVector } from './signature-vector-kit.js';

export const SIGNATURE_VECTORS: readonly SignatureVector[] = [
  // ── Every surface, genuine ────────────────────────────────────────────────
  {
    name: 'unified_v2 verifies t.METHOD.path.body',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: okT('unified_v2', 'target', NOW),
  },
  {
    name: 'agent_delivery verifies t.body',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('agent_delivery', 'body', NOW),
  },
  {
    name: 'event_webhook verifies t.body on x-livechat-signature',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'ai_tool_call verifies t.METHOD.path.body on x-chatly-signature',
    input: {
      surface: 'ai_tool_call',
      body: '',
      headers: {
        'x-chatly-signature': tv1(SECRET, targetBase('', T, 'GET', '/orders/4471?expand=lines')),
      },
      secret: SECRET,
      method: 'get',
      path: '/orders/4471?expand=lines',
      nowMs: NOW,
    },
    expect: okT('ai_tool_call', 'target', NOW),
  },
  {
    name: 'canvas_step verifies ms.body with the timestamp in MILLISECONDS',
    input: {
      surface: 'canvas_step',
      body: BODY,
      headers: {
        'x-chatly-canvas-ts': MS,
        'x-chatly-canvas-signature': `sha256=${mac(SECRET, `${MS}.${BODY}`)}`,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('canvas_step', 'body', NOW + 789),
  },
  {
    name: 'customer_card verifies ms.body with the timestamp in MILLISECONDS',
    input: {
      surface: 'customer_card',
      body: BODY,
      headers: {
        'x-chatly-timestamp': MS,
        'x-chatly-signature': `sha256=${mac(SECRET, `${MS}.${BODY}`)}`,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('customer_card', 'body', NOW + 789),
  },
  {
    name: 'workflow_webhook verifies the body base with no marker',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('workflow_webhook', 'body', NOW),
  },
  {
    name: 'workflow_webhook_legacy verifies the body alone on explicit opt-in, with no timestamp',
    input: {
      surface: 'workflow_webhook_legacy',
      body: BODY,
      headers: { 'x-chatly-signature': `sha256=${mac(SECRET, BODY)}` },
      secret: SECRET,
      allowUnprotectedReplay: true,
      nowMs: NOW,
    },
    expect: okT('workflow_webhook_legacy', 'body_only', null),
  },

  // ── Bytes, case, shape ─────────────────────────────────────────────────────
  {
    name: 'the body is HMACed as UTF-8 bytes',
    input: {
      surface: 'event_webhook',
      body: UTF8_BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase(UTF8_BODY)) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'header names are matched case-insensitively',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'X-LiveChat-Signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'an upper-case hex digest verifies',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: {
        'x-livechat-signature': `t=${String(T)},v1=${mac(SECRET, bodyBase()).toUpperCase()}`,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'spaces and unknown fields in the value are tolerated',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: {
        'x-livechat-signature': ` t=${String(T)} , v9=ignored , v1=${mac(SECRET, bodyBase())} `,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'the method is case-normalised into the base string',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      method: 'post',
      path: PATH,
      nowMs: NOW,
    },
    expect: okT('unified_v2', 'target', NOW),
  },
  {
    name: 'the FIRST t wins, so an appended t cannot move the window',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': `${tv1(SECRET, bodyBase())},t=${String(T - 100_000)}` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('event_webhook', 'body', NOW),
  },

  // ── Rotation ───────────────────────────────────────────────────────────────
  {
    name: 'a secret array reports which secret verified',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(OLD, bodyBase()) },
      secret: [SECRET, OLD],
      nowMs: NOW,
    },
    expect: okT('agent_delivery', 'body', NOW, 1),
  },
  {
    name: 'an empty string in a secret array is skipped, and secretIndex still indexes the array given',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()) },
      secret: ['', SECRET],
      nowMs: NOW,
    },
    expect: okT('agent_delivery', 'body', NOW, 1),
  },
  {
    name: 'a header carrying two v1 digests verifies when either matches',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: {
        'x-chatly-signature': `t=${String(T)},v1=${mac(OLD, bodyBase())},v1=${mac(SECRET, bodyBase())}`,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('agent_delivery', 'body', NOW),
  },

  // ── The v2 policy ──────────────────────────────────────────────────────────
  {
    name: 'prefer: v2 present with method/path is what verifies, reported as unified_v2',
    input: {
      surface: 'customer_card',
      body: BODY,
      headers: {
        'x-chatly-timestamp': MS,
        'x-chatly-signature': `sha256=${mac(SECRET, `${MS}.${BODY}`)}`,
        'x-chatly-signature-v2': v2t(),
      },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: okT('unified_v2', 'target', NOW),
  },
  {
    name: 'prefer: v2 present WITHOUT method/path falls through to the legacy header',
    input: {
      surface: 'canvas_step',
      body: BODY,
      headers: {
        'x-chatly-canvas-ts': MS,
        'x-chatly-canvas-signature': `sha256=${mac(SECRET, `${MS}.${BODY}`)}`,
        'x-chatly-signature-v2': v2t(),
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('canvas_step', 'body', NOW + 789),
  },
  {
    name: 'prefer never cross-falls-back: a bad v2 beside a good legacy header is refused',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()), 'x-chatly-signature-v2': v2t(OLD) },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: no('unified_v2', 'signature_mismatch'),
  },
  {
    name: 'ignore: the legacy header verifies even beside a bad v2',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()), 'x-chatly-signature-v2': v2t(OLD) },
      secret: SECRET,
      ...target,
      v2: 'ignore',
      nowMs: NOW,
    },
    expect: okT('agent_delivery', 'body', NOW),
  },
  {
    name: 'require: no v2 header is missing_signature_header',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      ...target,
      v2: 'require',
      nowMs: NOW,
    },
    expect: no('agent_delivery', 'missing_signature_header'),
  },
  {
    name: 'require: v2 present without method/path is missing_request_target',
    input: {
      surface: 'agent_delivery',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      v2: 'require',
      nowMs: NOW,
    },
    expect: no('agent_delivery', 'missing_request_target'),
  },
  {
    name: 'unified_v2 with no method/path is missing_request_target',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('unified_v2', 'missing_request_target'),
  },
  {
    name: 'unified_v2 signed for another path is a mismatch',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      method: METHOD,
      path: '/hooks/chatly',
      nowMs: NOW,
    },
    expect: no('unified_v2', 'signature_mismatch'),
  },

  // ── The base marker ────────────────────────────────────────────────────────
  {
    name: 'marker: unified_v2 refuses b=b',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, bodyBase())},b=b` },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: no('unified_v2', 'signature_mismatch'),
  },
  {
    name: 'marker: unified_v2 still verifies an ABSENT marker over the target base',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': tv1(SECRET, targetBase()) },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: okT('unified_v2', 'target', NOW),
  },
  {
    name: 'marker: a forged b=t cannot make a body digest verify on unified_v2',
    input: {
      surface: 'unified_v2',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, bodyBase())},b=t` },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: no('unified_v2', 'signature_mismatch'),
  },
  {
    name: 'marker: workflow_webhook b=t with no method/path is missing_request_target',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('workflow_webhook', 'missing_request_target'),
  },
  {
    name: 'marker: workflow_webhook b=t with method/path verifies the target base',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: okT('workflow_webhook', 'target', NOW),
  },
  {
    name: 'marker: workflow_webhook b=t NARROWS — a body digest marked b=t is refused',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, bodyBase())},b=t` },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: no('workflow_webhook', 'signature_mismatch'),
  },
  {
    name: 'marker: workflow_webhook b=b verifies the body base even when given method/path',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, bodyBase())},b=b` },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: okT('workflow_webhook', 'body', NOW),
  },
  {
    name: 'marker: workflow_webhook b=b NARROWS — a target digest marked b=b is refused',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, targetBase())},b=b` },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: no('workflow_webhook', 'signature_mismatch'),
  },
  {
    name: 'marker: workflow_webhook b=b under require is refused',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, bodyBase())},b=b` },
      secret: SECRET,
      ...target,
      v2: 'require',
      nowMs: NOW,
    },
    expect: no('workflow_webhook', 'signature_mismatch'),
  },
  {
    name: 'marker: workflow_webhook absent marker + method/path accepts the target base',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': tv1(SECRET, targetBase()) },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: okT('workflow_webhook', 'target', NOW),
  },
  {
    name: 'marker: workflow_webhook ignore reads only the body base, whatever the marker',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': v2t() },
      secret: SECRET,
      ...target,
      v2: 'ignore',
      nowMs: NOW,
    },
    expect: no('workflow_webhook', 'signature_mismatch'),
  },
  {
    name: 'marker: the FIRST b wins',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${v2t()},b=b` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('workflow_webhook', 'missing_request_target'),
  },
  {
    name: 'marker: an unknown marker is treated as absent',
    input: {
      surface: 'workflow_webhook',
      body: BODY,
      headers: { 'x-chatly-signature-v2': `${tv1(SECRET, bodyBase())},b=z` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: okT('workflow_webhook', 'body', NOW),
  },
  ...REFUSAL_VECTORS,
];
