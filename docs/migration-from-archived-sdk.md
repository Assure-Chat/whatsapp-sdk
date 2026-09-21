# Why not Meta's archived `whatsapp` SDK

## What happened

Meta published an official Node.js SDK on npm as `whatsapp`. **Meta archived it in 2023.**
It is not maintained, and it does not track the Cloud API's current behaviour.

## Why this matters more than usual

An archived SDK is normally a mild inconvenience. Here it is a correctness problem,
because the API it wrapped has moved underneath it in ways that matter to verification
traffic:

- **Graph API versions have turned over several times.** Payload shapes changed with them
  — the `conversation` object disappeared from status webhooks at v24.0, and pricing moved
  from `CBP` to `PMP` with new `type` and `category` fields.
- **New enum values ship continuously.** A closed union written in 2023 rejects values
  Meta sends in 2026.
- **Template management grew substantially** — `parameter_format`, named parameters,
  `quality_score`, new rejection reasons, new statuses.
- **Embedded Signup did not exist in its current form.** The tech-provider onboarding flow
  and the code-exchange endpoint are how Assure onboards customers.

Using it would mean inheriting a 2023 model of the API and discovering each difference in
production.

## What this repository does instead

Narrow, handwritten types verified against Meta's current published documentation, with
the source document and access date recorded in [maintainers.md](maintainers.md). Only the
endpoints Assure actually uses, and only those whose schemas could be read and confirmed.

That is a smaller surface than a general SDK, on purpose. It is also one that a reviewer
can check against the docs in an afternoon.

## Why not another community SDK

The popular alternatives fall into two groups:

- **Wrappers around the same Cloud API**, with varying currency and varying dependency
  trees. Adopting one means trusting its maintenance and its transitive dependencies in
  code that handles an app secret and runs in Edge functions.
- **WhatsApp Web automation** — Baileys, `whatsapp-web.js`, and similar. These drive the
  consumer client by emulating a browser or a device. They are not the Business Platform,
  they violate WhatsApp's terms for business messaging, and they get numbers banned. They
  are out of scope here and always will be.

## If you are migrating from `whatsapp`

There is no drop-in shim, and one would be a bad idea — it would hide exactly the
differences you need to see. The mapping is roughly:

| Archived SDK concept                            | Here                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `new WhatsApp(senderNumberId)` reading env vars | `createWhatsAppClient({ accessToken, graphApiVersion })`, no env reads       |
| Implicit/defaulted API version                  | `graphApiVersion` required, no default                                       |
| `messages.text(...)`, `messages.template(...)`  | `client.messages.sendText(...)`, `client.messages.sendTemplate(...)`         |
| Built-in webhook server (`webhooks.start()`)    | No server. `receiveWebhook(...)` from raw bytes, mounted in your own handler |
| Generic thrown errors                           | A typed hierarchy with `classification` and redacted `toJSON`                |
| Automatic retries                               | None for mutations, ever; opt-in bounded retries for reads                   |

The two changes that need the most attention when porting:

1. **Webhook signature verification is now mandatory and needs raw bytes.** If your old
   handler used a JSON body parser, that has to change first — see
   [integration-supabase-edge.md](integration-supabase-edge.md).
2. **Sends are not retried for you.** Wrap them in a durable job and reconcile ambiguous
   outcomes against status webhooks.
