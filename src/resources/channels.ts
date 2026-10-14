import type { Query, Transport, Unmodelled } from './common.js';

/**
 * The 17 types `POST /v1/channels` accepts.
 *
 * Narrower than what a channel RESPONSE may carry: `telegram_user` exists in
 * the database enum and is readable, but is deliberately not creatable here.
 */
export type CreatableChannelType =
  | 'web'
  | 'email'
  | 'whatsapp'
  | 'messenger'
  | 'instagram'
  | 'sms'
  | 'voice'
  | 'api'
  | 'telegram'
  | 'discord'
  | 'apple'
  | 'line'
  | 'viber'
  | 'slack'
  | 'msteams'
  | 'tiktok'
  | 'twitter';

export interface CreateChannelInput {
  type: CreatableChannelType;
  name: string;
  /** The id the embed snippet and the inbound webhook URLs carry. Required. */
  publicId: string;
  /** Omitted, the workspace's default brand is used (404 if there is none). */
  brandId?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateChannelInput {
  name?: string;
  enabled?: boolean;
  autoCreateTickets?: boolean;
  autoAcknowledge?: boolean;
  /** `null` restores the built-in copy. */
  acknowledgeTemplate?: string | null;
  acknowledgeSubject?: string | null;
  config?: Record<string, unknown>;
  /**
   * How `config` is applied. Omitted it is a merge, where a `null` value
   * DELETES that key (RFC 7396). `'replace'` overwrites the whole object.
   */
  configMode?: 'merge' | 'replace';
}

export function channelsResource(t: Transport) {
  return {
    list: (query: Query = {}) => t.get<ReadonlyArray<Unmodelled>>('/v1/channels', query),
    get: (id: string) => t.get<Unmodelled>(`/v1/channels/${encodeURIComponent(id)}`),
    /**
     * Channel types this deployment can receive on.
     *
     * A bare array of **strings** — not objects with an `id` or a `label`.
     * Sorted and de-duplicated.
     */
    adapters: () => t.get<ReadonlyArray<string>>('/v1/channels/adapters'),
    /**
     * Create a channel. Answers **201**.
     *
     * `channels:write` IS a grantable key scope, so this works from a `ck_`
     * key — a comment in this SDK claimed the opposite ("channel writes need
     * `channels:write`, which no key-accessible route grants") and that was
     * wrong: the scope exists precisely so a widget can be stood up from
     * code. What stays dashboard-only is `DELETE /v1/channels/{id}` and
     * `GET /v1/channels/{id}/secret`; rotating is open instead of reading,
     * because reading a secret leaves no trace.
     *
     * Credential-bearing keys come BACK as the literal string
     * `"__redacted__"`. Echoing that value in a later PATCH means "leave this
     * one alone", so a helper that strips or rewrites the marker destroys
     * credentials.
     */
    create: (body: CreateChannelInput) => t.post<Unmodelled>('/v1/channels', body),
    /**
     * Patch a channel.
     *
     * `type` and `publicId` are NOT patchable — they are stable identifiers,
     * and since the body schema strips unknown keys rather than rejecting
     * them, sending either gets a 200 that changed nothing. A body with no
     * recognised field is a **409 `No fields to update`**, not a no-op 200.
     */
    update: (id: string, body: UpdateChannelInput) =>
      t.patch<Unmodelled>(`/v1/channels/${encodeURIComponent(id)}`, body),
    /**
     * Mint a new Chatly-issued channel secret. Answers 201 with `{ secret }`;
     * no body goes up.
     *
     * Only `type: 'api'` channels have one — anything else is a **409**, not a
     * 404 and not a fresh secret.
     */
    rotateSecret: (id: string) =>
      t.post<Unmodelled>(`/v1/channels/${encodeURIComponent(id)}/secret/rotate`),
  };
}
