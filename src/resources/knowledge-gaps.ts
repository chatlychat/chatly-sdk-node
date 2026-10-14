import type { Transport, Unmodelled } from './common.js';

/** `GAP_STATUSES` — four, and `drafted` is easy to forget. */
export type KnowledgeGapStatus = 'open' | 'drafted' | 'resolved' | 'dismissed';

export function knowledgeGapsResource(t: Transport) {
  return {
    /**
     * Questions the KB could not answer, most-asked first. A bare array.
     *
     * Two query parameters, `status` and `limit`, and neither is validated
     * strictly: an unrecognised `status` is **silently ignored** (you get the
     * unfiltered list, not a 400), and `limit` is clamped 1–200 with a
     * default of 100. There is no `cursor` — the recorder caps a workspace at
     * 200 open gaps, so the list is the list.
     */
    list: (query: { status?: KnowledgeGapStatus; limit?: number } = {}) =>
      t.get<ReadonlyArray<Unmodelled>>('/v1/knowledge-gaps', {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
    /**
     * Set a gap's status. `{ status }`, `.strict()`, and that is the only
     * thing there is to change — no `question`, no notes.
     *
     * The manifest calls this `update` and the handler calls it `setStatus`;
     * the handler is the honest name.
     */
    update: (id: string, status: KnowledgeGapStatus) =>
      t.patch<Unmodelled>(`/v1/knowledge-gaps/${encodeURIComponent(id)}`, { status }),
    /**
     * Draft an article from the gap. Answers **201**; no body goes up.
     *
     * The response NESTS the gap: `{ gap, articleId, reason }`, and both
     * `articleId: null` and a `reason` are a 2xx — "nothing worth writing" is
     * an answer, not a failure. A gap with no conversation behind it is a 400
     * from the service rather than this shape.
     */
    draft: (id: string) => t.post<Unmodelled>(`/v1/knowledge-gaps/${encodeURIComponent(id)}/draft`),
  };
}
