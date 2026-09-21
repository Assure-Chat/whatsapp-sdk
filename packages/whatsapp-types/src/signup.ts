import type { MetaAppId, PhoneNumberId, WabaId } from './brands.js';

/**
 * Embedded Signup contracts — strictly the server-side half.
 *
 * The browser half of Embedded Signup (the Facebook JavaScript SDK, the popup,
 * the `message` event listener) is deliberately absent from these packages.
 * Shipping it would put an app secret one careless import away from a bundle.
 */

/**
 * What the browser hands your server after a customer completes the flow.
 *
 * Meta documents the code's time-to-live as 30 seconds, so this is strictly a
 * value in flight — never a value at rest. Nothing here persists it.
 */
export interface EmbeddedSignupResult {
  /** The single-use exchangeable code. A credential: never log it. */
  code: string;
  /** The WABA the customer onboarded, when the flow reported one. */
  wabaId?: WabaId;
  /** The business phone number, when the flow reported one. */
  phoneNumberId?: PhoneNumberId;
}

/**
 * Parameters for `GET /{version}/oauth/access_token`.
 *
 * Meta's own example sends these as query parameters, which is why this
 * package sends them in the query too — but it is also why the exchange is
 * routed through a request builder that refuses to log the URL.
 */
export interface ExchangeAuthorizationCodeRequest {
  appId: MetaAppId;
  /** The app secret. Never persisted, never logged, never in an error. */
  appSecret: string;
  /** The single-use code from {@link EmbeddedSignupResult}. */
  code: string;
  /**
   * Only for flows Meta documents as requiring it. The Embedded Signup
   * tech-provider exchange does not send one.
   */
  redirectUri?: string;
}

/**
 * The raw provider response.
 *
 * Kept separate from {@link AccessTokenMetadata} so that the only type
 * carrying a token value is one a caller has to reach into on purpose.
 */
export interface ExchangeAuthorizationCodeResponse {
  access_token: string;
  token_type?: string;
  /**
   * Business integration system user tokens are long-lived and Meta commonly
   * omits this. An absent value does not mean "expires now".
   */
  expires_in?: number;
}

/**
 * Everything about an exchanged token that is safe to log or store as metadata.
 *
 * There is no token property here, and none should be added. A caller that
 * needs the token takes it from {@link ExchangeAuthorizationCodeResult.accessToken}
 * and puts it straight into its own secret store.
 */
export interface AccessTokenMetadata {
  tokenType?: string;
  /** Absolute expiry, derived from `expires_in` and the caller's clock. */
  expiresAt?: Date;
  /** Number of characters in the token. Useful for smoke checks; not the token. */
  tokenLength: number;
}

/**
 * A successful exchange, with the secret and the metadata separated.
 *
 * `toJSON` is defined on the implementation in `@assure-ai/whatsapp-api` so
 * that serializing this object yields the metadata and never the token.
 */
export interface ExchangeAuthorizationCodeResult {
  /** The business token. Hand it to a secret store; do not log it. */
  accessToken: string;
  metadata: AccessTokenMetadata;
}

/**
 * Why an Embedded Signup exchange failed, without repeating anything secret.
 *
 * - `expired_or_replayed_code` — the 30-second window closed, or the code had
 *   already been exchanged. Indistinguishable at the provider, and treated as
 *   one reason rather than guessing.
 * - `invalid_configuration` — app ID/secret mismatch, or a redirect URI the
 *   app is not configured for.
 * - `insufficient_permissions` — the flow completed but the resulting token
 *   lacks the scopes the subsequent calls need.
 * - `provider_error` — anything else Meta reported.
 */
export type EmbeddedSignupFailureReason =
  | 'expired_or_replayed_code'
  | 'invalid_configuration'
  | 'insufficient_permissions'
  | 'provider_error';
