import type { GraphPage, PagingCursor } from '@assure-ai/whatsapp-types';
import { WhatsAppConfigError } from './errors.js';

/**
 * Cursor paging.
 *
 * Two things are deliberately absent.
 *
 * There is **no `paging.next` following.** Graph's `next` URL embeds the
 * access token as a query parameter. Fetching it verbatim would put the token
 * in a URL — into proxy logs, into any error that quotes the URL, into
 * whatever a caller's tracing library records. Instead the cursor is lifted
 * out and a fresh request is built with an `Authorization` header.
 *
 * There is **no unbounded auto-traversal.** `iterate` requires a page limit.
 * An accidental infinite loop against a rate-limited API is not a hypothetical
 * failure mode, and on an Edge runtime it is a billed one.
 */

/** One page plus the means to ask for the next. */
export interface PageResult<T> {
  data: T[];
  /** Cursor for the following page, when there is one. */
  nextCursor?: PagingCursor;
  /** Cursor for the preceding page, when there is one. */
  previousCursor?: PagingCursor;
  /** True when Graph advertised a following page. */
  hasNextPage: boolean;
}

/**
 * Lift cursors out of a Graph page.
 *
 * Graph is inconsistent about the end of a collection: sometimes `paging.next`
 * is absent, sometimes an `after` cursor is present on the last page and
 * returns an empty `data` when followed. `hasNextPage` keys on `next` — the
 * only signal that actually means "there is more" — so a caller looping on it
 * terminates instead of fetching one empty page forever.
 */
export function toPageResult<T>(page: GraphPage<T>): PageResult<T> {
  const data = Array.isArray(page?.data) ? page.data : [];
  const result: PageResult<T> = {
    data,
    hasNextPage: typeof page?.paging?.next === 'string' && page.paging.next !== '',
  };
  const after = page?.paging?.cursors?.after;
  if (typeof after === 'string' && after !== '') result.nextCursor = after as PagingCursor;
  const before = page?.paging?.cursors?.before;
  if (typeof before === 'string' && before !== '') result.previousCursor = before as PagingCursor;
  return result;
}

export interface IterateOptions {
  /**
   * Hard cap on pages fetched. Required — there is no default, because every
   * sensible default is wrong for somebody and the wrong one loops.
   */
  maxPages: number;
  /** Cancels between and during page fetches. */
  signal?: AbortSignal;
}

/** Fetches one page, given a cursor. */
export type PageFetcher<T> = (input: {
  after?: PagingCursor;
  signal?: AbortSignal;
}) => Promise<PageResult<T>>;

/**
 * Walk pages up to `maxPages`, yielding each item.
 *
 * Stops at the cap, when Graph reports no further page, or when the signal
 * aborts — whichever comes first. Reaching the cap is silent by design: the
 * caller sets it and can compare what it received against it.
 */
export async function* iteratePages<T>(
  fetchPage: PageFetcher<T>,
  options: IterateOptions,
): AsyncGenerator<T, void, undefined> {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new WhatsAppConfigError('`maxPages` must be a positive integer');
  }

  // Read through a function rather than a property so that checking it once
  // does not narrow it to `false` for the rest of the loop — the signal can
  // abort at any point during the awaits below.
  const aborted = (): boolean => options.signal?.aborted === true;

  let cursor: PagingCursor | undefined;
  for (let page = 0; page < options.maxPages; page += 1) {
    if (aborted()) return;

    const result = await fetchPage({
      ...(cursor !== undefined ? { after: cursor } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });

    for (const item of result.data) {
      if (aborted()) return;
      yield item;
    }

    if (!result.hasNextPage || result.nextCursor === undefined) return;
    cursor = result.nextCursor;
  }
}

/** Collect an async iterable into an array, with a hard item cap. */
export async function collect<T>(
  iterable: AsyncIterable<T>,
  options: { maxItems: number },
): Promise<T[]> {
  if (!Number.isInteger(options.maxItems) || options.maxItems < 1) {
    throw new WhatsAppConfigError('`maxItems` must be a positive integer');
  }
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= options.maxItems) break;
  }
  return out;
}
