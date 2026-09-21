/**
 * Branded identifier types and their parsers.
 *
 * Every identifier Meta hands out is a string, and most of them are numeric
 * strings. Nothing in the type system stops a WABA ID being passed where a
 * phone-number ID belongs, and the Graph API answers such a mistake with a
 * generic 100 — so the mistake surfaces at runtime, against the wrong tenant's
 * account, rather than at the call site.
 *
 * Branding closes that gap at compile time. It is a typing aid and nothing
 * more: the brand is erased at runtime, a cast defeats it, and a value that
 * arrived over the wire carries no guarantee just because it has been typed.
 * Where a real check is needed, use the `as*` parsers here — they validate the
 * shape and throw {@link WhatsAppIdentifierError} on anything unusable.
 */

declare const brandSymbol: unique symbol;

/** Attach a compile-time-only tag to a primitive. @internal */
export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };

/** Thrown by the `as*` parsers when a value cannot be that kind of identifier. */
export class WhatsAppIdentifierError extends Error {
  /** Which identifier kind the value was being parsed as. */
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = 'WhatsAppIdentifierError';
    this.kind = kind;
  }
}

/**
 * A Graph API version, always in `v<major>.<minor>` form — `v23.0`, `v24.0`.
 *
 * There is deliberately no default anywhere in these packages. Meta ships a new
 * version roughly quarterly and retires each one about two years later, and
 * payload shapes change between them (the `conversation` object on status
 * webhooks, for one, is omitted from v24.0 onward). A library that silently
 * tracked the newest version would change the caller's wire contract during an
 * unrelated dependency bump.
 */
export type GraphApiVersion = Brand<string, 'GraphApiVersion'>;

/** Meta app ID, from the App Dashboard. Numeric string. */
export type MetaAppId = Brand<string, 'MetaAppId'>;

/** WhatsApp Business Account ID. Numeric string. */
export type WabaId = Brand<string, 'WabaId'>;

/** Business phone number ID — the node messages are sent from. Numeric string. */
export type PhoneNumberId = Brand<string, 'PhoneNumberId'>;

/** Meta Business portfolio ID. Numeric string. */
export type BusinessId = Brand<string, 'BusinessId'>;

/** Message template ID. Numeric string. Meta calls this `hsm_id` on delete. */
export type TemplateId = Brand<string, 'TemplateId'>;

/**
 * A WhatsApp message ID — an opaque `wamid.`-prefixed base64-ish token.
 *
 * Unlike the other identifiers this is not numeric, and it is the join key for
 * status webhooks, so it is worth keeping distinct from every other string.
 */
export type WhatsAppMessageId = Brand<string, 'WhatsAppMessageId'>;

/**
 * A destination in E.164 form, with the leading `+` — `+15555550123`.
 *
 * This is the shape Assure holds internally. It is **not** what Meta echoes
 * back: see {@link WhatsAppRecipient}.
 */
export type E164PhoneNumber = Brand<string, 'E164PhoneNumber'>;

/**
 * A destination as the provider represents it: digits only, no `+`.
 *
 * Meta accepts either form on `to`, but every value it returns — `wa_id`,
 * `recipient_id`, `contacts[].input` — is digits-only. Comparing a stored
 * `+15555550123` against a webhook's `15555550123` fails, silently, forever,
 * so the two representations get distinct types and an explicit conversion.
 */
export type WhatsAppRecipient = Brand<string, 'WhatsAppRecipient'>;

/**
 * A language/locale code exactly as Meta expects it on a template.
 *
 * Meta's own documentation is not internally consistent here: template message
 * sends and the template management API use `en_US`, while the
 * `message_template_status_update` webhook has been observed emitting `en-US`.
 * Both forms are therefore accepted, and neither is rewritten — see
 * {@link AssureLocale} for why no conversion is attempted.
 */
export type ProviderLocaleCode = Brand<string, 'ProviderLocaleCode'>;

/**
 * A BCP 47 locale as Assure canonically stores it — `en-US`, `pt-BR`, `es-419`.
 *
 * Kept distinct from {@link ProviderLocaleCode} on purpose. Replacing `-` with
 * `_` is not a general conversion: Meta's supported-language list contains
 * codes with no BCP 47 counterpart and vice versa, and a wrong guess sends a
 * template in a language the recipient cannot read, or fails the send outright.
 * Mapping is an explicit, per-customer decision — see `createLocaleMap` in
 * `@assure-ai/whatsapp-api`.
 */
export type AssureLocale = Brand<string, 'AssureLocale'>;

/** An opaque Graph cursor from `paging.cursors`. */
export type PagingCursor = Brand<string, 'PagingCursor'>;

const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;
const NUMERIC_ID_PATTERN = /^\d{1,32}$/;
const MESSAGE_ID_PATTERN = /^wamid\.[A-Za-z0-9_\-=+/]{1,512}$/;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const RECIPIENT_PATTERN = /^[1-9]\d{6,14}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8}){0,3}$/;

function requireString(kind: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new WhatsAppIdentifierError(kind, `${kind} must be a string, got ${typeof value}`);
  }
  return value;
}

