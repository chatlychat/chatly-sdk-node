import { listable } from '../pagination.js';

import type { Transport, Unmodelled } from './common.js';

export interface TriggerCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'contains' | 'matches';
  value?: unknown;
}

export interface UpsertTriggerInput {
  /** Present means UPDATE, absent means INSERT. Both answer 201. */
  id?: string;
  name: string;
  /**
   * A free string on the write side (`z.string().min(1).max(64)`), NOT an
   * enum — do not narrow it. The workflow trigger catalogue is the list of
   * names that actually have a publisher.
   */
  eventType: string;
  /** REQUIRED. There is no default, so omitting it is a 400. */
  enabled: boolean;
  /** REQUIRED key, max 50. `[]` is legal; absent is a 400. */
  conditions: ReadonlyArray<TriggerCondition>;
  /** REQUIRED, at least one, max 20. `type` is a closed 60-value enum. */
  actions: ReadonlyArray<{ type: string; params: Record<string, unknown> }>;
  /** Defaults to 0. */
  priority?: number;
  /** Max 604800 (7 days). `null` and absent are both accepted. */
  debounceSeconds?: number | null;
  debounceKeyTemplate?: string | null;
}

export function triggersResource(t: Transport) {
  return {
    /**
     * A page of triggers — `{ items, nextCursor, hasMore }`.
     *
     * The only query parameters are the shared cursor set: `cursor`, `limit`
     * (1–100, default 25), `sort`, `fields`, `filter`. There are no
     * trigger-specific filters; narrowing goes through `filter` as
     * `field:value` or `field:op:value`, over `enabled`, `eventType`,
     * `brandId`, `createdAt`, `updatedAt`. Unknown query keys are STRIPPED
     * rather than rejected, so a typo is a silently unfiltered page.
     *
     * Items are projected when `fields` is set, so every field is optional on
     * the wire.
     */
    ...listable<Unmodelled>(t, '/v1/triggers'),
    /**
     * Create or update. Answers **201 on both arms** — there is no
     * `@HttpCode`, so an update is a 201 too; do not read the status as
     * "created".
     *
     * `enabled` and `conditions` are required keys even though `conditions`
     * may be `[]`. The condition `op` enum is closed on the WRITE side and a
     * free string on the read side (legacy rows), so a trigger you read back
     * may carry an `op` this type will not accept.
     */
    create: (body: UpsertTriggerInput) => t.post<Unmodelled>('/v1/triggers', body),
    /**
     * Hard delete. **200 with `{ ok: true }`, not a 204.**
     *
     * `ok: false` is unreachable: a miss is a 404.
     */
    delete: (id: string) => t.del<Unmodelled>(`/v1/triggers/${encodeURIComponent(id)}`),
  };
}
