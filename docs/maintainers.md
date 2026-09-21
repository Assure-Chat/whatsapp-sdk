# Maintainer guide

How to keep these packages aligned with a provider that changes without asking.

## Meta contract basis

Every type, endpoint, and enum in this repository was derived from the documents below.
**All were read on 20 September 2026.** Meta edits these pages in place and does not
version them, so re-read before trusting any of it a year from now.

### Webhooks

| Document                                                                                                                                                                  | Used for                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`messages` webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)                                     | The `messages` envelope, inbound and outbound shapes                                |
| [Status messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status)                         | `statuses[]`, status enum (including `played`), `conversation`, `pricing`, `errors` |
| [Text messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text)                             | Inbound text                                                                        |
| [Interactive messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive)               | `button_reply`, `list_reply`                                                        |
| [Button messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button)                         | Template quick-reply taps                                                           |
| [`message_template_status_update` reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update) | Template status events, `rejection_info`                                            |
| [`phone_number_quality_update` reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update)       | Throughput and messaging-limit tiers                                                |
| [`account_update` reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update)                                 | Account-level envelope                                                              |
| [Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)                                   | GET challenge parameters, `X-Hub-Signature-256`, 1000-update batching               |
| [Graph API webhooks getting started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)                                                             | `sha256=` format, HMAC over the raw payload with the app secret                     |

### API

| Document                                                                                                                                                                           | Used for                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Message API reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api)                            | Send request/response schemas, `message_status` enum          |
| [Message Template API reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api)               | Template CRUD, every template enum, cursor paging             |
| [Phone Number Management API reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/phone-number-management-api) | Phone-number node fields and enums                            |
| [Phone number registration](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/phone-number-registration)          | `POST /{phone-number-id}/register`                            |
| [Subscribed Apps API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api)                           | Webhook subscription CRUD, `override_callback_uri`            |
| [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)       | `GET /oauth/access_token` code exchange, 30-second code TTL   |
| [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)                                         | What the browser hands the server                             |
| [Cloud API error codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)                                                             | Error envelope and the codes in `CODE_CLASSIFICATION`         |
| [Graph API versioning](https://developers.facebook.com/docs/graph-api/guides/versioning)                                                                                           | Version lifecycle; latest observed on that date was **v26.0** |

Meta serves a plain-Markdown rendering of most of these by appending `.md` to the URL
(no trailing slash) — the fastest way to diff a page against what this repo assumes.

### Deliberately excluded

Documented behaviour we chose **not** to ship, and why. Adding any of these means
verifying the current schema first.

- **`GET /debug_token`** — token metadata inspection. Referenced from the Facebook Login
  docs, but the reference page did not render a schema that could be read and verified in
  the session this repo was built in. Rather than type it from memory, it is excluded.
  `AccessTokenMetadata` covers what the exchange response itself carries.
- **`request_code` / `verify_code`** — the manual phone-number verification flow. The
  Embedded Signup path Assure uses goes through `POST /{phone-number-id}/register` with a
  PIN and never needs these.
- **Media upload, resumable upload, and media download.** Assure's templates reference
  media by handle, set at template-approval time. Adding upload means adding a whole
  SSRF surface for no current use.
- **Flows, catalogs, products, orders, calling, groups, block lists.** Out of scope.
- **Every inbound message type except text, interactive, button, and unsupported.** Other
  types normalize to `whatsapp.message.received` with their provider `type` preserved, so
  nothing is lost; they just have no dedicated handling.

## Moving to a new Graph API version

Callers pin the version, so a new Meta release does not break anyone automatically. What
it does is make the pinned version one step closer to retirement.

1. Read Meta's [changelog](https://developers.facebook.com/docs/graph-api/changelog) for
   every version between the current pin and the target.
2. Re-read the webhook references above. The things that actually move are payload shapes,
   not endpoints — `conversation` disappearing from status webhooks at v24.0 is the
   canonical example, and `old_limit`/`current_limit` on `phone_number_quality_update`
   are documented for removal in February 2026.
3. Update the fixtures in `packages/whatsapp-webhooks/test/fixtures/payloads.ts` to match
   the new shapes. Keep a fixture for the **old** shape too: callers on the older pin are
   still receiving it, and the parser has to handle both.
4. Run `npm test`. The fixtures are the regression suite.
5. Update the version in every example and in this guide's "latest observed" note.
6. Release a minor version and say plainly in the changelog which pins were tested.

Nothing in the source hard-codes a version. If a grep for `v2[0-9]\.[0-9]` finds one
outside a document or a test, that is a bug.

## When Meta adds an enum value

Nothing should break. Every provider enum is a `KnownOr<T>`, which accepts an unrecognized
string, and normalization turns an unmapped variant into a `whatsapp.unknown` event rather
than throwing.

To adopt a new value:

1. Add it to the union **and** to the exported runtime array beside it. The two are
   deliberately duplicated so `isKnown` can narrow.
2. If it needs a normalized event of its own, add the arm and the mapping in
   `normalize.ts`. The `default` branch keeps it safe in the meantime.
3. Add a fixture.

Never remove a value that Meta has deprecated but still sends. Old WABAs lag.

## Adding an endpoint

The bar: **only endpoints whose current schema has been read and verified.** If the shape
cannot be confirmed, leave it out and note it under "Deliberately excluded" above. A
speculative method that is wrong is worse than a missing one, because the caller finds out
in production.

When adding one, decide explicitly:

- Is it a mutation? Set `mutation: true` and it will never be retried.
- What is its route shape for logs? It must contain no caller identifiers.
- Does it need new identifier validation before URL construction?

## Dependency policy

Runtime dependencies: **none**, except the workspace cross-dependency on
`@assure-ai/whatsapp-types`, pinned exactly.

This is a deliberate trade. A validator library would save perhaps 200 lines of handwritten
parsing in `parse.ts` and `validate.ts`. It would also add a transitive tree to a package
that handles an app secret and a verification code path, and every one of those packages
would run in Assure's Edge functions. Handwritten narrow validation against official
fixtures is auditable in an afternoon; a dependency tree is not.

The `package.test.ts` suite enforces this: it fails if any package gains a runtime
dependency outside the `@assure-ai` scope.

Dev dependencies are conventional and match the sibling `assure-infobip-sdk` repo: tsup,
vitest, typescript, prettier, changesets.

## Release

See [release-readiness.md](release-readiness.md). Nothing in this repo publishes anything;
release is a reviewed human step.
