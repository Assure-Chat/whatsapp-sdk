# Integration guide — Supabase Edge, Deno, and Node

How to wire these packages into Assure, with the raw-body problem solved per runtime.

Everything here uses placeholders. **No example puts a secret in frontend code**, and no
example uses a realistic token.

---

## The one thing to get right

Webhook signature verification needs the **exact bytes Meta signed**. Almost every
convenient way to read a request body destroys them:

| What you write               | What happens                                              |
| ---------------------------- | --------------------------------------------------------- |
| `await request.json()`       | Body consumed, bytes gone                                 |
| `express.json()`             | Body parsed before your handler runs                      |
| `JSON.stringify(parsedBody)` | Different bytes — whitespace, escaping, number formatting |

Read bytes first, then decode from those bytes. `receiveWebhook` does the decoding for
you, so in practice: get a `Uint8Array`, hand it over, done.

---

## Supabase Edge Functions / Deno

The happy path. `Request` gives you bytes directly and Web Crypto is built in.

```ts
// supabase/functions/whatsapp-webhook/index.ts
import { receiveWebhook, verifySubscriptionChallenge } from 'npm:@assure-ai/whatsapp-webhooks';

// Read once, at module load, from the function's configured secrets.
const APP_SECRET = Deno.env.get('APP_SECRET')!;
const VERIFY_TOKEN = Deno.env.get('WEBHOOK_VERIFY_TOKEN')!;

Deno.serve(async (request) => {
  // --- GET: Meta's one-time subscription handshake ---
  if (request.method === 'GET') {
    const result = verifySubscriptionChallenge({
      query: new URL(request.url).searchParams,
      expectedVerifyToken: VERIFY_TOKEN,
    });
    return result.ok
      ? new Response(result.challenge, { status: 200 })
      : new Response('Forbidden', { status: 403 });
  }

  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // --- POST: bytes first, then verify, then parse ---
  const rawBody = new Uint8Array(await request.arrayBuffer());

  const result = await receiveWebhook({
    rawBody,
    headers: request.headers,
    appSecret: APP_SECRET,
  });

  if (!result.ok) {
    // 4xx, not 5xx: Meta retries 5xx, and a forged delivery should not be retried.
    console.warn('whatsapp.webhook.rejected', { stage: result.stage, reason: result.reason });
    return new Response('Forbidden', { status: 403 });
  }

  // Enqueue durably, then acknowledge. Do not process inline — Meta retries
  // anything that is not a 200, and there is no API for fetching missed events.
  for (const event of result.events) {
    await enqueue(event);
  }

  return new Response('', { status: 200 });
});
```

Notes specific to Edge:

- **Leave `readRetry` off.** A retry sleeps inside your function's billed wall-clock time.
- Keep the handler's work to verification plus an enqueue. Everything else belongs in a
  worker that can take as long as it needs.
- `npm:` specifiers work; so does importing from a bundler. The packages use only
  web-standard APIs.

---

## Node.js 20+ with a Fetch-style handler

Identical to the above:

```ts
import { readRawRequest, receiveWebhook } from '@assure-ai/whatsapp-webhooks';

export async function handleWebhook(request: Request): Promise<Response> {
  const { rawBody, headers } = await readRawRequest(request);
  const result = await receiveWebhook({ rawBody, headers, appSecret: APP_SECRET });
  if (!result.ok) return new Response('Forbidden', { status: 403 });
  await Promise.all(result.events.map(enqueue));
  return new Response('', { status: 200 });
}
```

---

## Express

Express's JSON parser is the most common cause of "signatures fail in production". Use its
`verify` hook, which sees the buffer before parsing:

