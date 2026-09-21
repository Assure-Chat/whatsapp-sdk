import { bytesToHex, hexToBytes, timingSafeEqualBytes, toRawBytes, utf8 } from './bytes.js';

/**
 * `X-Hub-Signature-256` verification, per Meta's documented scheme:
 * HMAC-SHA-256 over the **exact request body bytes**, keyed with the app
 * secret, presented as `sha256=<hex>`.
 *
 * The phrase "exact bytes" is the whole design. `JSON.parse` followed by
 * `JSON.stringify` reorders nothing but reformats everything — whitespace,
 * unicode escaping, number formatting — and the resulting bytes will not
 * verify. Frameworks that parse the body before your handler runs therefore
 * destroy the ability to authenticate the request at all. Capture raw bytes
 * first; `docs/integration-supabase-edge.md` shows how on each runtime.
 *
 * There is intentionally no option to skip or soften this check. A webhook
 * endpoint is a public URL, and an unsigned POST to it is an anonymous message
 * from the internet.
 */

/** The header Meta sends. Lower-cased for map lookups. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';

const SIGNATURE_PREFIX = 'sha256=';
const SHA256_HEX_LENGTH = 64;

/** Header access that works with `Headers`, a record, or Node's raw object. */
export type HeadersLike =
  Headers | Record<string, string | string[] | undefined> | { get(name: string): string | null };

/** Why a signature check failed. No value from the request is echoed. */
export type SignatureFailureReason =
  | 'missing_header'
  | 'duplicate_header'
  | 'malformed_header'
  | 'unsupported_algorithm'
  | 'invalid_length'
  | 'mismatch'
  | 'missing_secret'
  | 'body_too_large';

export type SignatureVerificationResult =
  { ok: true } | { ok: false; reason: SignatureFailureReason; message: string };

export interface VerifySignatureInput {
  /**
   * The exact bytes of the request body. A string is accepted (it is the
   * lossless result of `await request.text()`); a parsed object is not.
   */
  rawBody: Uint8Array | ArrayBuffer | string;
  /** Request headers, or the header value directly. */
  headers?: HeadersLike;
  /** The `X-Hub-Signature-256` value, when you already have it in hand. */
  signatureHeader?: string;
  /** The Meta app secret. Never logged, never returned. */
  appSecret: string;
  /**
   * Reject bodies larger than this before doing any crypto. Meta batches up to
   * 1000 updates per POST, which is well under the 1 MiB default; raise it only
   * with a measured reason. Set to `0` to disable the cap.
   */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Read a single header value, rejecting repeats. */
function readHeader(headers: HeadersLike, name: string): { value?: string; duplicated: boolean } {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const value = headers.get(name);
    // `Headers` folds repeats into a comma-joined value. A signature never
    // contains a comma, so one here means the header arrived more than once.
    if (value !== null && value.includes(',')) return { duplicated: true };
    return { value: value ?? undefined, duplicated: false };
  }
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): string | null }).get(name);
    if (value !== null && value.includes(',')) return { duplicated: true };
    return { value: value ?? undefined, duplicated: false };
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(direct)) {
    if (direct.length > 1) return { duplicated: true };
    return { value: direct[0], duplicated: false };
  }
  if (typeof direct === 'string') {
    if (direct.includes(',')) return { duplicated: true };
    return { value: direct, duplicated: false };
  }
  // Fall back to a case-insensitive scan for runtimes that preserve casing.
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== name) continue;
    if (Array.isArray(value)) {
      if (value.length > 1) return { duplicated: true };
      return { value: value[0], duplicated: false };
    }
    if (typeof value === 'string') return { value, duplicated: false };
  }
  return { duplicated: false };
}

/**
 * Split `sha256=<hex>` into its digest bytes.
 *
 * Rejects a missing prefix, a different algorithm, a wrong digest length, and
 * any non-hex character. Meta sends lowercase hex; uppercase is accepted
 * because hex is case-insensitive and rejecting it would be a compatibility
 * risk with no security benefit.
 */
