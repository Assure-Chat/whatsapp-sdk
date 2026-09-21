import { describe, expect, it } from 'vitest';
import { WhatsAppConfigError, createLocaleMap } from '../src/index.js';

const TABLE = {
  'en-US': 'en_US',
  'es-MX': 'es_MX',
  'pt-BR': 'pt_BR',
};

describe('createLocaleMap', () => {
  it('maps a configured locale to its provider code', () => {
    const locales = createLocaleMap(TABLE);
    expect(locales.require('en-US')).toBe('en_US');
    expect(locales.get('pt-BR')).toBe('pt_BR');
    expect(locales.has('es-MX')).toBe(true);
  });

  it('normalizes the lookup key but never the mapped value', () => {
    const locales = createLocaleMap(TABLE);
    expect(locales.require('en_us')).toBe('en_US');
    expect(locales.require('EN-US')).toBe('en_US');
  });

  it('fails closed on an unmapped locale rather than guessing', () => {
    const locales = createLocaleMap(TABLE);
    expect(locales.get('fr-FR')).toBeUndefined();
    expect(locales.has('fr-FR')).toBe(false);
    expect(() => locales.require('fr-FR')).toThrow(WhatsAppConfigError);
    expect(() => locales.require('fr-FR')).toThrow(/never inferred/);
  });

  it('does not invent a mapping by swapping the separator', () => {
    // The tempting `replace('-', '_')` would answer `es_419` here, which is
    // not a language Meta supports — and answering `es_ES` would be worse,
    // because the send would succeed in the wrong language.
    const locales = createLocaleMap(TABLE);
    expect(locales.get('es-419')).toBeUndefined();
    expect(locales.get('zh-Hans')).toBeUndefined();
    expect(locales.get('pt')).toBeUndefined();
  });

  it('applies a fallback only when one was configured deliberately', () => {
    const strict = createLocaleMap(TABLE);
    expect(strict.get('de-DE')).toBeUndefined();

    const lenient = createLocaleMap(TABLE, { fallback: 'en-US' });
    expect(lenient.require('de-DE')).toBe('en_US');
  });

  it('rejects a fallback that is not itself mapped', () => {
    expect(() => createLocaleMap(TABLE, { fallback: 'ja-JP' })).toThrow(/not itself mapped/);
  });

  it('validates provider codes when the map is built, not on first send', () => {
    expect(() => createLocaleMap({ 'en-US': 'not a locale!' })).toThrow(
      /ProviderLocaleCode is malformed/,
    );
  });

  it('rejects duplicate keys that normalize to the same lookup', () => {
    expect(() => createLocaleMap({ 'en-US': 'en_US', en_us: 'en_GB' })).toThrow(/duplicate entry/);
  });

  it('rejects an empty key', () => {
    expect(() => createLocaleMap({ '': 'en_US' })).toThrow(WhatsAppConfigError);
  });

  it('does not resolve inherited Object properties as locales', () => {
    const locales = createLocaleMap(TABLE);
    expect(locales.get('constructor')).toBeUndefined();
    expect(locales.get('__proto__')).toBeUndefined();
    expect(locales.get('toString')).toBeUndefined();
  });

  it('lists the locales it knows', () => {
    expect(createLocaleMap(TABLE).locales().sort()).toEqual(['en-us', 'es-mx', 'pt-br']);
  });

  it('can be built with normalization off for exact-key matching', () => {
    const locales = createLocaleMap(TABLE, { normalizeKeys: false });
    expect(locales.require('en-US')).toBe('en_US');
    expect(locales.get('en_us')).toBeUndefined();
  });
});
