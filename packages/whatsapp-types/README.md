# @assure-ai/whatsapp-types

TypeScript types for Meta's **WhatsApp Business Platform Cloud API**, plus Assure's
normalized event contract.

> Independent Assure package — not published, endorsed, or reviewed by Meta. Meta's
> [documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp)
> and [policies](https://www.whatsapp.com/legal/business-policy/) are authoritative.

Types and small pure parsers. **No network, no environment reads, no runtime
dependencies, no state.**

```bash
npm install @assure-ai/whatsapp-types
```

## Branded identifiers

Every Graph identifier is a string, and most are numeric strings. Nothing stops a WABA ID
reaching a parameter expecting a phone-number ID — except that Graph will answer with a
generic error, against the wrong tenant's account.

```ts
import { asWabaId, asPhoneNumberId } from '@assure-ai/whatsapp-types';

const waba = asWabaId('102290129340398');
const phone = asPhoneNumberId('106540352242922');

sendFrom(waba); // compile error if sendFrom expects a PhoneNumberId
```

Branding is a typing aid. The brand is erased at runtime and a cast defeats it; the `as*`
parsers are what actually validate, and they throw `WhatsAppIdentifierError` — without
echoing the offending value, since these messages reach logs.

## Two phone-number representations

Assure stores E.164 (`+15555550123`). Meta returns digits only (`15555550123`) in
`wa_id`, `recipient_id`, and `contacts[].input`. Comparing the two fails silently forever,
so they are distinct types with an explicit conversion:

```ts
import {
  asE164PhoneNumber,
  toWhatsAppRecipient,
  isSameDestination,
} from '@assure-ai/whatsapp-types';

const stored = asE164PhoneNumber('+15555550123');
const provider = toWhatsAppRecipient(stored); // '15555550123'

isSameDestination(stored, provider); // true
```

The only transformation is the leading `+`. No country-code inference, no separator
stripping — a number that is not already valid E.164 is a bug upstream.

## Two locale representations

`ProviderLocaleCode` (`en_US`, what Meta wants) and `AssureLocale` (`en-US`, BCP 47) are
also distinct, and conversion is **never** inferred. `en-US` → `en_US` looks safe until
`es-419`, `zh-Hans`, or bare `pt`, none of which Meta supports. See `createLocaleMap` in
`@assure-ai/whatsapp-api`, which fails closed.

## Extensible enums

Meta adds enum values without a version bump. A closed union turns each addition into a
type error for consumers and a runtime rejection in webhook handlers.

```ts
import {
  isKnown,
  MESSAGE_DELIVERY_STATUSES,
  type KnownOr,
  type MessageDeliveryStatus,
} from '@assure-ai/whatsapp-types';

function handle(status: KnownOr<MessageDeliveryStatus>) {
  if (isKnown(status, MESSAGE_DELIVERY_STATUSES)) {
    // narrowed to the documented union
  } else {
    metrics.increment('whatsapp.unknown_status'); // safe, countable
  }
}
```

## What is modelled

- **Identifiers** — Graph version, app, WABA, phone number, business, template, message.
- **Messages** — template, text, and interactive requests as a discriminated union, with
  components, parameters, buttons, context, and the send response.
- **Templates** — the full management surface: statuses, categories, rejection reasons,
  quality scores, components, paging.
- **Accounts** — WABA, phone-number status and readiness, app subscriptions, registration.
- **Embedded Signup** — code exchange request/response, with token and metadata as
  separate types.
- **Webhooks** — both envelope families (`messages` and account-level, which differ), all
  documented value shapes.
- **Normalized events** — Assure's stable union.

## Normalized events carry provider facts only

```ts
type NormalizedEventKind =
  | 'whatsapp.message.received'
  | 'whatsapp.message.status.sent'
  | 'whatsapp.message.status.delivered'
  | 'whatsapp.message.status.read'
  | 'whatsapp.message.status.failed'
  | 'whatsapp.interaction.received'
  | 'whatsapp.template.status.updated'
  | 'whatsapp.phone.status.updated'
  | 'whatsapp.account.updated'
  | 'whatsapp.unknown';
```

No event has a tenant, an environment, a verification status, an assurance level, an OTP
result, or a passkey result — and none should be added. `whatsapp.message.status.read`
means a WhatsApp client rendered a message. It is not evidence that a person read it, that
the right person received it, or that any verification succeeded. There is a type-level
test asserting those fields are absent.

`WhatsAppConnectionMetadata` is likewise built so it _cannot_ express a secret: no
`accessToken`, `appSecret`, or `verifyToken` property exists, not even an optional one.

## License

MIT
