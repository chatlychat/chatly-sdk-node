/**
 * The second half of the signature corpus: time, refusals before any crypto,
 * and the three surfaces that share a header name.
 *
 * Split from `signature-vectors.ts` (650-line ceiling) and spread back into
 * `SIGNATURE_VECTORS` at the END, so the order — and therefore the JSON every
 * other SDK reads — is unchanged by the split.
 */
import {
  BODY,
  MS,
  NOW,
  OLD,
  SECRET,
  T,
  bodyBase,
  mac,
  no,
  okT,
  target,
  targetBase,
  tv1,
  type SignatureVector,
} from './signature-vector-kit.js';

export const REFUSAL_VECTORS: readonly SignatureVector[] = [
  // ── Time ───────────────────────────────────────────────────────────────────
  {
    name: 'a seconds surface 301s stale is outside tolerance',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW + 301_000,
    },
    expect: no('event_webhook', 'timestamp_outside_tolerance'),
  },
  {
    name: 'exactly 300s stale is inside tolerance',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW + 300_000,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'a far-future timestamp is refused too',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW - 301_000,
    },
    expect: no('event_webhook', 'timestamp_outside_tolerance'),
  },
  {
    name: 'toleranceSeconds widens the window',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      toleranceSeconds: 3600,
      nowMs: NOW + 3_000_000,
    },
    expect: okT('event_webhook', 'body', NOW),
  },
  {
    name: 'a SECONDS value on a milliseconds surface is the unit trap, refused on time',
    input: {
      surface: 'customer_card',
      body: BODY,
      headers: {
        'x-chatly-timestamp': String(T),
        'x-chatly-signature': `sha256=${mac(SECRET, `${String(T)}.${BODY}`)}`,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('customer_card', 'timestamp_outside_tolerance'),
  },
  {
    name: 'a non-digit timestamp is malformed',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': `t=17e8,v1=${mac(SECRET, `17e8.${BODY}`)}` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'malformed_timestamp'),
  },
  {
    // Past 2^53 a JS number is no longer the integer that was sent, and past
    // 2^63 the other languages cannot hold it at all. Malformed in all eight,
    // rather than "outside tolerance" in one and a parse error in seven.
    name: 'a timestamp too large for an integer is malformed',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: {
        'x-livechat-signature': `t=99999999999999999999,v1=${mac(SECRET, `99999999999999999999.${BODY}`)}`,
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'malformed_timestamp'),
  },
  {
    name: 'a missing separate timestamp header is missing_timestamp',
    input: {
      surface: 'canvas_step',
      body: BODY,
      headers: { 'x-chatly-canvas-signature': `sha256=${mac(SECRET, `${MS}.${BODY}`)}` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('canvas_step', 'missing_timestamp'),
  },

  // ── Refusals before any crypto ─────────────────────────────────────────────
  {
    name: 'an unknown surface',
    input: { surface: 'not_a_surface', body: BODY, headers: {}, secret: SECRET, nowMs: NOW },
    expect: no('not_a_surface', 'unknown_surface'),
  },
  {
    name: 'an empty secret',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: '',
      nowMs: NOW,
    },
    expect: no('event_webhook', 'missing_secret'),
  },
  {
    name: 'an array of only empty secrets',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: ['', ''],
      nowMs: NOW,
    },
    expect: no('event_webhook', 'missing_secret'),
  },
  {
    name: 'no signature header',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'missing_signature_header'),
  },
  {
    name: 'a signature header that arrived twice is refused, not trial-verified',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': [tv1(SECRET, bodyBase()), tv1(SECRET, bodyBase())] },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'duplicate_signature_header'),
  },
  {
    name: 'the same header under two casings counts as twice',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: {
        'x-livechat-signature': tv1(SECRET, bodyBase()),
        'X-Livechat-Signature': tv1(SECRET, bodyBase()),
      },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'duplicate_signature_header'),
  },
  {
    name: 'a t=/v1= value with no v1 is malformed',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': `t=${String(T)}` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'malformed_signature_header'),
  },
  {
    name: 'a non-hex digest is malformed, not a mismatch',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': `t=${String(T)},v1=${'z'.repeat(64)}` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'malformed_signature_header'),
  },
  {
    name: 'a short digest is malformed, not a mismatch',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': `t=${String(T)},v1=abcd` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'malformed_signature_header'),
  },
  {
    name: 'a t=/v1= value on a sha256= surface is malformed',
    input: {
      surface: 'customer_card',
      body: BODY,
      headers: { 'x-chatly-timestamp': MS, 'x-chatly-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('customer_card', 'malformed_signature_header'),
  },
  {
    name: 'the legacy workflow header is refused without the opt-in',
    input: {
      surface: 'workflow_webhook_legacy',
      body: BODY,
      headers: { 'x-chatly-signature': `sha256=${mac(SECRET, BODY)}` },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('workflow_webhook_legacy', 'replay_unprotected'),
  },

  // ── Three surfaces, one header name ────────────────────────────────────────
  {
    name: 'an agent delivery does not verify as a tool call',
    input: {
      surface: 'ai_tool_call',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      ...target,
      nowMs: NOW,
    },
    expect: no('ai_tool_call', 'signature_mismatch'),
  },
  {
    name: 'a tool call with no method/path is missing_request_target',
    input: {
      surface: 'ai_tool_call',
      body: BODY,
      headers: { 'x-chatly-signature': tv1(SECRET, targetBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('ai_tool_call', 'missing_request_target'),
  },
  {
    name: 'the wrong secret is a mismatch',
    input: {
      surface: 'event_webhook',
      body: BODY,
      headers: { 'x-livechat-signature': tv1(OLD, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'signature_mismatch'),
  },
  {
    name: 'a re-serialised body is a mismatch',
    input: {
      surface: 'event_webhook',
      body: '{"id": "evt_1", "type": "message.created"}',
      headers: { 'x-livechat-signature': tv1(SECRET, bodyBase()) },
      secret: SECRET,
      nowMs: NOW,
    },
    expect: no('event_webhook', 'signature_mismatch'),
  },
];
