---
'@assure-ai/whatsapp-types': minor
'@assure-ai/whatsapp-api': minor
'@assure-ai/whatsapp-webhooks': minor
---

Initial release of the Assure WhatsApp SDK — independent TypeScript packages for Meta's
WhatsApp Business Platform Cloud API.

**`@assure-ai/whatsapp-types`** — branded identifiers with runtime parsers, distinct E.164
and provider-recipient representations, distinct Assure and provider locale types,
extensible provider enums that tolerate new values, documented message/template/account
contracts, both webhook envelope families, and Assure's normalized event union.

**`@assure-ai/whatsapp-api`** — a stateless per-tenant client. Caller-pinned Graph API
version with no default. No environment reads and no singleton, so tenant credentials
cannot bleed. Template, text, and interactive sends with pre-dispatch validation; template
management with bounded cursor paging that never follows Graph's token-bearing `next` URL;
WABA, phone-number, and subscription discovery; server-side Embedded Signup code exchange
that separates the token from serializable metadata. Mutations are never retried
automatically, and one that fails after dispatch raises a distinct
`WhatsAppAmbiguousOutcomeError`. Typed, classified, redacted errors.

**`@assure-ai/whatsapp-webhooks`** — subscription-challenge verification with constant-time
comparison, `X-Hub-Signature-256` HMAC-SHA-256 verification over exact raw bytes via Web
Crypto with no bypass, bounded structural parsing that rejects prototype-polluting keys,
normalization that preserves unknown variants as `whatsapp.unknown`, deterministic
deduplication key candidates, redaction helpers, and a trusted-ingress assertion type that
refuses to treat a header as mTLS.

Runs on Node.js 20+, Deno, and Supabase Edge. No runtime dependencies outside the
`@assure-ai` scope.
