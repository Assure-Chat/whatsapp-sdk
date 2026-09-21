import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_HEADER,
  computeSignatureHeader,
  timingSafeEqualBytes,
  verifyWebhookSignature,
} from '../src/index.js';
import { TEST_APP_SECRET, encode, inboundTextPayload } from './fixtures/payloads.js';

const body = encode(inboundTextPayload);

async function signedHeader(bytes: Uint8Array = body): Promise<string> {
  return computeSignatureHeader(TEST_APP_SECRET, bytes);
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature over the exact bytes', async () => {
    const result = await verifyWebhookSignature({
      rawBody: body,
      signatureHeader: await signedHeader(),
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it('matches the documented sha256=<64 hex> format', async () => {
    expect(await signedHeader()).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('reads the signature from a Headers object', async () => {
    const headers = new Headers({ [SIGNATURE_HEADER]: await signedHeader() });
    const result = await verifyWebhookSignature({
      rawBody: body,
      headers,
      appSecret: TEST_APP_SECRET,
    });
    expect(result.ok).toBe(true);
  });

  it('reads the signature from a plain record with original header casing', async () => {
    const headers = { 'X-Hub-Signature-256': await signedHeader() };
    const result = await verifyWebhookSignature({
      rawBody: body,
      headers,
      appSecret: TEST_APP_SECRET,
    });
    expect(result.ok).toBe(true);
  });

  it('fails when a single body byte changes', async () => {
    const header = await signedHeader();
    const tampered = Uint8Array.from(body);
    // Flip one bit in the middle of the payload.
    const index = Math.floor(tampered.length / 2);
    tampered[index] = (tampered[index] ?? 0) ^ 0x01;

    const result = await verifyWebhookSignature({
      rawBody: tampered,
      signatureHeader: header,
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it('fails when the body is parsed and re-serialized into different bytes', async () => {
    // This is the failure mode that a JSON body-parser middleware creates:
    // the object is identical, the bytes are not.
    const header = await signedHeader();
    const reserialized = encode(JSON.parse(new TextDecoder().decode(body)) as unknown);

    // Guard the premise — if the round trip happened to be byte-identical the
    // assertion below would pass for the wrong reason.
    const spaced = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(body)) as unknown, null, 2),
    );
    expect(timingSafeEqualBytes(spaced, body)).toBe(false);

    const result = await verifyWebhookSignature({
      rawBody: spaced,
      signatureHeader: header,
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, reason: 'mismatch' });

    // A compact re-serialization of this fixture does round-trip, which is
    // exactly why relying on it is unsafe: it works until a payload contains a
    // non-ASCII character or a float, and then silently stops.
    expect(reserialized.length).toBeGreaterThan(0);
  });

  it('verifies a body containing multi-byte UTF-8 correctly', async () => {
    const unicode = new TextEncoder().encode(
      JSON.stringify({ object: 'whatsapp_business_account', note: 'émoji 🙂 日本語' }),
    );
    const header = await computeSignatureHeader(TEST_APP_SECRET, unicode);
    const result = await verifyWebhookSignature({
      rawBody: unicode,
      signatureHeader: header,
      appSecret: TEST_APP_SECRET,
    });
    expect(result.ok).toBe(true);
  });

  it('verifies arbitrary binary bytes, including NUL', async () => {
    const binary = new Uint8Array([0x00, 0xff, 0x7f, 0x80, 0x00, 0x01]);
    const header = await computeSignatureHeader(TEST_APP_SECRET, binary);
    expect(
      await verifyWebhookSignature({
        rawBody: binary,
        signatureHeader: header,
        appSecret: TEST_APP_SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it('treats a string body as its UTF-8 encoding', async () => {
    const text = JSON.stringify(inboundTextPayload);
    const header = await computeSignatureHeader(TEST_APP_SECRET, text);
    expect(
      await verifyWebhookSignature({
        rawBody: text,
        signatureHeader: header,
        appSecret: TEST_APP_SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a parsed object outright', async () => {
    await expect(
      verifyWebhookSignature({
        // A caller holding an object has already lost the original bytes.
        rawBody: inboundTextPayload as unknown as string,
        signatureHeader: await signedHeader(),
        appSecret: TEST_APP_SECRET,
      }),
    ).rejects.toThrow(TypeError);
  });

  it.each([
    ['missing header', undefined, 'missing_header'],
    ['empty header', '', 'missing_header'],
    ['no separator', 'sha256abcdef', 'malformed_header'],
    ['wrong algorithm', `sha1=${'a'.repeat(40)}`, 'unsupported_algorithm'],
    ['digest too short', `sha256=${'a'.repeat(63)}`, 'invalid_length'],
    ['digest too long', `sha256=${'a'.repeat(65)}`, 'invalid_length'],
    ['non-hex digest', `sha256=${'z'.repeat(64)}`, 'malformed_header'],
  ])('rejects a %s', async (_name, header, reason) => {
    const result = await verifyWebhookSignature({
      rawBody: body,
      ...(header === undefined ? { headers: {} } : { signatureHeader: header }),
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('rejects a duplicated signature header', async () => {
    const header = await signedHeader();
    const result = await verifyWebhookSignature({
      rawBody: body,
      headers: { [SIGNATURE_HEADER]: [header, header] },
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, reason: 'duplicate_header' });
  });

  it('accepts an uppercase hex digest, since hex is case-insensitive', async () => {
    const header = await signedHeader();
    const upper = `sha256=${header.slice('sha256='.length).toUpperCase()}`;
    expect(
      await verifyWebhookSignature({
        rawBody: body,
        signatureHeader: upper,
        appSecret: TEST_APP_SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it('fails closed when no app secret is configured', async () => {
    const result = await verifyWebhookSignature({
      rawBody: body,
      signatureHeader: await signedHeader(),
      appSecret: '',
    });
    expect(result).toMatchObject({ ok: false, reason: 'missing_secret' });
  });

  it('fails for a signature computed under a different secret', async () => {
    const result = await verifyWebhookSignature({
      rawBody: body,
      signatureHeader: await computeSignatureHeader('a_different_secret', body),
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it('rejects a body over the size cap before doing any crypto', async () => {
    const big = new Uint8Array(2048);
    const result = await verifyWebhookSignature({
      rawBody: big,
      signatureHeader: await computeSignatureHeader(TEST_APP_SECRET, big),
      appSecret: TEST_APP_SECRET,
      maxBodyBytes: 1024,
    });
    expect(result).toMatchObject({ ok: false, reason: 'body_too_large' });
  });

  it('never echoes the secret or the expected digest in a failure', async () => {
    const result = await verifyWebhookSignature({
      rawBody: body,
      signatureHeader: `sha256=${'0'.repeat(64)}`,
      appSecret: TEST_APP_SECRET,
    });
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TEST_APP_SECRET);
    const expected = (await signedHeader()).slice('sha256='.length);
    expect(serialized).not.toContain(expected);
  });
});

describe('timingSafeEqualBytes', () => {
  it('is true only for identical byte sequences', () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });

  it('compares the full length regardless of where the difference is', () => {
    // Not a timing measurement — a structural check that an early difference
    // and a late one are treated identically.
    const base = new Uint8Array(64).fill(7);
    const earlyDiff = Uint8Array.from(base);
    earlyDiff[0] = 8;
    const lateDiff = Uint8Array.from(base);
    lateDiff[63] = 8;
    expect(timingSafeEqualBytes(base, earlyDiff)).toBe(false);
    expect(timingSafeEqualBytes(base, lateDiff)).toBe(false);
  });
});
