import {
  asProviderLocaleCode,
  type AssureLocale,
  type ProviderLocaleCode,
} from '@assure-ai/whatsapp-types';
import { WhatsAppConfigError } from './errors.js';

/**
 * Explicit locale mapping, failing closed.
 *
 * The tempting implementation is `locale.replace('-', '_')`. It is wrong, and
 * the way it is wrong is expensive:
 *
 * - Meta's template language list is its own list. It contains `pt_BR` and
 *   `pt_PT` but no bare `pt`; `zh_CN`, `zh_HK`, `zh_TW` but no `zh`; `es_ES`,
 *   `es_MX`, `es_AR` but no `es_419`, which is a perfectly ordinary BCP 47 tag.
 * - Approval is per language. A template approved in `en_US` does not exist in
 *   `en_GB`, and a send naming a language the template was never approved in
 *   fails at the provider with a template error.
 * - When a mapping is wrong in the other direction — a valid-looking code for
 *   the wrong language — the send *succeeds* and a person receives a
 *   verification code in a language they cannot read.
 *
 * So there is no inference here at all. A mapping is data the customer or
 * operator supplies, and an unmapped locale raises rather than guessing. For
 * verification traffic, failing a send is strictly better than delivering an
 * unreadable one.
 */

/** A locale mapping: Assure's canonical locales to Meta's template codes. */
export interface LocaleMap {
  /** Look up a provider code, or `undefined` when unmapped. */
  get(locale: AssureLocale | string): ProviderLocaleCode | undefined;
  /** Look up a provider code, throwing when unmapped. */
  require(locale: AssureLocale | string): ProviderLocaleCode;
  /** True when a mapping exists. */
  has(locale: AssureLocale | string): boolean;
  /** Every Assure locale in the map. */
  locales(): string[];
}

export interface CreateLocaleMapOptions {
  /**
   * Fall back to this locale when the requested one is unmapped.
   *
   * Off by default, and worth thinking about before enabling: a fallback turns
   * "we do not support this language" from an error the operator sees into a
   * message the recipient cannot read. It is appropriate when the fallback is
   * a genuine lingua franca for the tenant's users, and wrong otherwise.
   */
  fallback?: AssureLocale | string;
  /**
   * Match case-insensitively and treat `-` and `_` as equivalent **on the
   * lookup key only**. The mapped provider value is always used verbatim.
   *
   * On by default: `en-US` and `en_us` are the same request, and forcing a
   * caller to normalize before every lookup invites them to normalize wrongly.
   */
  normalizeKeys?: boolean;
}

function normalizeKey(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Build a locale map from an explicit table.
 *
 * ```ts
 * const locales = createLocaleMap({
 *   'en-US': 'en_US',
 *   'es-MX': 'es_MX',
 *   'pt-BR': 'pt_BR',
 * });
 *
 * locales.require('en-US'); // ProviderLocaleCode "en_US"
 * locales.require('fr-FR'); // throws — add the mapping deliberately
 * ```
 */
export function createLocaleMap(
  table: Readonly<Record<string, string>>,
  options: CreateLocaleMapOptions = {},
): LocaleMap {
  if (!table || typeof table !== 'object') {
    throw new WhatsAppConfigError('A locale map requires a table of Assure locale to Meta code');
  }
  const normalizeKeys = options.normalizeKeys ?? true;

  // A null-prototype map, so a table entry named `constructor` or `__proto__`
  // cannot resolve to something inherited from Object.prototype.
  const entries = new Map<string, ProviderLocaleCode>();
  for (const [assureLocale, providerCode] of Object.entries(table)) {
    if (typeof assureLocale !== 'string' || assureLocale.trim() === '') {
      throw new WhatsAppConfigError('Locale map keys must be non-empty strings');
    }
    // Validated on construction rather than on use, so a typo in a config file
    // surfaces at startup instead of on the first send in that language.
    const code = asProviderLocaleCode(providerCode);
    const key = normalizeKeys ? normalizeKey(assureLocale) : assureLocale;
    if (entries.has(key)) {
      throw new WhatsAppConfigError(`Locale map contains a duplicate entry for "${assureLocale}"`);
    }
    entries.set(key, code);
  }

  const fallbackKey =
    options.fallback === undefined
      ? undefined
      : normalizeKeys
        ? normalizeKey(options.fallback)
        : options.fallback;

  if (fallbackKey !== undefined && !entries.has(fallbackKey)) {
    throw new WhatsAppConfigError(
      `Locale map fallback "${String(options.fallback)}" is not itself mapped`,
    );
  }

  const lookup = (locale: string): ProviderLocaleCode | undefined => {
    if (typeof locale !== 'string') return undefined;
    const key = normalizeKeys ? normalizeKey(locale) : locale;
    const direct = entries.get(key);
    if (direct !== undefined) return direct;
    if (fallbackKey !== undefined) return entries.get(fallbackKey);
    return undefined;
  };

  return {
    get: lookup,
    has: (locale) => lookup(locale) !== undefined,
    locales: () => [...entries.keys()],
    require(locale) {
      const code = lookup(locale);
      if (code === undefined) {
        throw new WhatsAppConfigError(
          `No Meta template language is mapped for locale "${String(locale)}". ` +
            'Add an explicit mapping — this is never inferred, because a wrong guess ' +
            'sends a verification message in a language the recipient cannot read.',
        );
      }
      return code;
    },
  };
}
