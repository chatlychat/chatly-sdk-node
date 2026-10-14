import type { Transport, Unmodelled } from './common.js';

export function workspaceResource(t: Transport) {
  return {
    settings: () => t.get<Unmodelled>('/v1/workspace/settings'),
    /**
     * Every credential this workspace holds, across nine tables — existence
     * and timestamps, never a value.
     *
     * `{ items, total, truncated }`. Each item carries a stable `id`, the
     * `source` table, a `kind`, the `location` the value sits at (including
     * the dot path inside a JSON column, e.g.
     * `channels.config.identityVerification.secret`), `createdAt`,
     * `rotatedAt`, `lastUsedAt` and the concrete `rotateRoute` where one
     * route replaces it.
     *
     * Read `rotatedAtBasis` and `lastUsedBasis` BEFORE acting on a null
     * timestamp. `'none'` means nothing in the product records that fact —
     * eight of the nine sources have no rotated-at column at all — while
     * `'column'` or `'derived'` means it was looked up and the credential
     * really has not been rotated or used. Treating the first as "never
     * used" is how a webhook secret that signs a delivery every minute gets
     * revoked.
     *
     * Needs BOTH `workspace:write` and `integrations:read` on the key: it
     * spans resources guarded at different widths and the guard ANDs them.
     * `truncated: true` means a source hit its cap and the census is
     * incomplete — check it before concluding a credential does not exist.
     */
    secrets: () => t.get<Unmodelled>('/v1/workspace/secrets'),
    /**
     * Every workspace the caller belongs to, as a bare array.
     *
     * For a `ck_` key that is the one workspace the key was issued in, so
     * this is a cheap way to confirm which tenant a key actually points at —
     * useful when the same deploy script runs against staging and
     * production with the wrong secret.
     *
     * `@AllowWhenSuspended`: it answers even when the active workspace is
     * suspended, because it is how a caller discovers the others.
     */
    mine: () => t.get<ReadonlyArray<Unmodelled>>('/v1/workspaces/me'),
    labels: () => t.get<ReadonlyArray<Unmodelled>>('/v1/labels'),
    inboxes: () => t.get<ReadonlyArray<Unmodelled>>('/v1/inboxes'),
    /**
     * One team's roster. The only team read an API key can make.
     *
     * The workspace-wide `GET /v1/teams` list carries no `@AllowApiKey()` —
     * it reads a calling user id, and a key is not a person — so it answers
     * every key with 403. This manifest listed it anyway for a day, because
     * the script that derived the key-accessible surface took the nearest
     * `@AllowApiKey()` in either direction and credited the list route with
     * the decorator belonging to this one. Get a team id from a workflow, an
     * inbox's `settings.routingTeamId`, or a conversation's `teamId`.
     */
    teamMembers: (teamId: string) =>
      t.get<Unmodelled>(`/v1/teams/${encodeURIComponent(teamId)}/members`),
    /**
     * The workspace's skill taxonomy — the distinct labels routing matches on.
     *
     * `GET /v1/agents` has no handler at all; the agents controller serves
     * only `/agents/skills` and `/agents/{userId}/skills`. There is no
     * key-accessible way to list the people with a seat here.
     */
    agentSkills: () => t.get<Unmodelled>('/v1/agents/skills'),
    /**
     * Every scope a key may be granted — `[{ value, group }]`, where `group`
     * is the part before the first colon.
     *
     * The SECOND of exactly two routes on the api-keys controller a key may
     * call; `whoami` is the other, and its own comment claimed to be the only
     * one until this was opened. Managing keys with a key stays closed
     * (`GET /v1/api-keys`, `POST`, revoke) because that is a
     * privilege-escalation shape; a static vocabulary of permission NAMES is
     * not.
     *
     * Worth knowing: this catalogue is deliberately NARROWER than the full
     * permission set, while `POST /v1/api-keys` validates `scopes` as a bare
     * string array — so the create route will accept names that never appear
     * here.
     */
    keyScopes: () => t.get<ReadonlyArray<Unmodelled>>('/v1/api-keys/scopes'),
  };
}
