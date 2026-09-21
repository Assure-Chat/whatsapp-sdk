# Threat model

What these packages defend against, what they deliberately do not, and where the boundary
sits. The second and third parts matter most: a library that is vague about its limits
gets trusted for things it never did.

Throughout, **library** means code in this repository, **application** means Assure's
platform code that consumes it, and **ingress** means the TLS terminator in front of the
application.

---

## 1. Access-token exposure

**Threat.** A tenant's Cloud API token reaches a log, a URL, an error report, a crash
dump, a tracing span, or a published tarball. Meta's business tokens are long-lived, so an
exposed one is durable access to a tenant's WhatsApp account.

**Library controls.**

- The token is held in a closure and written to exactly one place: an `Authorization`
  header. It is never a property on the client object.
- The token is never sent as an `access_token` query parameter, even though Meta accepts
  that form — URLs reach proxy logs, browser history, and error messages.
- Graph's `paging.next` URLs embed the token. The library never follows them; it lifts
  the cursor and rebuilds the request with a header. (Tested.)
- Errors define `toJSON` so that `JSON.stringify(error)` yields a fixed redacted set.
  Request headers, bodies, and full URLs are not in it.
- Logger and hook callbacks receive route shapes (`POST /{phone-number-id}/messages`),
  statuses, Meta codes, and `fbtrace_id` — never headers, bodies, or URLs.
- Provider error text passes through `sanitizeProviderMessage`, which elides runs of 40+
  token-ish characters and strips control characters.
- `WhatsAppConnectionMetadata` has no property capable of holding a secret, so
  serializing it cannot leak one.

**Application owns.** Storing tokens in a secret manager; not logging them at call sites;
rotating on suspicion. **Any token that has been pasted into a chat, a ticket, or a shared
document is exposed and must be rotated** — these packages cannot help with that.

---

## 2. Tenant client reuse and credential bleed

**Threat.** In a multitenant platform, tenant A's token is used for tenant B's request.
The usual cause is an ambient singleton or an environment read.

**Library controls.**

- No module-level client, no global mutable state, no connection pool keyed by anything.
- `createWhatsAppClient` returns a fresh object per call; credentials live in that
  closure.
- **No `process.env` reads anywhere in runtime code.** Credentials must be passed in.
  (The sibling `assure-infobip-sdk` offers a `fromEnv` helper; that is deliberately absent
  here, because an ambient credential is exactly the bleed vector.) Enforced by a test
  over the built bundles.
- `accessToken` accepts a function, so a secret store can be consulted per request and the
  token never sits on a long-lived object.
- Tested: two concurrent clients with different tokens, phone numbers, and pinned Graph
  versions each keep their own.

**Application owns.** Deriving the right tenant before constructing a client. Nothing in
the library knows what a tenant is.

---

## 3. Webhook forgery

**Threat.** A webhook endpoint is a public URL. Anyone can POST to it. A forged delivery
could fabricate a `delivered` status, an inbound "Not me" tap, or a template approval.

**Library controls.**

- `verifyWebhookSignature` implements Meta's documented HMAC-SHA-256 over the raw body
  with the app secret, via Web Crypto, with constant-time comparison.
- **There is no bypass.** No `skipVerification`, no `'none'` mode, no development
  shortcut. The only way to get a parsed payload through the documented path
  (`receiveWebhook`) is to pass the signature check first.
- The header parser rejects a missing, empty, duplicated, wrong-algorithm, wrong-length,
  or non-hex signature rather than trying to recover.
- Failure results carry a coarse reason and never the expected digest or the secret.

**Known limit.** HMAC proves the body came from someone holding the app secret. It does
not prove freshness — see replay below.

**Application owns.** Storing the app secret securely; returning a 403 on a failed check;
alerting on a sustained failure rate, which means either a misconfiguration or someone
probing.

---

## 4. Raw-body loss

**Threat.** The subtlest failure here. A JSON body-parser runs before the handler, the
original bytes are gone, and the handler re-serializes the object to verify. Signatures
then fail for legitimate traffic — and the fix that gets reached for under pressure is to
weaken or skip verification.

**Library controls.**

- Every verification entry point takes `Uint8Array | ArrayBuffer | string`. Passing a
  parsed object throws a `TypeError` with an explanation, rather than silently
  re-serializing.
- `readRawRequest` and `readRawStream` capture bytes correctly per runtime.
- The integration guide shows the correct configuration for Deno, Supabase Edge, Node,
  Express, and Fastify.
- Tested: a body parsed and re-serialized with different whitespace fails verification.

**Application owns.** Ordering middleware so nothing consumes the body first.

---

## 5. Replay and duplicates

