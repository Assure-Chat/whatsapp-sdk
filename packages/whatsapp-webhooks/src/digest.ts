import { bytesToHex, toRawBytes } from './bytes.js';

/**
 * SHA-256 of the raw body, as lowercase hex.
 *
 * For correlating a log line, a stored payload, and a support ticket without
 * putting any of the body in any of them. The digest is not a secret and is
 * safe to log; the body it was computed over is neither.
 *
 * It is also a usable last-resort deduplication key for a delivery Meta
 * repeats byte-for-byte — though not for one it re-batches differently, which
 * is why `deduplicationKeys` on each normalized event prefers provider IDs.
 */
export async function sha256Hex(body: Uint8Array | ArrayBuffer | string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toRawBytes(body) as unknown as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}
