import type { Transport, Unmodelled } from './common.js';

/**
 * `EMAIL_TEMPLATE_KINDS` — the five overridable emails.
 *
 * This is the PATH segment, not an id, and an unknown value is a 400 from
 * `parseKind`, not a 404.
 */
export type EmailTemplateKind =
  | 'workspace_invite'
  | 'trial_ending_reminder'
  | 'conversation_cap_warning'
  | 'hired_agent_engagement_invite'
  | 'hired_agent_engagement_started';

export interface EmailTemplateWriteInput {
  /** 1–300 after trimming. */
  subject: string;
  /** 1–10,000 after trimming. */
  body: string;
}

export function emailTemplatesResource(t: Transport) {
  return {
    /** All five, with each workspace override or `null`. A bare array, always length 5. */
    list: () => t.get<ReadonlyArray<Unmodelled>>('/v1/email-templates'),
    /**
     * Override one template. A PUT, answering 200 with the template.
     *
     * The body is **`.strict()` and holds only `{ subject, body }`** — `kind`
     * lives in the path, and including it in the body is a 400. That is the
     * friendly failure; the `preview` route below wants it the other way
     * round, which is the trap.
     */
    update: (kind: EmailTemplateKind, body: EmailTemplateWriteInput) =>
      t.put<Unmodelled>(`/v1/email-templates/${encodeURIComponent(kind)}`, body),
    /**
     * Drop the override and go back to the built-in.
     *
     * **200 with `{ restored }`, not a 204**, and it does NOT return the
     * restored template. `{ restored: false }` with a 200 means the workspace
     * was already on the built-in — idempotent, not an error.
     */
    delete: (kind: EmailTemplateKind) =>
      t.del<Unmodelled>(`/v1/email-templates/${encodeURIComponent(kind)}`),
    /**
     * Render a draft without saving it. Answers **201** with
     * `{ subject, html, text, unknownTokens }`.
     *
     * Here `kind` IS a body field, and the body is `.strict()` with all three
     * required — the mirror image of `update`, where `kind` in the body is a
     * 400. `subject` and `body` may be empty strings on this route only.
     *
     * `unknownTokens` is how you find a typo'd `{{token}}` before sending.
     */
    preview: (body: { kind: EmailTemplateKind; subject: string; body: string }) =>
      t.post<Unmodelled>('/v1/email-templates/preview', body),
  };
}
