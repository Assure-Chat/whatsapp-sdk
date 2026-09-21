import { toRawBytes } from './bytes.js';

/**
 * Raw-body capture helpers.
 *
 * Signature verification needs the bytes Meta signed. Most of the ways a body
 * reaches a handler destroy them:
 *
 * - `express.json()` parses and discards the original buffer;
 * - `await request.json()` does the same on a `Request`;
 * - re-serializing the parsed object produces different bytes.
 *
 * A `Request` body can also only be read once, so reading it as bytes and
 * decoding from there — rather than reading it twice — is the only order that
 * works.
 *
 * These helpers are runtime-agnostic and pull in no framework. Express and
 * Fastify are covered in `docs/integration-supabase-edge.md` rather than as
 * adapters here: an adapter would add a dependency and an opinion, and the
 * correct Express configuration is one line of `verify` callback.
 */

/** Everything a verified webhook handler needs, read exactly once. */
export interface RawWebhookRequest {
  rawBody: Uint8Array;
  headers: Headers;
}

/**
 * Read a Fetch `Request` into bytes and headers.
 *
 * Works unchanged on Deno, Supabase Edge Functions, Cloudflare Workers, Bun,
 * and Node 20+ (`node:http` via `Request`, or any framework exposing one).
 *
 * ```ts
 * Deno.serve(async (request) => {
 *   const { rawBody, headers } = await readRawRequest(request);
 *   const verified = await verifyWebhookSignature({ rawBody, headers, appSecret });
 *   if (!verified.ok) return new Response('Forbidden', { status: 403 });
 *   // ...
 * });
 * ```
 */
export async function readRawRequest(request: Request): Promise<RawWebhookRequest> {
  const buffer = await request.arrayBuffer();
  return { rawBody: new Uint8Array(buffer), headers: request.headers };
}

/**
 * Concatenate an async iterable of chunks into one buffer, with a hard cap.
 *
 * For Node streams (`IncomingMessage` is an async iterable of `Buffer`) where
 * no body parser has run. The cap is enforced while reading, so an oversized
 * body is abandoned rather than buffered to exhaustion.
 */
export async function readRawStream(
  stream: AsyncIterable<Uint8Array | string>,
  options: { maxBytes?: number } = {},
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = toRawBytes(chunk);
    total += bytes.length;
    if (maxBytes > 0 && total > maxBytes) {
      throw new Error(`Webhook body exceeded ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
