import { describe, expect, it } from 'vitest';
import {
  WhatsAppConfigError,
  asWabaId,
  collect,
  createWhatsAppClient,
  iteratePages,
  toPageResult,
} from '../src/index.js';
import type { GraphPage, PagingCursor } from '@assure-ai/whatsapp-types';
import { GRAPH_VERSION, TEST_TOKEN, WABA_ID, createFetchDouble, jsonResponse } from './helpers.js';

const WABA = asWabaId(WABA_ID);

/**
 * A Graph page with a `next` URL that embeds a token, as Graph really sends.
 *
 * Cursors are branded in the type but arrive as plain strings over the wire,
 * which is exactly what this fixture reproduces.
 */
function page(
  ids: string[],
  options: { next?: boolean } = {},
): GraphPage<{ id: string; name: string }> {
  return {
    data: ids.map((id) => ({ id, name: `template_${id}` })),
    paging: {
      cursors: {
        before: `before_${ids[0] ?? 'x'}` as PagingCursor,
        after: `after_${ids.at(-1) ?? 'x'}` as PagingCursor,
      },
      ...(options.next === true
        ? {
            next: `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates?access_token=${TEST_TOKEN}&after=after_${ids.at(-1)}`,
          }
        : {}),
    },
  };
}

describe('toPageResult', () => {
  it('lifts cursors and reports a following page', () => {
    const result = toPageResult(page(['1', '2'], { next: true }));
    expect(result.hasNextPage).toBe(true);
    expect(result.nextCursor).toBe('after_2');
    expect(result.previousCursor).toBe('before_1');
  });

  it('reports no following page when `next` is absent, even with an after cursor', () => {
    // Graph often leaves an `after` cursor on the last page. Keying on it
    // instead of `next` makes a loop fetch one empty page forever.
    const result = toPageResult(page(['1'], { next: false }));
    expect(result.nextCursor).toBe('after_1');
    expect(result.hasNextPage).toBe(false);
  });

  it('tolerates a missing data array', () => {
    expect(toPageResult({} as never)).toEqual({ data: [], hasNextPage: false });
  });
});

describe('template paging through the client', () => {
  it('never follows Graph’s next URL, which carries the token', async () => {
    const double = createFetchDouble([
      jsonResponse(page(['1'], { next: true })),
      jsonResponse(page(['2'], { next: false })),
    ]);
    const client = createWhatsAppClient({
      accessToken: TEST_TOKEN,
      graphApiVersion: GRAPH_VERSION,
      fetch: double.fetch,
    });

    const items = await collect(client.templates.iterate({ wabaId: WABA, maxPages: 5 }), {
      maxItems: 100,
    });

    expect(items.map((item) => item.id)).toEqual(['1', '2']);
    // Each request was rebuilt from the cursor with a bearer header.
    for (const request of double.requests) {
      expect(request.url).not.toContain('access_token');
      expect(request.headers['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    }
    expect(new URL(double.requests[1]!.url).searchParams.get('after')).toBe('after_1');
  });

  it('stops at maxPages rather than walking a large account', async () => {
    const double = createFetchDouble(() => jsonResponse(page(['x'], { next: true })));
    const client = createWhatsAppClient({
      accessToken: TEST_TOKEN,
      graphApiVersion: GRAPH_VERSION,
      fetch: double.fetch,
    });

    const items = await collect(client.templates.iterate({ wabaId: WABA, maxPages: 3 }), {
      maxItems: 1000,
    });
    expect(items).toHaveLength(3);
    expect(double.requests).toHaveLength(3);
  });

  it('stops mid-walk when the caller aborts', async () => {
    const controller = new AbortController();
    const double = createFetchDouble(() => {
      // Abort after the first page comes back.
      queueMicrotask(() => controller.abort());
      return jsonResponse(page(['x'], { next: true }));
    });
    const client = createWhatsAppClient({
      accessToken: TEST_TOKEN,
      graphApiVersion: GRAPH_VERSION,
      fetch: double.fetch,
    });

    const items = await collect(
      client.templates.iterate({ wabaId: WABA, maxPages: 50, signal: controller.signal }),
      { maxItems: 1000 },
    );
    expect(items.length).toBeLessThan(50);
    expect(double.requests.length).toBeLessThan(50);
  });
});

describe('iteratePages', () => {
  it('requires a positive integer page cap', async () => {
    for (const maxPages of [0, -1, 1.5, Number.NaN]) {
      const iterator = iteratePages(async () => ({ data: [], hasNextPage: false }), { maxPages });
      await expect(iterator.next()).rejects.toBeInstanceOf(WhatsAppConfigError);
    }
  });

  it('stops when a page reports no successor', async () => {
    let calls = 0;
    const items = await collect(
      iteratePages<number>(
        async () => {
          calls += 1;
          return { data: [calls], hasNextPage: false };
        },
        { maxPages: 10 },
      ),
      { maxItems: 100 },
    );
    expect(items).toEqual([1]);
    expect(calls).toBe(1);
  });
});

describe('collect', () => {
  it('requires a positive item cap', async () => {
    async function* empty(): AsyncGenerator<number> {
      yield 1;
    }
    await expect(collect(empty(), { maxItems: 0 })).rejects.toBeInstanceOf(WhatsAppConfigError);
  });

  it('stops at the item cap', async () => {
    async function* many(): AsyncGenerator<number> {
      for (let index = 0; index < 100; index += 1) yield index;
    }
    expect(await collect(many(), { maxItems: 3 })).toEqual([0, 1, 2]);
  });
});
