# Assure WhatsApp SDK

Three TypeScript packages for Meta's **WhatsApp Business Platform Cloud API**, built for
Assure's multitenant authentication and verification platform.

> **Not a Meta package.** These are independent, Assure-maintained wrappers around Meta's
> public HTTPS APIs. They are not published, endorsed, or reviewed by Meta. Meta's
> [official documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp)
> and [platform policies](https://www.whatsapp.com/legal/business-policy/) remain
> authoritative for everything described here. They are also **not** the archived official
> `whatsapp` npm SDK — see [docs/migration-from-archived-sdk.md](docs/migration-from-archived-sdk.md).

## Packages

| Package                                                      | What it is                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [`@assure-ai/whatsapp-types`](packages/whatsapp-types)       | Provider types, branded identifiers, and Assure's normalized event contract. No network, no runtime dependencies. |
| [`@assure-ai/whatsapp-api`](packages/whatsapp-api)           | A stateless Cloud API client — messages, templates, phone numbers, subscriptions, Embedded Signup code exchange.  |
| [`@assure-ai/whatsapp-webhooks`](packages/whatsapp-webhooks) | Framework-neutral webhook primitives — challenge verification, raw-body HMAC, typed parsing, normalization.       |

## Which package do I need?

- **Sending anything** → `whatsapp-api` (it re-exports the types you need).
- **Receiving webhooks** → `whatsapp-webhooks` (same).
- **Only modelling data** — a queue payload, a database row, a shared contract between
  services → `whatsapp-types` alone, which pulls in nothing.

All three ship ESM and CJS with declarations, run on Node.js 20+, and work unchanged on
Deno and Supabase Edge Functions through web-standard APIs.

## Things that are true and easy to get wrong

These are not stylistic preferences. Each one is a way a verification platform breaks.

1. **Sent, delivered, read, and clicked do not mean verified.** A `read` status means a
   WhatsApp client rendered a message in an open thread. It says nothing about who was
   holding the phone. Normalized events carry provider facts only, and the type system
   forbids an assurance field on them.
2. **The webhook verify token is not POST authentication.** Meta sends it once, during the
   GET handshake when the callback URL is saved. Event deliveries are authenticated by
   `X-Hub-Signature-256` and nothing else.
3. **HMAC verification needs the exact raw bytes.** A JSON body-parser destroys them.
   Capture bytes first — see the [integration guide](docs/integration-supabase-edge.md).
4. **Graph API versions are caller-pinned.** No default, no `latest`. Meta changes payload
   shapes between versions and retires each one after about two years.
5. **Template approval and locale readiness are external facts.** Approval is per language,
   revocable, and not something these packages can cache. A locale mapping is explicit
   configuration; it is never inferred.
6. **Sends are never retried automatically.** Meta's send endpoint has no idempotency key,
   so a blind replay can deliver a verification code twice.
7. **mTLS is an ingress concern.** See [docs/mtls-ingress.md](docs/mtls-ingress.md).
8. **Meta's WhatsApp Business Tools MCP is developer tooling, not the send path.** It is
   useful for setup and manual testing. No package here calls it, imports it, or depends
   on it at runtime.
9. **The application owns tenant authorization, durable jobs, consent, budgets, and result
   semantics.** These packages deliberately know nothing about any of them.

## Quick start

```ts
import { createWhatsAppClient, asE164PhoneNumber, asPhoneNumberId } from '@assure-ai/whatsapp-api';

const client = createWhatsAppClient({
  accessToken: await secrets.get(tenantId, 'WA_ACCESS_TOKEN'),
  graphApiVersion: 'v24.0', // pin it deliberately
});

await client.messages.sendTemplate({
  phoneNumberId: asPhoneNumberId(PHONE_NUMBER_ID),
  to: asE164PhoneNumber('+15555550123'),
  template: {
    name: 'example_template',
    language: { code: locales.require('en-US'), policy: 'deterministic' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
  },
  callbackData: jobId, // echoed on every status webhook
});
```

```ts
import { receiveWebhook } from '@assure-ai/whatsapp-webhooks';

const result = await receiveWebhook({
  rawBody: new Uint8Array(await request.arrayBuffer()),
  headers: request.headers,
  appSecret: APP_SECRET,
});
if (!result.ok) return new Response('Forbidden', { status: 403 });
for (const event of result.events) await enqueue(event);
return new Response('', { status: 200 });
```

More in [`examples/`](examples).

## Documentation

- [Threat model](docs/threat-model.md) — what these packages defend against, and what they
  explicitly leave to the application and the ingress.
- [Maintainer guide](docs/maintainers.md) — how to move to a new Graph API version, and the
  exact Meta documents each type came from.
- [Supabase Edge / Node integration](docs/integration-supabase-edge.md) — dependency
  injection and raw-body capture per runtime.
- [mTLS at the ingress](docs/mtls-ingress.md).
- [Why not the archived `whatsapp` SDK](docs/migration-from-archived-sdk.md).
- [Release readiness](docs/release-readiness.md).

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run pack:check
```

Tests are offline and deterministic — no test contacts Meta. The Deno compatibility smoke
test runs with no network and no environment permission:

```bash
deno run --allow-read scripts/deno-smoke.ts
```

## Scope

Implemented: Cloud API message sends (template, text, interactive, read receipts), template
management and status, WABA and phone-number discovery, phone-number registration, app
subscription management, server-side Embedded Signup code exchange, webhook challenge
verification, raw-body signature verification, typed parsing, and normalized events.

Deliberately out of scope: WhatsApp Web automation and consumer-client protocols; Assure's
OTP, passkey, tenant, routing, consent, job, and billing logic; any database, secret store,
HTTP server, or framework middleware; a generic Graph API wrapper; Meta MCP client code;
runtime AI translation.

## License

MIT — see [LICENSE](LICENSE).