**Threat.** Meta may redeliver. Batching is explicitly not guaranteed. A captured valid
delivery can be replayed by anyone who recorded it — the signature stays valid forever,
because it covers the body and nothing else. Processing a duplicate `delivered` twice is
usually harmless; processing a duplicate _inbound_ twice may not be.

**Library controls.**

- Every normalized event carries `deduplicationKeys`, strongest first, built from provider
  IDs plus the event kind — so `sent` and `delivered` for one message never collide, and
  an identical redelivery produces identical keys.
- `sha256Hex` gives a body digest for correlating a replay.
- The library does **not** deduplicate. It says so explicitly, because a library-level
  cache would be per-process and would give false confidence in a multi-instance
  deployment.

**Application owns.** The uniqueness constraint, scoped to its own tenancy model — only
the application knows that the same `wamid` under two WABAs is two different things.
A durable store, not an in-memory set. Meta's signature has no timestamp, so if replay
windows matter, the application must derive them from the payload's own timestamps.

---

## 6. Out-of-order and missing statuses

**Threat.** Treating status order as reliable. Meta documents that `delivered` may be
skipped entirely when a message is read immediately, and guarantees no ordering.

**Library controls.**

- Events are emitted in receipt order and never re-sorted, so the application can see
  that they arrived out of order. (Tested.)
- `occurredAt` is derived only when a usable provider timestamp exists. A missing or
  out-of-range timestamp yields `undefined` rather than a fabricated one — ordering
  decisions made on invented data are worse than deferred.
- `rawTimestamp` preserves the original value.

**Application owns.** A state machine that tolerates gaps and reordering, and that never
treats absence of `delivered` as failure.

---

## 7. Ambiguous send outcomes

**Threat.** A send is dispatched, then the connection drops. Did Meta process it? Retrying
may deliver a second verification code; not retrying may leave a user without one. The
endpoint has no idempotency key, so the library cannot make the choice safe.

**Library controls.**

- Mutations are **never** retried automatically, at any retry setting. (Tested for sends
  and template creation.)
- A mutation failing after dispatch raises `WhatsAppAmbiguousOutcomeError` — a distinct
  type, with `retryable === false` and a message that says to reconcile first.
- An abort _before_ dispatch is a plain cancellation, not ambiguous: the library checks
  the signal before calling `fetch`, so nothing left the process.
- `callbackData` maps to `biz_opaque_callback_data`, which Meta echoes on every status
  webhook — the join key reconciliation needs.

**Application owns.** A durable job that records the attempt before dispatch, waits for a
status webhook matching its `callbackData`, and escalates rather than blind-retrying.

---

## 8. Malicious or malformed payload shape

**Threat.** A payload crafted to crash the handler (a 500 makes Meta retry, amplifying
it), to pollute `Object.prototype`, or to exhaust the stack.

**Library controls.**

- Structural validation of the envelope before any indexing.
- Parsing rejects a payload containing `__proto__`, `constructor`, or `prototype` at any
  depth, and provider objects are never spread or merged.
- Depth-bounded traversal — no unbounded recursion.
- Unknown fields and variants become `whatsapp.unknown` rather than throwing.
- Failures are returned as discriminated results, not thrown, so a webhook route can
  answer 4xx instead of 500.
- `unknown` is used at every untrusted boundary; `any` appears nowhere.

**Application owns.** Answering 4xx on a rejected delivery, and not retrying it.

---

## 9. Oversized input

**Threat.** A very large body exhausts memory, or forces expensive crypto before any check.

**Library controls.**