function match(kind: string, value: unknown, pattern: RegExp, hint: string): string {
  const text = requireString(kind, value);
  if (!pattern.test(text)) {
    // The value itself is not echoed: a destination or a token fragment has no
    // business in an exception message that may be logged.
    throw new WhatsAppIdentifierError(kind, `${kind} is malformed — expected ${hint}`);
  }
  return text;
}

/** Parse a Graph API version such as `v24.0`. */
export function asGraphApiVersion(value: unknown): GraphApiVersion {
  return match(
    'GraphApiVersion',
    value,
    GRAPH_VERSION_PATTERN,
    'v<major>.<minor>, for example v24.0',
  ) as GraphApiVersion;
}

/** Parse a Meta app ID. */
export function asMetaAppId(value: unknown): MetaAppId {
  return match('MetaAppId', value, NUMERIC_ID_PATTERN, 'a numeric string') as MetaAppId;
}

/** Parse a WhatsApp Business Account ID. */
export function asWabaId(value: unknown): WabaId {
  return match('WabaId', value, NUMERIC_ID_PATTERN, 'a numeric string') as WabaId;
}

/** Parse a business phone number ID. */
export function asPhoneNumberId(value: unknown): PhoneNumberId {
  return match('PhoneNumberId', value, NUMERIC_ID_PATTERN, 'a numeric string') as PhoneNumberId;
}

/** Parse a Meta Business portfolio ID. */
export function asBusinessId(value: unknown): BusinessId {
  return match('BusinessId', value, NUMERIC_ID_PATTERN, 'a numeric string') as BusinessId;
}

/** Parse a message template ID. */
export function asTemplateId(value: unknown): TemplateId {
  return match('TemplateId', value, NUMERIC_ID_PATTERN, 'a numeric string') as TemplateId;
}

/** Parse a `wamid.`-prefixed WhatsApp message ID. */
export function asWhatsAppMessageId(value: unknown): WhatsAppMessageId {
  return match(
    'WhatsAppMessageId',
    value,
    MESSAGE_ID_PATTERN,
    'a wamid.-prefixed identifier',
  ) as WhatsAppMessageId;
}

/** Parse an E.164 destination, leading `+` required. */
export function asE164PhoneNumber(value: unknown): E164PhoneNumber {
  return match(
    'E164PhoneNumber',
    value,
    E164_PATTERN,
    'E.164 with a leading +, for example +15555550123',
  ) as E164PhoneNumber;
}

/** Parse a provider-shaped recipient: digits only, no `+`. */
export function asWhatsAppRecipient(value: unknown): WhatsAppRecipient {
  return match(
    'WhatsAppRecipient',
    value,
    RECIPIENT_PATTERN,
    'digits only with no leading +, for example 15555550123',
  ) as WhatsAppRecipient;
}

/** Parse a provider locale code, accepting both `en_US` and `en-US` forms. */
export function asProviderLocaleCode(value: unknown): ProviderLocaleCode {
  return match(
    'ProviderLocaleCode',
    value,
    LOCALE_PATTERN,
    'a language tag such as en_US',
  ) as ProviderLocaleCode;
}

/** Parse an Assure canonical BCP 47 locale. */
export function asAssureLocale(value: unknown): AssureLocale {
  return match('AssureLocale', value, LOCALE_PATTERN, 'a BCP 47 tag such as en-US') as AssureLocale;
}

/** Wrap a Graph paging cursor. Cursors are opaque, so only emptiness is checked. */
export function asPagingCursor(value: unknown): PagingCursor {
  const text = requireString('PagingCursor', value);
  if (text === '')
    throw new WhatsAppIdentifierError('PagingCursor', 'PagingCursor must not be empty');
  return text as PagingCursor;
}

/**
 * Convert an E.164 destination into the digits-only form Meta echoes back.
 *
 * The only transformation is dropping the leading `+`. No country-code
 * inference, no national-format parsing, no stripping of separators: a number
 * that is not already valid E.164 is a bug upstream, not something to repair
 * here.
 */
export function toWhatsAppRecipient(value: E164PhoneNumber | string): WhatsAppRecipient {
  const e164 = asE164PhoneNumber(value);
  return asWhatsAppRecipient(e164.slice(1));
}

/** Convert a provider recipient back to E.164 by restoring the leading `+`. */
export function toE164PhoneNumber(value: WhatsAppRecipient | string): E164PhoneNumber {
  const digits = asWhatsAppRecipient(value);
  return asE164PhoneNumber(`+${digits}`);
}

/**
 * True when two destinations refer to the same number regardless of which
 * representation each is in.
 *
 * Meta's own docs warn that a user's `wa_id` and their phone number "may not
 * always match", so a false here is not proof of a different person — it is
 * only proof that the two strings are not the same number.
 */
export function isSameDestination(
  left: E164PhoneNumber | WhatsAppRecipient | string,
  right: E164PhoneNumber | WhatsAppRecipient | string,
): boolean {
  const normalize = (value: string): string | undefined => {
    if (E164_PATTERN.test(value)) return value.slice(1);
    if (RECIPIENT_PATTERN.test(value)) return value;
    return undefined;
  };
  const a = normalize(left);
  const b = normalize(right);
  return a !== undefined && a === b;
}
