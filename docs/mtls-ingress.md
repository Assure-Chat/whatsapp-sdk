# mTLS is an ingress concern

Meta supports client-certificate (mutual TLS) authentication on webhook endpoints. This
document explains why none of it happens in `@assure-ai/whatsapp-webhooks`, and what to
do instead.

## Why not in the library

A client certificate is presented during the TLS handshake. The component that completes
that handshake — your load balancer, ingress controller, or API gateway — is the only one
that ever sees it. By the time a request reaches application code it is an HTTP message:
a method, a URL, headers, and a body. The certificate is gone.

So a library at this layer has exactly two options. It can validate nothing and say so, or
it can read a header and pretend. The second is worse than doing nothing, because it
produces a function called something like `verifyClientCertificate` that returns `true`
for an attacker.

## Why a header is not a certificate

`X-Client-Cert`, `X-SSL-Client-Verify`, `X-Forwarded-Client-Cert`, and every variant are
ordinary request headers. A webhook endpoint is a public URL. Anyone can send:

```
POST /webhooks/whatsapp HTTP/1.1
X-SSL-Client-Verify: SUCCESS
X-Forwarded-Client-Cert: By=spoof;Subject="CN=totally-legit"
```

Those headers mean something **only** when the ingress overwrites them on every inbound
request, so a client-supplied value can never survive. That is a property of a specific
deployment's configuration, not of a header name — and not something a library can check.

`test/ingress.test.ts` contains a test that sends exactly the headers above and asserts
they establish nothing.

## What to configure at the ingress

1. Terminate TLS and require a client certificate on the webhook route.
2. Validate the chain against the CA you expect.
3. **Strip** every client-certificate header from inbound requests before adding your own.
   This is the step that is most often missed and it is the one that matters.
4. Reject at the ingress. The application should never receive an unauthenticated request
   at all.
5. Enforce a body-size limit there too.

## Signature verification is still required

mTLS at the ingress and HMAC in the application are not alternatives. Run both:

- mTLS authenticates the _connection_, at the network edge, and stops unauthenticated
  traffic before it costs anything.
- `X-Hub-Signature-256` authenticates the _payload_, in the application, and survives
  anything that happens between the ingress and the handler — a misrouted request, a
  compromised sidecar, a replayed body from a log.

If you have to pick one, pick the signature: it is what Meta documents, it needs no
coordination with a platform team, and it keeps working when the ingress is reconfigured
by someone who did not know about it.

## Recording an ingress decision

If you want the trust decision visible in application code, `assertTrustedIngress` gives
it a consistent shape. It adds no trust of its own — it runs a verifier you supply and
normalizes the outcome:

```ts
import { assertTrustedIngress } from '@assure-ai/whatsapp-webhooks';

const result = await assertTrustedIngress(
  async ({ headers }) => {
    // Verify something unforgeable. A signature the ingress applies with a key
    // only it holds; a mesh-issued identity token; a peer certificate the
    // runtime exposes out of band. Not the presence of a header.
    const envelope = headers instanceof Headers ? headers.get('x-ingress-assertion') : null;
    if (envelope === null) return undefined;
    const claims = await verifyIngressEnvelope(envelope); // yours, cryptographic
    if (claims === undefined) return undefined;
    return {
      boundary: claims.boundary,
      basis: 'cryptographic',
      clientSubject: claims.subject,
      assertedAt: new Date(claims.issuedAt),
    };
  },
  { headers: request.headers, rawBody },
);
```

Use `basis: 'network-isolation'` when the real control is that the endpoint is unreachable
except through the trusted ingress. That is a legitimate control; it is named separately
so a reviewer can tell at a glance which endpoints depend on the network rather than on
cryptography.
