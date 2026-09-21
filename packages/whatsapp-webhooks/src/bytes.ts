/**
 * Byte utilities shared by the challenge and signature paths.
 *
 * Everything here works from `Uint8Array` and uses only web-standard APIs, so
 * the same code runs on Node 20+, Deno, and Supabase Edge without a branch.
 */

const encoder = new TextEncoder();

/** UTF-8 encode a string. */
export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

/**
 * Compare two byte sequences in time independent of where they first differ.
 *
 * Length is compared first and returned early. That does leak length, which is
 * fine here: the length of a hex digest is fixed and public, and the length of
 * a verify token is not the secret — its contents are. What must not leak is
 * the position of the first mismatching byte, because that turns a guessing
 * attack from 256^n into 256*n.
 *
 * The loop runs over the full length with no early exit and accumulates
 * differences with a bitwise OR, so the work done is identical for a value
 * that differs in byte 0 and one that differs only in the last byte.
 */
export function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}

/** As {@link timingSafeEqualBytes}, over the UTF-8 encoding of two strings. */
export function timingSafeEqualStrings(left: string, right: string): boolean {
  return timingSafeEqualBytes(utf8(left), utf8(right));
}

/**
 * Parse an even-length hex string into bytes, or `undefined` if it is not one.
 *
 * Strict on purpose: no whitespace tolerance, no `0x` prefix, no odd length.
 * A signature header that does not parse is a rejected delivery, not something
 * to repair.
 */
export function hexToBytes(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 2 !== 0) return undefined;
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    const high = hexNibble(value.charCodeAt(index * 2));
    const low = hexNibble(value.charCodeAt(index * 2 + 1));
    if (high === undefined || low === undefined) return undefined;
    out[index] = (high << 4) | low;
  }
  return out;
}

function hexNibble(code: number): number | undefined {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10; // a-f
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10; // A-F
  return undefined;
}

/** Lowercase hex encoding of a byte sequence. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Coerce the shapes a runtime might hand you as a raw body into bytes.
 *
 * A `string` is accepted and UTF-8 encoded, because that is what
 * `await request.text()` returns and it round-trips losslessly. A parsed
 * object is **not** accepted, here or anywhere: re-serializing an object
 * produces different bytes from the ones Meta signed, so the signature would
 * fail for correct traffic and the temptation would be to weaken the check.
 */
export function toRawBytes(body: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return utf8(body);
  throw new TypeError(
    'Raw webhook body must be a Uint8Array, ArrayBuffer, or string — ' +
      'a parsed object cannot be signature-verified because re-serializing it changes the bytes',
  );
}
