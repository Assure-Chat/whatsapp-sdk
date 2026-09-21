import { describe, expect, it } from 'vitest';
import { assertTrustedIngress, type TrustedIngressVerifier } from '../src/index.js';
import { encode, inboundTextPayload } from './fixtures/payloads.js';

const rawBody = encode(inboundTextPayload);

describe('trusted ingress', () => {
  it('returns the assertion a cryptographic verifier produced', async () => {
    const verifier: TrustedIngressVerifier = () => ({
      boundary: 'edge-lb-1',
      basis: 'cryptographic',
      clientSubject: 'CN=meta-webhook-client',
    });
    const result = await assertTrustedIngress(verifier, { headers: new Headers(), rawBody });
    expect(result).toMatchObject({
      ok: true,
      assertion: { boundary: 'edge-lb-1', basis: 'cryptographic' },
    });
  });

  it('fails closed when the verifier produces nothing', async () => {
    const result = await assertTrustedIngress(() => undefined, {
      headers: new Headers(),
      rawBody,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no_assertion' });
  });

  it('fails closed when the verifier throws, and does not leak its error', async () => {
    const verifier: TrustedIngressVerifier = () => {
      throw new Error('peer certificate CN=secret-internal-host chain failure');
    };
    const result = await assertTrustedIngress(verifier, { headers: new Headers(), rawBody });
    expect(result).toMatchObject({ ok: false, reason: 'verifier_threw' });
    expect(JSON.stringify(result)).not.toContain('secret-internal-host');
  });

  it('spoofed client-certificate headers do not establish mTLS', async () => {
    // The whole point of the design: an attacker can set any header they like
    // on a request to a public URL. There is no API in this package that would
    // accept these as proof, and a verifier that merely looks for them is a
    // verifier the application wrote wrongly — this test documents that the
    // library never does it on the application's behalf.
    const spoofed = new Headers({
      'x-client-cert': 'MIIDdzCCAl+gAwIBAgIEexampleSPOOFED',
      'x-ssl-client-verify': 'SUCCESS',
      'x-forwarded-client-cert': 'By=spoof;Hash=deadbeef;Subject="CN=totally-legit"',
      'x-client-verified': 'true',
    });

    // A verifier that trusts nothing it cannot cryptographically check sees
    // these headers and still declines.
    const soundVerifier: TrustedIngressVerifier = () => undefined;
    const result = await assertTrustedIngress(soundVerifier, { headers: spoofed, rawBody });
    expect(result).toMatchObject({ ok: false, reason: 'no_assertion' });

    // And the package exposes no header-reading default that would have said
    // otherwise: there is exactly one entry point and it requires a verifier.
    expect(assertTrustedIngress.length).toBe(2);
  });

  it('records network isolation as a distinct, weaker basis', async () => {
    const verifier: TrustedIngressVerifier = () => ({
      boundary: 'vpc-private-alb',
      basis: 'network-isolation',
    });
    const result = await assertTrustedIngress(verifier, { headers: new Headers(), rawBody });
    expect(result).toMatchObject({ ok: true, assertion: { basis: 'network-isolation' } });
    // Naming it separately is the point: a reviewer can tell at a glance which
    // endpoints depend on the network rather than on cryptography.
    if (result.ok) expect(result.assertion.basis).not.toBe('cryptographic');
  });

  it('awaits an async verifier', async () => {
    const verifier: TrustedIngressVerifier = async () => {
      await Promise.resolve();
      return { boundary: 'mesh', basis: 'cryptographic' as const };
    };
    const result = await assertTrustedIngress(verifier, { headers: new Headers(), rawBody });
    expect(result.ok).toBe(true);
  });
});
