/**
 * The mTLS boundary.
 *
 * Meta supports client-certificate authentication on webhook endpoints. That
 * check belongs at the TLS terminator — the load balancer, ingress controller,
 * or API gateway that completes the handshake — because it is the only
 * component that ever sees the peer certificate. By the time a request reaches
 * application code it is an HTTP message, and the certificate is gone.
 *
 * This package therefore does **not** validate certificates or chains, and
 * offers no function that claims to. What it offers is a type for recording a
 * decision the ingress already made, with a shape that makes the common
 * mistake hard to commit.
 *
 * **The common mistake** is trusting a header. `X-Client-Cert`,
 * `X-SSL-Client-Verify`, `X-Forwarded-Client-Cert` and friends are ordinary
 * request headers. If the ingress does not strip them from inbound requests,
 * anyone on the internet can set them, and an application that reads them is
 * authenticating the attacker. A header is evidence of mTLS only when the
 * ingress is known to overwrite it on every request — a property of a
 * deployment, not of a header name, and not something a library can check.
 *
 * So {@link assertTrustedIngress} takes a verifier supplied by the
 * application. There is no default, no header-name option, and no built-in
 * "standard" implementation, because every such convenience would be a
 * footgun with a friendly name. See the negative test in
 * `test/ingress.test.ts`.
 */

/** A trust decision the application's ingress integration produced. */
export interface TrustedIngressAssertion {
  /**
   * Which boundary made the decision — a load balancer name, a mesh identity.
   * Recorded for audit; it is a label, not a credential.
   */
  readonly boundary: string;
  /**
   * How the assertion was authenticated by the application.
   *
   * `'cryptographic'` means the application verified something unforgeable: a
   * signed envelope from the ingress, a mesh-issued identity token, a socket
   * peer certificate exposed by the runtime. `'network-isolation'` means the
   * endpoint is unreachable except through the trusted ingress — a real
   * control, but one that depends entirely on the network, so it is named
   * distinctly rather than folded in with the first.
   */
  readonly basis: 'cryptographic' | 'network-isolation';
  /** Subject of the verified client certificate, when the ingress reported one. */
  readonly clientSubject?: string;
  /** When the ingress made the decision. */
  readonly assertedAt?: Date;
}

/**
 * Verifies that a request really arrived through the trusted ingress.
 *
 * Supplied by the application. It must do something an attacker cannot
 * replicate — check a signature the ingress applies with a key the ingress
 * alone holds, read a peer certificate the runtime exposes out of band,
 * validate a short-lived mesh token. Returning `true` because a header is
 * present is not a verification and will be defeated.
 */
export type TrustedIngressVerifier = (request: {
  headers: unknown;
  rawBody: Uint8Array;
}) => Promise<TrustedIngressAssertion | undefined> | TrustedIngressAssertion | undefined;

export type TrustedIngressResult =
  | { ok: true; assertion: TrustedIngressAssertion }
  | { ok: false; reason: 'no_assertion' | 'verifier_threw'; message: string };

/**
 * Run the application's verifier and normalize its outcome.
 *
 * This adds no trust of its own. It exists so that the assertion, the failure
 * reason, and the audit fields have one shape across services — and so that a
 * verifier that throws fails closed instead of taking down the endpoint.
 */
export async function assertTrustedIngress(
  verifier: TrustedIngressVerifier,
  request: { headers: unknown; rawBody: Uint8Array },
): Promise<TrustedIngressResult> {
  let assertion: TrustedIngressAssertion | undefined;
  try {
    assertion = await verifier(request);
  } catch {
    // The verifier's error may carry certificate detail; it is not propagated.
    return {
      ok: false,
      reason: 'verifier_threw',
      message: 'The trusted-ingress verifier threw; treating the request as untrusted',
    };
  }
  if (assertion === undefined) {
    return {
      ok: false,
      reason: 'no_assertion',
      message: 'The trusted-ingress verifier did not produce an assertion',
    };
  }
  return { ok: true, assertion };
}
