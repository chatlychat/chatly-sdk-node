import { autoPaginate, type Page, type PageQuery } from '../pagination.js';

import type { Query, Transport, Unmodelled } from './common.js';

export function searchResource(t: Transport) {
  return {
    /**
     * Full-text across contacts, conversations, messages, tickets and the KB.
     *
     * Returns the WHOLE envelope, not just `items`: the response carries
     * `facets` and a `tier` beside them, and a caller that only ever saw hits
     * would lose both. `queryAll` walks the cursor and yields hits alone,
     * which is the right trade for a loop.
     */
    query: (q: string, opts: PageQuery & Query = {}) =>
      t.get<Page<Unmodelled> & Unmodelled>('/v1/search', { q, ...opts }),
    queryAll: (q: string, opts: Query = {}) =>
      autoPaginate<Unmodelled>((cursor) =>
        t.get<Page<Unmodelled>>('/v1/search', {
          q,
          ...opts,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    /**
     * Help-centre articles only.
     *
     * Sends `kinds=kb` as a repeated PLAIN key. It used to send `kinds[]=kb`,
     * and `searchQuerySchema` is an object schema, so zod stripped the
     * bracketed key and the search ran UNNARROWED — this method returned
     * contacts, conversations, messages and tickets with a 200 and nothing to
     * indicate the filter had been ignored. The MCP server's `search_kb` tool
     * and the dashboard sent the same spelling. The schema now folds
     * `kinds[]` and a scalar `kinds` as well, but the plain repeated key is
     * the form to send.
     */
    kb: (q: string, opts: Query = {}) =>
      t.get<Unmodelled>('/v1/search', { q, kinds: ['kb'], ...opts }),
  };
}
