import { listable } from '../pagination.js';

import type { Transport, Unmodelled } from './common.js';

export function kbResource(t: Transport) {
  return {
    ...listable<Unmodelled>(t, '/v1/kb/articles'),
    /** One article by slug — the same slug the help centre serves it under. */
    article: (slug: string) => t.get<Unmodelled>(`/v1/kb/articles/${encodeURIComponent(slug)}`),
    collections: () => t.get<Unmodelled>('/v1/kb/collections'),
  };
}