```ts
import express from 'express';
import { receiveWebhook } from '@assure-ai/whatsapp-webhooks';

const app = express();

app.post(
  '/webhooks/whatsapp',
  express.json({
    limit: '1mb',
    // Stash the exact bytes before they are parsed away.
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
  async (req, res) => {
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (rawBody === undefined) return res.sendStatus(400);

    const result = await receiveWebhook({
      // A Buffer is a Uint8Array, so it passes through unchanged.
      rawBody,
      headers: req.headers as Record<string, string | string[] | undefined>,
      appSecret: process.env.APP_SECRET!,
    });

    if (!result.ok) return res.sendStatus(403);
    await Promise.all(result.events.map(enqueue));
    return res.sendStatus(200);
  },
);
```

Simpler and harder to get wrong — skip the JSON parser entirely, since you never need the
parsed body:

```ts
app.post('/webhooks/whatsapp', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const result = await receiveWebhook({
    rawBody: req.body as Buffer,
    headers: req.headers as Record<string, string | string[] | undefined>,
    appSecret: process.env.APP_SECRET!,
  });
  if (!result.ok) return res.sendStatus(403);
  await Promise.all(result.events.map(enqueue));
  return res.sendStatus(200);
});
```

---

## Fastify

```ts
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
  done(null, body),
);

fastify.post('/webhooks/whatsapp', async (request, reply) => {
  const result = await receiveWebhook({
    rawBody: request.body as Buffer,
    headers: request.headers,
    appSecret: process.env.APP_SECRET!,
  });
  if (!result.ok) return reply.code(403).send();
  await Promise.all(result.events.map(enqueue));
  return reply.code(200).send();
});
```

---

## Raw Node `http`

```ts
import { readRawStream, receiveWebhook } from '@assure-ai/whatsapp-webhooks';

const server = http.createServer(async (req, res) => {
  const rawBody = await readRawStream(req, { maxBytes: 1024 * 1024 });
  const result = await receiveWebhook({
    rawBody,
    headers: req.headers,
    appSecret: process.env.APP_SECRET!,
  });
  res.writeHead(result.ok ? 200 : 403).end();
  if (result.ok) await Promise.all(result.events.map(enqueue));
});
```

---

## Dependency injection for the API client

The client reads no environment and holds no global state, so tenancy and testing both
work by passing things in.

```ts
import { createWhatsAppClient, createLocaleMap } from '@assure-ai/whatsapp-api';

// Built once at startup — provider codes are validated here, so a typo in
// configuration fails at boot rather than on the first send in that language.
const locales = createLocaleMap({
  'en-US': 'en_US',
  'es-MX': 'es_MX',
  'pt-BR': 'pt_BR',
});

/** One client per tenant, per request. Never cache these globally. */
export async function clientFor(tenantId: string) {
  return createWhatsAppClient({
    accessToken: await secrets.get(tenantId, 'WA_ACCESS_TOKEN'),
    graphApiVersion: config.graphApiVersion, // e.g. 'v24.0'
    timeoutMs: 15_000,
    logger: {
      debug: (message, metadata) => log.debug(message, metadata),
      warn: (message, metadata) => log.warn(message, metadata),
    },
    // Recorded in client.metadata for observability. Scopes nothing by itself.
    wabaId: tenant.wabaId,
    phoneNumberId: tenant.phoneNumberId,
  });
}
```

In tests, inject `fetch`, `sleep`, and `now` — no network, no real timers:

```ts
const client = createWhatsAppClient({
  accessToken: 'test_token',
  graphApiVersion: 'v24.0',
  fetch: async () =>
    new Response(
      JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.TEST' }] }),
    ),
  sleep: async () => undefined,
  now: () => 1_700_000_000_000,
});
```

---

## Sending inside a durable job

The shape that makes ambiguous outcomes survivable:

