# @assure-ai/whatsapp-webhooks

Framework-neutral primitives for receiving **WhatsApp Business Platform** webhooks.

> Independent Assure package — not published, endorsed, or reviewed by Meta. Meta's
> [documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp)
> and [policies](https://www.whatsapp.com/legal/business-policy/) are authoritative.

```bash
npm install @assure-ai/whatsapp-webhooks
```

Starts no server, depends on no framework, reads no environment. Works from raw bytes and
web-standard APIs, so the same code runs on Node.js 20+, Deno, and Supabase Edge.

## The whole thing

```ts
import { receiveWebhook, verifySubscriptionChallenge } from '@assure-ai/whatsapp-webhooks';

// GET — Meta's one-time subscription handshake
const challenge = verifySubscriptionChallenge({
  query: new URL(request.url).searchParams,
  expectedVerifyToken: WEBHOOK_VERIFY_TOKEN,
});
if (challenge.ok) return new Response(challenge.challenge, { status: 200 });

// POST — every event delivery
const result = await receiveWebhook({
  rawBody: new Uint8Array(await request.arrayBuffer()),
  headers: request.headers,
  appSecret: APP_SECRET,
});
if (!result.ok) return new Response('Forbidden', { status: 403 });

for (const event of result.events) await enqueue(event);
return new Response('', { status: 200 });
```

`receiveWebhook` verifies, then parses, then normalizes — in that order, with the
signature check before the body is even decoded. It exists so the shortest correct thing
to write is also the safe thing. Nothing documented here reaches a parsed payload without
verifying first.

Failures are returned, never thrown. A webhook route that throws returns 500, and Meta
retries 500s; a forged delivery should be refused with a 4xx and counted.

## Three things this package will not pretend

### The verify token is not POST authentication

Meta sends it exactly once, during the GET handshake when the callback URL is saved. It
**never** appears on an event delivery. An endpoint checking a verify token on POSTs is
checking a header no attacker has to supply.

Comparison is constant-time, duplicated parameters are rejected rather than resolved, and
the expected token is never returned or logged.

### Sent, delivered, read, and clicked are not verification

Normalized events carry provider facts. `whatsapp.message.status.read` means a WhatsApp
client rendered a message in an open thread. Nothing here sets or implies an assurance
level, OTP outcome, or passkey result.

### A header is not mTLS

Client-certificate enforcement belongs at the TLS ingress. This package validates no
certificates and offers no header-reading default — see
[docs/mtls-ingress.md](../../docs/mtls-ingress.md). `assertTrustedIngress` records a
decision your application made cryptographically; it adds no trust of its own, and there
is a test proving spoofed certificate headers establish nothing.

## Signature verification needs exact bytes

HMAC-SHA-256 over the raw body with the app secret, presented as `sha256=<64 hex>`.

`JSON.parse` followed by `JSON.stringify` reorders nothing but reformats everything, and
the result will not verify. Passing a parsed object throws a `TypeError` rather than
silently re-serializing — the failure has to be loud, because the tempting fix for
"signatures fail in production" is to weaken the check.

Rejected: missing, empty, duplicated, wrong-algorithm, wrong-length, and non-hex
signatures. There is no bypass, no `'none'` mode, and no development shortcut.

Runtime-specific raw-body capture is in
[docs/integration-supabase-edge.md](../../docs/integration-supabase-edge.md).

## Normalized events

Ten kinds, listed in the [types README](../whatsapp-types/README.md). Three rules hold:

1. **Nothing is interpreted as verification.**
2. **Nothing is defaulted.** A missing WABA, phone-number ID, or timestamp stays missing —
   substituting a plausible value would route an event to the wrong tenant.
3. **Nothing is discarded.** An unmodelled field, variant, or value becomes
   `whatsapp.unknown` carrying the original change, so it is countable and inspectable.

Order is preserved as received and never re-sorted. Meta guarantees no ordering, and
`read` can arrive without a preceding `delivered` — re-sorting would hide that from the
layer that owns the state machine.

## Deduplication

Every event carries `deduplicationKeys`, strongest first, built from provider IDs plus the
event kind. Identical redeliveries produce identical keys; `sent` and `delivered` for one
message never collide.

The package does **not** deduplicate. Your application owns the constraint, because only
it knows the tenant scope the key must be unique within — the same `wamid` under two WABAs
is two different things, and a global unique index would drop events.

`sha256Hex(rawBody)` gives a safe correlation digest.

## Redaction

```ts
import { toSafeEventMetadata, summarizeEvents } from '@assure-ai/whatsapp-webhooks';

log.info('whatsapp.event', toSafeEventMetadata(event)); // safe at any level
log.info('whatsapp.batch', summarizeEvents(events)); // counts only, no identifiers
```

Safe metadata omits phone numbers in both representations, profile names, message content,
media, button labels, and `biz_opaque_callback_data`. Message IDs are truncated to 24
characters, because a `wamid` encodes the destination in its base64 body.

The full normalized event _does_ carry `from` and `recipientId` — routing needs them. Do
not log it wholesale.

## Limits

1 MiB body cap checked before any crypto, 1000-entry batch cap matching Meta's documented
limit, depth-bounded traversal, and rejection of prototype-polluting keys. All
configurable.

## License

MIT
