import type { Query, Transport } from '../transport.js';

/**
 * Shared vocabulary for the typed route surface.
 *
 * ── THESE SHAPES ARE READ OFF THE ZOD SCHEMAS, NOT GUESSED ───────────────
 *
 * The API validates every body with zod and zod DROPS unknown keys. A write
 * with the wrong key name therefore returns 200 having done nothing, which no
 * caller can distinguish from success. Three of this SDK's own writes were
 * built that way until the Ruby SDK's author read the controllers:
 *
 *   contacts.merge        sent { sourceContactId } — schema wants { mergedId }
 *   contacts.addTags      sent { tags: [...] }     — schema wants { tag }, ONE
 *   contacts.unsubscribe  sent { }                 — `unsubscribed` is REQUIRED
 *
 * The first two silently did nothing. The third 400'd, which is the lucky
 * case. If you add a method anywhere under this directory, open the schema.
 *
 * The same trap applies to QUERY names, and the manifest does not pin those
 * either. `/v1/search` was sent `kinds[]` and ran unnarrowed with a 200;
 * `/v1/reports/cohorts` takes `weeks` and ignores `days`;
 * `/v1/billing/usage*` 400s without `eventType`.
 */

/** A result shape we do not model field-by-field. The API validates; we pass through. */
export type Unmodelled = Record<string, unknown>;

/** Every namespace factory has this shape. */
export type ResourceFactory<T> = (transport: Transport) => T;

export type { Query, Transport };