function parseSignatureHeader(
  header: string,
):
  | { ok: true; digest: Uint8Array }
  | { ok: false; reason: SignatureFailureReason; message: string } {
  const separator = header.indexOf('=');
  if (separator === -1) {
    return {
      ok: false,
      reason: 'malformed_header',
      message: 'X-Hub-Signature-256 is not in <algorithm>=<hex> form',
    };
  }
  const algorithm = header.slice(0, separator + 1);
  if (algorithm !== SIGNATURE_PREFIX) {
    return {
      ok: false,
      reason: 'unsupported_algorithm',
      message: 'X-Hub-Signature-256 must use the sha256= prefix',
    };
  }
  const hex = header.slice(separator + 1);
  if (hex.length !== SHA256_HEX_LENGTH) {
    return {
      ok: false,
      reason: 'invalid_length',
      message: `X-Hub-Signature-256 digest must be ${SHA256_HEX_LENGTH} hex characters`,
    };
  }
  const digest = hexToBytes(hex);
  if (digest === undefined) {
    return {
      ok: false,
      reason: 'malformed_header',
      message: 'X-Hub-Signature-256 digest is not valid hexadecimal',
    };
  }
  return { ok: true, digest };
}

/** Compute the raw HMAC-SHA-256 of `body` under `secret`, via Web Crypto. */
async function hmacSha256(secret: string, body: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, body as unknown as BufferSource);
  return new Uint8Array(signature);
}

/**
 * Verify a webhook delivery's signature.
 *
 * ```ts
 * const rawBody = new Uint8Array(await request.arrayBuffer());
 * const verified = await verifyWebhookSignature({
 *   rawBody,
 *   headers: request.headers,
 *   appSecret: APP_SECRET,
 * });
 * if (!verified.ok) return new Response('Forbidden', { status: 403 });
 * // Only now is it safe to parse.
 * ```
 */
export async function verifyWebhookSignature(
  input: VerifySignatureInput,
): Promise<SignatureVerificationResult> {
  if (typeof input.appSecret !== 'string' || input.appSecret.length === 0) {
    return {
      ok: false,
      reason: 'missing_secret',
      message: 'No app secret was supplied — cannot verify the delivery',
    };
  }

  let header = input.signatureHeader;
  if (header === undefined) {
    if (input.headers === undefined) {
      return {
        ok: false,
        reason: 'missing_header',
        message: 'Provide either `headers` or `signatureHeader`',
      };
    }
    const read = readHeader(input.headers, SIGNATURE_HEADER);
    if (read.duplicated) {
      return {
        ok: false,
        reason: 'duplicate_header',
        message: 'X-Hub-Signature-256 was supplied more than once',
      };
    }
    header = read.value;
  }

  if (header === undefined || header.length === 0) {
    return {
      ok: false,
      reason: 'missing_header',
      message: 'X-Hub-Signature-256 is missing',
    };
  }

  const parsed = parseSignatureHeader(header);
  if (!parsed.ok) return parsed;

  const body = toRawBytes(input.rawBody);
  const limit = input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (limit > 0 && body.length > limit) {
    return {
      ok: false,
      reason: 'body_too_large',
      message: `Body of ${body.length} bytes exceeds the ${limit}-byte limit`,
    };
  }

  const expected = await hmacSha256(input.appSecret, body);
  if (!timingSafeEqualBytes(parsed.digest, expected)) {
    return {
      ok: false,
      reason: 'mismatch',
      message: 'X-Hub-Signature-256 did not match the body',
    };
  }

  return { ok: true };
}

/**
 * Produce the header value Meta would send for a body.
 *
 * Exported for building test fixtures — it is the same computation the
 * verifier performs, so a test that uses it proves the round trip rather than
 * re-implementing the algorithm and proving nothing.
 */
export async function computeSignatureHeader(
  appSecret: string,
  rawBody: Uint8Array | ArrayBuffer | string,
): Promise<string> {
  const digest = await hmacSha256(appSecret, toRawBytes(rawBody));
  return `${SIGNATURE_PREFIX}${bytesToHex(digest)}`;
}
