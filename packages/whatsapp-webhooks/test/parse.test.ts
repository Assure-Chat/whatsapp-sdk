import { describe, expect, it } from 'vitest';
import { parseWebhookPayload } from '../src/index.js';
import { WABA_ID, encode, inboundTextPayload } from './fixtures/payloads.js';

describe('parseWebhookPayload', () => {
  it('parses a documented envelope', () => {
    const result = parseWebhookPayload(encode(inboundTextPayload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.object).toBe('whatsapp_business_account');
    expect(result.payload.entry).toHaveLength(1);
    expect(result.payload.entry[0]?.id).toBe(WABA_ID);
  });

  it.each([
    ['an empty body', '', 'empty_body'],
    ['invalid JSON', '{not json', 'malformed_json'],
    ['a JSON array', '[]', 'not_an_object'],
    ['a JSON string', '"hello"', 'not_an_object'],
    ['a payload with no object', '{"entry":[]}', 'unexpected_object'],
    ['another product', '{"object":"page","entry":[]}', 'unexpected_object'],
    ['a payload with no entry', '{"object":"whatsapp_business_account"}', 'missing_entry'],
  ])('rejects %s', (_name, body, reason) => {
    expect(parseWebhookPayload(new TextEncoder().encode(body))).toMatchObject({
      ok: false,
      reason,
    });
  });

  it('rejects an entry array with no usable changes', () => {
    const result = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: [{ id: WABA_ID, changes: [{ field: '' }, { value: 1 }, 'not an object'] }],
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'no_valid_changes' });
  });

  it('drops malformed entries but keeps the well-formed ones', () => {
    const result = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: [
          'garbage',
          { id: '', changes: [] },
          {
            id: WABA_ID,
            changes: [{ field: 'messages', value: { messaging_product: 'whatsapp' } }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.entry).toHaveLength(1);
  });

  it('keeps a change whose value is null, since `value` was present', () => {
    const result = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: [{ id: WABA_ID, changes: [{ field: 'messages', value: null }] }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('enforces the body size cap', () => {
    expect(parseWebhookPayload(encode(inboundTextPayload), { maxBodyBytes: 16 })).toMatchObject({
      ok: false,
      reason: 'body_too_large',
    });
  });

  it('enforces the entry-count cap', () => {
    const entry = { id: WABA_ID, changes: [{ field: 'messages', value: {} }] };
    const result = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: Array.from({ length: 5 }, () => entry),
      }),
      { maxEntries: 2 },
    );
    expect(result).toMatchObject({ ok: false, reason: 'body_too_large' });
  });

  it('rejects a payload carrying a prototype-polluting key', () => {
    // JSON.parse does not apply `__proto__` as a setter, but code that later
    // spreads or merges a provider object would. Refusing the body outright is
    // cheaper than auditing every downstream merge.
    const body =
      '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"__proto__":{"polluted":true}}}]}]}';
    const result = parseWebhookPayload(new TextEncoder().encode(body));
    expect(result).toMatchObject({ ok: false });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('does not recurse without bound on a deeply nested payload', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 200; depth += 1) nested = { nested };
    const result = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: [{ id: WABA_ID, changes: [{ field: 'messages', value: nested }] }],
      }),
    );
    // Treated as suspicious rather than walked — what matters is that it
    // returns instead of overflowing the stack.
    expect(result.ok).toBe(false);
  });

  it('refuses a parsed object, which cannot have been signature-verified', () => {
    expect(() => parseWebhookPayload(inboundTextPayload as unknown as string)).toThrow(TypeError);
  });

  it('never quotes body content in a failure message', () => {
    const secretish = JSON.stringify({ object: 'page', token: 'EAAG_super_secret_value' });
    const result = parseWebhookPayload(new TextEncoder().encode(secretish));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('EAAG_super_secret_value');
  });
});
