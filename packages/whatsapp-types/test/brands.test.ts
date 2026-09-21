import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  WhatsAppIdentifierError,
  asE164PhoneNumber,
  asGraphApiVersion,
  asPhoneNumberId,
  asProviderLocaleCode,
  asWabaId,
  asWhatsAppMessageId,
  asWhatsAppRecipient,
  isSameDestination,
  toE164PhoneNumber,
  toWhatsAppRecipient,
  type E164PhoneNumber,
  type PhoneNumberId,
  type WabaId,
  type WhatsAppRecipient,
} from '../src/index.js';

describe('identifier parsers', () => {
  it.each([
    ['v24.0', true],
    ['v23.0', true],
    ['v100.12', true],
    ['24.0', false],
    ['latest', false],
    ['v24', false],
    ['', false],
  ])('parses Graph version %s as valid=%s', (value, valid) => {
    if (valid) expect(asGraphApiVersion(value)).toBe(value);
    else expect(() => asGraphApiVersion(value)).toThrow(WhatsAppIdentifierError);
  });

  it.each([
    ['102290129340398', true],
    ['1', true],
    ['12a', false],
    ['../../me', false],
    ['-1', false],
    ['', false],
  ])('parses node id %s as valid=%s', (value, valid) => {
    if (valid) expect(asWabaId(value)).toBe(value);
    else expect(() => asWabaId(value)).toThrow(WhatsAppIdentifierError);
  });

  it('parses a wamid but rejects an arbitrary string', () => {
    const id = 'wamid.HBgLMTU1NTU1NTAxMjMVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=';
    expect(asWhatsAppMessageId(id)).toBe(id);
    expect(() => asWhatsAppMessageId('not-a-wamid')).toThrow(WhatsAppIdentifierError);
  });

  it('rejects a non-string value', () => {
    expect(() => asWabaId(12345 as unknown)).toThrow(/must be a string/);
    expect(() => asWabaId(null)).toThrow(WhatsAppIdentifierError);
  });

  it('never echoes the offending value in the error message', () => {
    // These messages end up in logs; a destination must not ride along. The
    // value here is deliberately different from the example number in the
    // hint text, so a match would mean the input really was echoed.
    const error = (() => {
      try {
        asE164PhoneNumber('19995551234');
        return undefined;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error?.message).not.toContain('19995551234');
    expect(error?.message).toContain('E.164');
  });

  it('does not echo a malformed message id either', () => {
    const error = (() => {
      try {
        asWhatsAppMessageId('wamid.LEAKED_SENSITIVE_VALUE_!!!');
        return undefined;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error?.message).not.toContain('LEAKED_SENSITIVE_VALUE');
  });

  it('names the identifier kind on the error', () => {
    try {
      asPhoneNumberId('bad');
    } catch (caught) {
      expect((caught as WhatsAppIdentifierError).kind).toBe('PhoneNumberId');
    }
  });
});

describe('E.164 versus provider recipient', () => {
  it('accepts E.164 with a leading plus and rejects it without', () => {
    expect(asE164PhoneNumber('+15555550123')).toBe('+15555550123');
    expect(() => asE164PhoneNumber('15555550123')).toThrow(WhatsAppIdentifierError);
  });

  it('accepts a digits-only recipient and rejects it with a plus', () => {
    expect(asWhatsAppRecipient('15555550123')).toBe('15555550123');
    expect(() => asWhatsAppRecipient('+15555550123')).toThrow(WhatsAppIdentifierError);
  });

  it('converts between the two representations losslessly', () => {
    const e164 = asE164PhoneNumber('+15555550123');
    const recipient = toWhatsAppRecipient(e164);
    expect(recipient).toBe('15555550123');
    expect(toE164PhoneNumber(recipient)).toBe(e164);
  });

  it('does not repair a malformed number', () => {
    // No country-code inference, no separator stripping: a number that is not
    // already valid E.164 is a bug upstream.
    expect(() => toWhatsAppRecipient('(555) 555-0123')).toThrow(WhatsAppIdentifierError);
    expect(() => toWhatsAppRecipient('5555550123')).toThrow(WhatsAppIdentifierError);
  });

  it('compares destinations across representations', () => {
    expect(isSameDestination('+15555550123', '15555550123')).toBe(true);
    expect(isSameDestination('15555550123', '15555550123')).toBe(true);
    expect(isSameDestination('+15555550123', '15555550124')).toBe(false);
    expect(isSameDestination('garbage', '15555550123')).toBe(false);
  });
});

describe('locale codes', () => {
  it('accepts both provider forms without rewriting either', () => {
    // Meta's own docs use en_US on templates and en-US on the template status
    // webhook, so both have to parse — and neither is normalized.
    expect(asProviderLocaleCode('en_US')).toBe('en_US');
    expect(asProviderLocaleCode('en-US')).toBe('en-US');
    expect(asProviderLocaleCode('pt_BR')).toBe('pt_BR');
  });

  it('rejects something that is not a language tag', () => {
    expect(() => asProviderLocaleCode('not a locale!')).toThrow(WhatsAppIdentifierError);
    expect(() => asProviderLocaleCode('')).toThrow(WhatsAppIdentifierError);
  });
});

describe('branding (compile-time)', () => {
  it('keeps distinct identifier kinds mutually unassignable', () => {
    const waba = asWabaId('102290129340398');
    const phone = asPhoneNumberId('106540352242922');

    expectTypeOf(waba).toEqualTypeOf<WabaId>();
    expectTypeOf(phone).toEqualTypeOf<PhoneNumberId>();
    // The whole point of branding: these are both numeric strings at runtime
    // and must not substitute for each other at compile time.
    expectTypeOf<WabaId>().not.toMatchTypeOf<PhoneNumberId>();
    expectTypeOf<PhoneNumberId>().not.toMatchTypeOf<WabaId>();
    // And a bare string is not either of them.
    expectTypeOf<string>().not.toMatchTypeOf<WabaId>();
  });

  it('keeps the two destination representations unassignable', () => {
    expectTypeOf<E164PhoneNumber>().not.toMatchTypeOf<WhatsAppRecipient>();
    expectTypeOf<WhatsAppRecipient>().not.toMatchTypeOf<E164PhoneNumber>();
  });

  it('still allows a branded value where a plain string is wanted', () => {
    // Branding must not make identifiers awkward to log or concatenate.
    const waba: string = asWabaId('102290129340398');
    expect(waba.length).toBe(15);
  });
});
