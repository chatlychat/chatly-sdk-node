import type { Query, Transport } from './transport.js';

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
}

/** A list method as the auto-paginator sees it: give me a cursor, get a page. */
export type PageFetcher<T> = (cursor: string | undefined) => Promise<Page<T>>;

/**
 * Walk every page of a cursor-paginated list.
 *
 * ```ts
 * for await (const contact of chatly.contacts.listAll()) { … }
 * ```
 *
 * Two safeguards, both earned. It stops when `nextCursor` is null — and also
 * when the server hands back a cursor it already gave us, which would
 * otherwise be an infinite loop issuing the same request forever. And it never
 * paginates on `id`: ids in this product are a mix of UUID v4 and v7, so id
 * order is not time order and keyset paging on it silently reorders results.
 * Eighteen list endpoints were doing exactly that.
 */
export async function* autoPaginate<T>(fetchPage: PageFetcher<T>): AsyncGenerator<T, void, void> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      yield item;
    }
    const next = page.nextCursor;
    if (next === null || next === undefined || next === '') {
      return;
    }
    if (seen.has(next)) {
      throw new Error(
        `Chatly pagination stopped: the server repeated cursor "${next}". ` +
          'Continuing would issue the same request forever.',
      );
    }
    seen.add(next);
    cursor = next;
  }
}

/**
 * The two shapes for a paginated route whose path takes parameters.
 *
 * `listable` builds them from a fixed path; this builds them from a function
 * that produces the path, which is what `contacts.journey` and
 * `conversations.messages` need.
 */
export function listableAt<T>(
  transport: Transport,
  path: (args: string) => string,
  extra: Query = {},
): {
  page: (id: string, query?: PageQuery & Query) => Promise<Page<T>>;
  all: (id: string, query?: Query) => AsyncGenerator<T, void, void>;
} {
  const page = (id: string, query: PageQuery & Query = {}): Promise<Page<T>> =>
    transport.get<Page<T>>(path(id), { ...extra, ...query });
  return {
    page,
    all: (id: string, query: Query = {}) =>
      autoPaginate<T>((cursor) =>
        page(id, { ...query, ...(cursor === undefined ? {} : { cursor }) }),
      ),
  };
}

/** Build a list namespace's two shapes — one page, and every page — from one path. */
export function listable<T>(
  transport: Transport,
  path: string,
  extra: Query = {},
): {
  list: (query?: PageQuery & Query) => Promise<Page<T>>;
  listAll: (query?: Query) => AsyncGenerator<T, void, void>;
} {
  const list = (query: PageQuery & Query = {}): Promise<Page<T>> =>
    transport.get<Page<T>>(path, { ...extra, ...query });
  return {
    list,
    listAll: (query: Query = {}) =>
      autoPaginate<T>((cursor) => list({ ...query, ...(cursor === undefined ? {} : { cursor }) })),
  };
}
