import type { Transport, Unmodelled } from './common.js';

export function canvasStepsResource(t: Transport) {
  return {
    /**
     * Read a pending interactive step.
     *
     * The back half of an **async canvas step**. Your canvas endpoint answered
     * `{ pending: true }` — because a payment needed 3-D Secure, a fraud check
     * had to clear, or a PSP was slow — and was given a correlation id. This
     * reads that step.
     *
     * The caller here is a backend process minutes later, holding a `ck_` key
     * and no visitor session, which is precisely the caller a ten-second
     * synchronous timeout could not serve. That is the whole reason the async
     * form exists.
     *
     * A 404 means the id is unknown, belongs to another workspace, or the step
     * has expired — and this route cannot tell you which, deliberately: an id
     * that reported "expired" rather than "unknown" would confirm that
     * somebody else's step id is real.
     */
    get: (id: string) => t.get<Unmodelled>(`/v1/canvas-steps/${encodeURIComponent(id)}`),
    /**
     * Post the real next step. Body is `{ canvas }` and it is **strict** — an
     * unrecognised key is a 400 rather than a silently dropped field.
     *
     * **Single-use by construction, not by an idempotency key.** The claiming
     * UPDATE carries `status = 'pending'` in its WHERE clause, so exactly one
     * resolve wins and a second is told the step is already resolved. That is
     * why the route honours an `Idempotency-Key` without demanding one:
     * requiring a header would add a 428 for an integrator who forgets it, in
     * exchange for a guarantee the route already makes.
     *
     * A retry after a timeout is therefore safe and correct whether or not you
     * sent a key — but a retry whose first attempt SUCCEEDED is told so, which
     * is the answer you want rather than a second canvas in the thread.
     */
    resolve: (id: string, body: Unmodelled) =>
      t.post<Unmodelled>(`/v1/canvas-steps/${encodeURIComponent(id)}/resolve`, body),
  };
}
