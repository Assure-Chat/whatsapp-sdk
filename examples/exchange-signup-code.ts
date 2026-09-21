/**
 * Exchange an Embedded Signup authorization code, server-side.
 *
 * The browser half of Embedded Signup — the Facebook JavaScript SDK, the popup,
 * the `message` listener — is deliberately absent from these packages. Shipping
 * it would put an app secret one careless import away from a bundle.
 *
 * The browser sends your server a code. Everything below happens on the server.
 */

import {
  asMetaAppId,
  asPhoneNumberId,
  asWabaId,
  classifyExchangeFailure,
  createWhatsAppClient,
} from '@assure-ai/whatsapp-api';

declare const META_APP_ID: string;
declare const APP_SECRET: string;
declare const secrets: { store(tenantId: string, token: string): Promise<void> };
declare const log: {
  info(message: string, metadata: unknown): void;
  warn(message: string, metadata: unknown): void;
};

export async function completeOnboarding(input: {
  tenantId: string;
  /** From the browser. 30-second TTL — never log it, never store it. */
  code: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const client = createWhatsAppClient({
    // The exchange itself carries no bearer token; this satisfies the client's
    // constructor and is unused by `signup`.
    accessToken: 'unused-for-code-exchange',
    graphApiVersion: 'v24.0',
  });

  try {
    const { accessToken, metadata } = await client.signup.exchangeAuthorizationCode({
      appId: asMetaAppId(META_APP_ID),
      appSecret: APP_SECRET,
      code: input.code,
    });

    // Straight into the secret store. These packages persist nothing, cache
    // nothing, and refresh nothing.
    await secrets.store(input.tenantId, accessToken);

    // Safe: metadata carries a token type, an optional expiry, and a length —
    // never the token. The result object's own `toJSON` yields only this too,
    // so even logging the whole result would not leak it.
    log.info('whatsapp.signup.exchanged', metadata);

    return { ok: true };
  } catch (error) {
    // Coarse, operator-facing reasons that repeat nothing secret. Expired and
    // replayed are one reason because Meta does not distinguish them, and
    // guessing which happened would be inventing detail.
    const { reason } = classifyExchangeFailure(error);
    log.warn('whatsapp.signup.failed', { reason });
    return { ok: false, reason };
  }
}

/**
 * The rest of onboarding, once the token is stored.
 *
 * Each step is a mutation and so is never retried automatically. If one fails
 * after dispatch, reconcile with the matching read before re-attempting it:
 * a second `register` with a different PIN fails, and a repeat subscribe is
 * merely redundant.
 */
export async function activateConnection(input: {
  wabaId: string;
  phoneNumberId: string;
  /** Six-digit two-step verification PIN. A credential — never log it. */
  pin: string;
  /** The business token from the exchange above. */
  businessToken: string;
}): Promise<void> {
  const client = createWhatsAppClient({
    accessToken: input.businessToken,
    graphApiVersion: 'v24.0',
  });

  await client.accounts.registerPhoneNumber({
    phoneNumberId: asPhoneNumberId(input.phoneNumberId),
    pin: input.pin,
  });

  // Subscribe the app to this customer's WABA so events start arriving.
  await client.accounts.subscribeApp({ wabaId: asWabaId(input.wabaId) });

  // Provider facts about readiness. Whether this tenant may send in production
  // is an Assure decision made elsewhere, from this plus entitlement and consent.
  const number = await client.accounts.getPhoneNumber({
    phoneNumberId: asPhoneNumberId(input.phoneNumberId),
  });
  log.info('whatsapp.connection.state', {
    status: number.status,
    qualityRating: number.quality_rating,
    codeVerificationStatus: number.code_verification_status,
  });
}
