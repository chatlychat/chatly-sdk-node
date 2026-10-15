/**
 * sdk-node against the cross-SDK signature corpus, and the corpus against
 * its copies.
 *
 * Three claims, three tests:
 *
 *  1. `test/signature-vectors.json` is exactly `SIGNATURE_VECTORS` — so the
 *     JSON every other SDK reads cannot be hand-edited away from the
 *     hand-written TypeScript beside it. `UPDATE_SIGNATURE_VECTORS=1`
 *     rewrites it.
 *  2. This SDK's `verifyChatlySignature` returns, for every vector, the
 *     `ok`, `surface`, `reason` / `base` / `secretIndex` / `timestampMs`
 *     the corpus says — and a non-empty `message` on every refusal.
 *  3. In the monorepo, each of the seven other backend SDKs carries a
 *     BYTE-IDENTICAL copy. A copy that drifted would be a port tested
 *     against a different contract while every suite stayed green.
 *
 * (3) is skipped in the public `chatly-sdk-node` mirror, which has no sibling
 * SDKs to compare against — reported as SKIPPED, not passed. Each mirror runs
 * its own copy through its own verifier, which is the half that matters
 * there.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifyChatlySignature, type VerifyChatlySignatureInput } from './signatures.js';
import { SIGNATURE_VECTORS } from './test/signature-vectors.js';

const JSON_PATH = join(__dirname, 'test/signature-vectors.json');
const SERIALISED = `${JSON.stringify({ version: 1, vectors: SIGNATURE_VECTORS }, null, 2)}\n`;

/** Where each port keeps its copy, relative to `packages/`. */
const COPIES = [
  'sdk-python/tests/signature_vectors.json',
  'sdk-go/testdata/signature_vectors.json',
  'sdk-ruby/test/fixtures/signature_vectors.json',
  'sdk-php/tests/fixtures/signature_vectors.json',
  'sdk-java/src/test/resources/signature_vectors.json',
  'sdk-dotnet/tests/Fixtures/signature_vectors.json',
  'sdk-rust/tests/fixtures/signature_vectors.json',
] as const;
const PACKAGES = join(__dirname, '../..');
const IN_MONOREPO =
  existsSync(join(PACKAGES, 'sdk-spec/surface.json')) && existsSync(join(PACKAGES, 'sdk-python'));

describe('the signature corpus', () => {
  it('the committed JSON is exactly SIGNATURE_VECTORS', () => {
    if (process.env['UPDATE_SIGNATURE_VECTORS'] === '1') {
      writeFileSync(JSON_PATH, SERIALISED);
    }
    expect(readFileSync(JSON_PATH, 'utf8')).toBe(SERIALISED);
  });

  it('covers every surface and every failure reason at least once', () => {
    const surfaces = new Set(SIGNATURE_VECTORS.map((v) => v.input.surface));
    const reasons = new Set(
      SIGNATURE_VECTORS.flatMap((v) => (v.expect.ok ? [] : [v.expect.reason])),
    );
    for (const s of [
      'unified_v2',
      'agent_delivery',
      'event_webhook',
      'ai_tool_call',
      'canvas_step',
      'customer_card',
      'workflow_webhook',
      'workflow_webhook_legacy',
    ]) {
      expect(surfaces, s).toContain(s);
    }
    for (const r of [
      'unknown_surface',
      'missing_secret',
      'missing_signature_header',
      'duplicate_signature_header',
      'malformed_signature_header',
      'missing_timestamp',
      'malformed_timestamp',
      'timestamp_outside_tolerance',
      'missing_request_target',
      'replay_unprotected',
      'signature_mismatch',
    ]) {
      expect(reasons, r).toContain(r);
    }
  });

  it.skipIf(!IN_MONOREPO)('every port carries a byte-identical copy', () => {
    for (const rel of COPIES) {
      const abs = join(PACKAGES, rel);
      expect(existsSync(abs), `${rel} is missing`).toBe(true);
      expect(readFileSync(abs, 'utf8'), `${rel} differs from sdk-node's corpus`).toBe(SERIALISED);
    }
  });
});

describe('verifyChatlySignature over the corpus', () => {
  for (const vector of SIGNATURE_VECTORS) {
    it(vector.name, () => {
      const result = verifyChatlySignature(vector.input as VerifyChatlySignatureInput);
      if (vector.expect.ok) {
        expect(result, result.ok ? '' : result.message).toEqual({ ...vector.expect });
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect({ ok: result.ok, surface: result.surface, reason: result.reason }).toEqual({
            ...vector.expect,
          });
          expect(result.message.length).toBeGreaterThan(0);
        }
      }
    });
  }
});
