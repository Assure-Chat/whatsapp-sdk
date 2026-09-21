# @assure-ai/whatsapp-api

A narrow, stateless client for Meta's **WhatsApp Business Platform Cloud API**.

> Independent Assure package — not published, endorsed, or reviewed by Meta, and not the
> archived official `whatsapp` npm SDK. Meta's
> [documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp)
> and [policies](https://www.whatsapp.com/legal/business-policy/) are authoritative.

```bash
npm install @assure-ai/whatsapp-api
```

Node.js 20+, Deno, and Supabase Edge. Web standards only — `fetch`, `URL`, `AbortSignal`,
Web Crypto. Zero runtime dependencies outside the `@assure-ai` scope.

## Construction

```ts
import { createWhatsAppClient } from '@assure-ai/whatsapp-api';

const client = createWhatsAppClient({
  accessToken: await secrets.get(tenantId, 'WA_ACCESS_TOKEN'),
  graphApiVersion: 'v24.0',
  timeoutMs: 15_000,
  logger: safeLogger,
});
```

`graphApiVersion` is **required**, with no default and no `latest`. Meta ships a new
version roughly quarterly, retires each after about two years, and changes payload shapes
between them. A library that tracked the newest version would change your wire contract
during an unrelated dependency bump.

Each call returns a fresh client holding its own credentials. There is no singleton and no
`process.env` read anywhere, so two tenants' tokens cannot bleed. Pass a function for
`accessToken` to resolve it per request from a secret store.

## Sending

```ts
await client.messages.sendTemplate({
  phoneNumberId,
  to: asE164PhoneNumber('+15555550123'),
  template: {
    name: 'example_template',
    language: { code: locales.require('en-US'), policy: 'deterministic' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
  },
  callbackData: jobId, // echoed on every status webhook for this message
});

await client.messages.sendText({ phoneNumberId, to, text: { body: 'Hello' } }); // in-window only
await client.messages.sendInteractive({ phoneNumberId, to, interactive }); // in-window only
await client.messages.markRead({ phoneNumberId, messageId });
```

Requests are validated before dispatch for the mistakes Meta does _not_ catch — mixed
named and positional parameters, non-contiguous button indexes, duplicate reply IDs. Meta
accepts several of these and renders a blank where your verification code should be.

### Sends are never retried automatically

Meta's send endpoint has no idempotency key. A blind replay can deliver the same
verification code twice, which looks to a user exactly like an account compromise.

When a send fails _after_ dispatch, you get `WhatsAppAmbiguousOutcomeError` —
`retryable === false`:

```ts
import { isAmbiguousOutcome } from '@assure-ai/whatsapp-api';

try {
  await client.messages.sendTemplate({ /* ... */, callbackData: job.id });
} catch (error) {
  if (isAmbiguousOutcome(error)) {
    // The message may exist. Wait for a status webhook carrying
    // callbackData === job.id before doing anything else.
    await jobs.markNeedsReconciliation(job.id);
  }
}
```

An abort _before_ dispatch is a plain cancellation, not an ambiguous outcome — the client
checks the signal before calling `fetch`, so nothing left the process.

## Templates

```ts
const page = await client.templates.list({ wabaId, status: ['APPROVED'], limit: 50 });

for await (const template of client.templates.iterate({ wabaId, maxPages: 10 })) {
  // maxPages is required — no unbounded traversal
}

await client.templates.get({ templateId });
await client.templates.create({ wabaId, template });
await client.templates.update({ templateId, changes });
await client.templates.delete({ wabaId, name, templateId }); // templateId scopes to one language
```

`delete` with `name` alone removes **every language** of the template. Pass `templateId`
to scope it to one.

Paging never follows Graph's `paging.next` URL, which embeds the access token as a query
parameter. The cursor is lifted out and the request rebuilt with a header.

Status answers are point-in-time. Approval is per language and revocable; subscribe to
`message_template_status_update` for what happens in between.

## Accounts and readiness

```ts
await client.accounts.getWaba({ wabaId });
await client.accounts.listPhoneNumbers({ wabaId });
await client.accounts.getPhoneNumber({ phoneNumberId });
await client.accounts.registerPhoneNumber({ phoneNumberId, pin });
await client.accounts.listSubscribedApps({ wabaId });
await client.accounts.subscribeApp({ wabaId });
await client.accounts.unsubscribeApp({ wabaId });
```

These return provider facts. They do not decide tenant ownership or production readiness —
that is an Assure judgement made from these plus entitlement, consent, and budget.

## Embedded Signup (server-side only)

```ts
const { accessToken, metadata } = await client.signup.exchangeAuthorizationCode({
  appId: asMetaAppId(META_APP_ID),
  appSecret: APP_SECRET,
  code: codeFromBrowser, // 30-second TTL
});

await secrets.store(tenantId, accessToken); // never log it
log.info('signup.exchanged', metadata); // safe: carries no token
```

The result's `toJSON` yields only the metadata, so a result object reaching a structured
logger does not carry the token. Nothing is persisted, cached, or refreshed here. There is
no browser export, no Facebook JavaScript SDK, and no browser-safe build — the app secret
belongs only on a server.

## Locales fail closed

```ts
import { createLocaleMap } from '@assure-ai/whatsapp-api';

const locales = createLocaleMap({ 'en-US': 'en_US', 'es-MX': 'es_MX' });

locales.require('en-US'); // 'en_US'
locales.require('fr-FR'); // throws — add the mapping deliberately
```

Never inferred. `replace('-', '_')` fails on `es-419`, `zh-Hans`, and bare `pt`; and when
it produces a _valid but wrong_ code, the send succeeds and someone receives a
verification code in a language they cannot read.

## Errors

A typed hierarchy under `WhatsAppError`, each carrying a `classification`:
`configuration`, `authentication`, `authorization`, `rate_limit`, `template`, `locale`,
`recipient`, `policy`, `validation`, `not_found`, `conflict`,
`retryable_provider_failure`, `ambiguous_outcome`, `timeout`, `connection`, `unknown`.

Classification prefers Meta's numeric code over the HTTP status, because Graph answers 400
for everything from a malformed body to a disabled template.

`retryable` is a conservative assessment of whether an identical request could succeed —
**not** an instruction to repeat a send.

Errors are redacted by construction. `JSON.stringify(error)` yields status, Meta's codes,
a sanitized message, `fbtrace_id`, `retryAfterMs`, and the route shape. It never yields
tokens, headers, destinations, message bodies, authorization codes, or full URLs.

## Retries and observability

Automatic retries are **off by default**. When enabled they apply to safe reads only —
never to a send, template submission, or registration, whatever the setting:

```ts
readRetry: { maxRetries: 2, initialDelayMs: 500, maxDelayMs: 8_000 }
```

Bounded exponential backoff with full jitter, honouring `Retry-After`. On an Edge runtime
a retry sleeps inside your billed wall-clock time, which is why it is opt-in.

`logger`, `onRequest`, and `onResponse` receive route shapes, statuses, attempt counts,
durations, and `fbtrace_id` — never headers, bodies, or URLs.

## License

MIT
