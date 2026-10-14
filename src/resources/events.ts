import { listable, type PageQuery } from '../pagination.js';

import type { Query, Transport, Unmodelled } from './common.js';

export interface TrackEventInput {
  contactId: string;
  name: string;
  properties?: Record<string, unknown>;
}

/** Query for `events.list` — a page, optionally one contact's. */
export interface EventListQuery extends PageQuery {
  /** Restrict the stream to one contact. Omit for the whole workspace. */
  contactId?: string;
}

export function eventsResource(t: Transport) {
  const page = listable<Unmodelled>(t, '/v1/cdp/events');
  return {
    track: (input: TrackEventInput) => t.post<Unmodelled>('/v1/cdp/events', input),
    /**
     * Read back what was tracked — the same `/v1/cdp/events` collection
     * `track` writes to, cursor-paginated newest-first.
     *
     * The SDK could write events and never read them, so "did my tracking
     * call actually land?" had no answer outside the dashboard. Pass
     * `contactId` to scope the stream to one person.
     */
    list: (query: EventListQuery = {}) => page.list(query as PageQuery & Query),
    listAll: page.listAll,
  };
}