```ts
import { isAmbiguousOutcome, isWhatsAppApiError } from '@assure-ai/whatsapp-api';

export async function sendVerification(job: Job) {
  const client = await clientFor(job.tenantId);

  // Record the attempt BEFORE dispatch. If the process dies mid-send, this row
  // is what tells the reconciler that a message may exist.
  await jobs.markDispatching(job.id);

  try {
    const response = await client.messages.sendTemplate({
      phoneNumberId: job.phoneNumberId,
      to: job.destination,
      template: {
        name: job.templateName,
        language: { code: locales.require(job.locale), policy: 'deterministic' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: job.code }] }],
      },
      // Echoed on every status webhook for this message.
      callbackData: job.id,
    });

    await jobs.markSent(job.id, response.messages?.[0]?.id);
  } catch (error) {
    if (isAmbiguousOutcome(error)) {
      // The message may exist. Do NOT re-send here: wait for a status webhook
      // carrying callbackData === job.id, and escalate if none arrives.
      await jobs.markNeedsReconciliation(job.id);
      return;
    }
    if (isWhatsAppApiError(error) && error.retryable) {
      await jobs.scheduleRetry(job.id, error.retryAfterMs ?? 30_000);
      return;
    }
    await jobs.markFailed(job.id, { classification: (error as WhatsAppError).classification });
  }
}
```

---

## Handling normalized events

Switch exhaustively, and keep the `default` arm — it is what makes an unknown provider
value safe.

```ts
import { toSafeEventMetadata } from '@assure-ai/whatsapp-webhooks';
import type { NormalizedWhatsAppEvent } from '@assure-ai/whatsapp-types';

export async function handle(event: NormalizedWhatsAppEvent) {
  // Safe to log at any level: no destinations, names, or content.
  log.info('whatsapp.event', toSafeEventMetadata(event));

  switch (event.kind) {
    case 'whatsapp.message.status.sent':
    case 'whatsapp.message.status.delivered':
    case 'whatsapp.message.status.read':
      // Transport progress only. This is NOT a verification result and must
      // never be allowed to advance one.
      await jobs.recordTransportStatus(event.callbackData, event.kind);
      return;

    case 'whatsapp.message.status.failed':
      await jobs.recordFailure(event.callbackData, event.errors);
      return;

    case 'whatsapp.interaction.received':
      // Route on the business-assigned id, never the user-visible label.
      if (event.replyId === 'not_me') await security.raiseNotMeSignal(event);
      return;

    case 'whatsapp.message.received':
      await inbox.record(event);
      return;

    case 'whatsapp.template.status.updated':
      await templates.syncStatus(event.templateId, event.event);
      return;

    case 'whatsapp.phone.status.updated':
    case 'whatsapp.account.updated':
      await connections.refresh(event.wabaId);
      return;

    case 'whatsapp.unknown':
      // Count it. The first notice of a provider schema change should be a
      // metric, not a support ticket.
      metrics.increment('whatsapp.unknown_event', { field: event.field, reason: event.reason });
      return;

    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
```

---

## Deduplication

The library supplies key candidates; the application owns the constraint.

```ts
async function enqueue(event: NormalizedWhatsAppEvent) {
  const key = event.deduplicationKeys[0];
  if (key === undefined) {
    // No provider ID strong enough to key on — process it, but flag it.
    metrics.increment('whatsapp.event_without_dedup_key');
    return queue.push(event);
  }

  // Scope the uniqueness constraint to YOUR tenancy model. The same wamid can
  // legitimately appear under two WABAs in a multitenant deployment, so a
  // global unique index on it would silently drop events.
  const inserted = await db.insertIfAbsent({ tenantId, dedupKey: key });
  if (!inserted) return; // already seen
  return queue.push(event);
}
```

---

## Environment variables

These packages read none. Assure's application code reads them and passes values in.
Suggested names, all placeholders:

```bash
WA_ACCESS_TOKEN=          # per-tenant, from a secret store — not a .env in production
APP_SECRET=               # Meta app secret, for webhook HMAC
WEBHOOK_VERIFY_TOKEN=     # for the one-time GET challenge only
PHONE_NUMBER_ID=15550000000
WABA_ID=10000000000000
GRAPH_API_VERSION=v24.0
```

Never expose `WA_ACCESS_TOKEN` or `APP_SECRET` to a browser. There is no browser export in
any of these packages, and the Embedded Signup helper is server-only for this reason.