- A 1 MiB default cap, checked **before** the HMAC is computed.
- Separate caps on entry count (1000, matching Meta's documented batch limit) and changes
  per entry.
- `readRawStream` enforces its cap while reading rather than after buffering.
- Paging requires an explicit `maxPages`; `collect` requires `maxItems`. Neither has a
  default, because every default is wrong for somebody and the wrong one loops.

**Application owns.** A body-size limit at the ingress as well — defence in depth.

---

## 10. Template variable confusion

**Threat.** Parameters that do not match the approved template. Meta often accepts these
and renders a blank, so a user receives a message with no verification code and no error
is raised anywhere.

**Library controls.**

- Positional/named mixing within a component is rejected before send.
- Button `index` values must be contiguous from `"0"`, because Meta matches on index and
  a gap silently targets the wrong button.
- Duplicate button indexes and duplicate interactive reply IDs are rejected.
- Errors never echo parameter values, which may be the code itself. (Tested.)

**Library does not.** Check parameter count against the approved template — that requires
knowing the template, which is a provider fact that changes without notice.

**Application owns.** Keeping template definitions and call sites in sync, and testing
rendered output against the real template before launch.

---

## 11. Locale mismatch

**Threat.** Sending in a language the recipient cannot read. When the mapping is _invalid_
the send fails loudly; when it is merely _wrong_ the send succeeds and the user cannot
read their code.

**Library controls.**

- `ProviderLocaleCode` and `AssureLocale` are distinct branded types.
- No inference, ever. `createLocaleMap` takes an explicit table and **fails closed** on an
  unmapped locale.
- Provider codes are validated when the map is built, so a typo surfaces at startup rather
  than on the first send in that language.
- A fallback exists but is off by default and documented as a decision with consequences.

**Application owns.** The mapping table, per customer, and confirming each template is
approved in each mapped language.

---

## 12. SSRF through base URL and media URLs

**Threat.** A caller-controlled base URL points at an internal service and receives the
Authorization header. Or a media `link` makes Meta fetch an internal URL.

**Library controls.**

- `baseUrl` must be `https:` by default, with no query, fragment, or embedded credentials.
- Plaintext requires `allowInsecureBaseUrl: true` — a separate, obviously-named flag that
  cannot be set by a config value that drifted.
- `overrideCallbackUri` must be `https:`.
- Identifiers are validated by their `as*` parsers before becoming path segments, so a
  traversal attempt is rejected before URL construction. (Tested.)

**Library does not.** Validate media `link` URLs. A media link makes _Meta_ fetch the URL
from Meta's network, so the SSRF target is Meta's infrastructure, not Assure's. The
library types it and says so here.

**Application owns.** Not deriving `baseUrl` from user input; allowlisting media hosts if
it ever sends media links.

---

## 13. Unsafe logging and PII

**Threat.** Logs become a record of who was verified, when, and at what number.

**Library controls.**

- No logging by default at all. A logger must be injected.
- `toSafeEventMetadata` omits destinations in both representations, profile names, message
  bodies, media, button labels, and `biz_opaque_callback_data`.
- Message IDs are truncated to 24 characters in safe metadata, because a `wamid` encodes
  the destination in its base64 body.
- `summarizeEvents` returns counts per kind and no identifiers at all.
- Identifier parse errors never echo the offending value. (Tested.)

**Application owns.** Not logging the full normalized event, which does carry `from` and
`recipientId` by design — routing needs them. Retention and access control on whatever it
does log.

---

## 14. Supply-chain compromise

**Threat.** A malicious dependency in a package that handles an app secret and runs in
Edge functions.

**Library controls.**

- **Zero runtime dependencies** outside the `@assure-ai` scope, enforced by a test.
- No `postinstall`, `preinstall`, or `install` script, enforced by a test and by the
  tarball check.
- No `eval`, no `new Function`, no dynamic import of a computed path — asserted against
  the built bundles.
- Tarball inspection fails on `.env`, sources, fixtures, coverage, key material, or an
  `.npmrc` in a published package.
- CI installs with `--ignore-scripts`.
- Publishing, when enabled, uses OIDC trusted publishing with provenance and no long-lived
  automation token.

**Application owns.** Lockfile review; `npm audit` in its own pipeline.

---

## 15. Spoofed mTLS assertions

**Threat.** An application concludes a request came through a trusted ingress because a
header says so. `X-Client-Cert`, `X-SSL-Client-Verify`, and `X-Forwarded-Client-Cert` are
ordinary headers. If the ingress does not strip them on inbound requests, anyone can set
them.

**Library controls.**

- No certificate or chain validation is attempted, and no function claims to do it.
- No header-reading default is provided — not even a "standard" one, because a convenience
  with a friendly name is how this mistake gets made.
- `assertTrustedIngress` requires an application-supplied verifier and fails closed when
  it returns nothing or throws.
- `TrustedIngressAssertion.basis` distinguishes `'cryptographic'` from
  `'network-isolation'`, so a reviewer can see which endpoints depend on the network.
- Tested: a request carrying four plausible spoofed certificate headers does not establish
  mTLS.

**Ingress owns.** Terminating TLS, validating the client certificate chain, and
**stripping these headers from inbound requests**. See [mtls-ingress.md](mtls-ingress.md).

---

## What the application always owns

No control in this library substitutes for any of these:

- Tenant identity, authorization, and isolation at the data layer.
- Durable jobs, reconciliation, and retry policy for sends.
- Consent, opt-out, and suppression.
- Budgets and rate governance.
- **Result semantics** — deciding what a delivery receipt means for a verification, which
  is: very little. The library refuses to express an opinion, by type.
- Secret storage and rotation.
- Ingress: TLS, mTLS, body limits, and header hygiene.
