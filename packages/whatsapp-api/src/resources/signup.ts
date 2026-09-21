import type {
  AccessTokenMetadata,
  ExchangeAuthorizationCodeResponse,
  ExchangeAuthorizationCodeResult,
  MetaAppId,
} from '@assure-ai/whatsapp-types';
import { asMetaAppId } from '@assure-ai/whatsapp-types';
import {
  WhatsAppApiError,
  WhatsAppConfigError,
  createApiError,
  parseGraphError,
  type WhatsAppErrorClassification,
} from '../errors.js';
import type { FetchLike } from '../http.js';

/**
 * Server-side Embedded Signup code exchange.
 *
 * `GET /{version}/oauth/access_token?client_id&client_secret&code`, per Meta's
 * tech-provider onboarding documentation.
 *
 * This deliberately does **not** go through the shared `HttpClient`. That
 * client is built around a bearer token it holds for every request; this call
 * has no bearer token and instead carries the app secret and a single-use code
 * in the query string. Routing it separately means the transport's logging,
 * hooks, and error paths — all of which know URLs are safe to mention — never
 * see a URL that is not.
 *
 * What this will not do:
 *
 * - **Persist the token.** It is returned once and is the caller's to store.
 * - **Cache or refresh it.** Business integration system user tokens are
 *   long-lived and Meta documents no refresh for them; a library that invented
 *   one would be guessing at a lifecycle.
 * - **Touch the browser.** No Facebook JavaScript SDK, no popup, no
 *   browser-safe export. The app secret belongs only on a server.
 */

const TOKEN_PATH = 'oauth/access_token';
const OPERATION = 'GET /oauth/access_token';

export interface ExchangeCodeOptions {
  appId: MetaAppId;
  /** The app secret. Never logged, stored, or included in an error. */
  appSecret: string;
  /**
   * The single-use code from the Embedded Signup flow.
   *
   * Meta documents a 30-second time-to-live, so this should reach the server
   * and be exchanged immediately. It must never be written to a log or a
   * database on the way.
   */
  code: string;
  /** Only for flows Meta documents as requiring one. */
  redirectUri?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SignupResourceOptions {
  baseUrl: string;
  graphApiVersion: string;
  fetch: FetchLike;
  timeoutMs: number;
  now?: () => number;
}

export class SignupResource {
  readonly #baseUrl: string;
  readonly #graphApiVersion: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(options: SignupResourceOptions) {
    this.#baseUrl = options.baseUrl;
    this.#graphApiVersion = options.graphApiVersion;
    this.#fetch = options.fetch;
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Exchange an Embedded Signup code for a business token.
   *
   * ```ts
   * const { accessToken, metadata } = await client.signup.exchangeAuthorizationCode({
   *   appId: asMetaAppId(META_APP_ID),
   *   appSecret: APP_SECRET,
   *   code: codeFromBrowser,
   * });
   * await secrets.store(tenantId, accessToken); // never log it
   * logger.info('signup.exchanged', metadata);  // safe: carries no token
   * ```
   *
   * The result's `toJSON` yields only the metadata, so a result object that
   * reaches a structured logger by accident does not carry the token with it.
   */
  async exchangeAuthorizationCode(
    options: ExchangeCodeOptions,
  ): Promise<ExchangeAuthorizationCodeResult> {
    const appId = asMetaAppId(options.appId);
    if (typeof options.appSecret !== 'string' || options.appSecret === '') {
      throw new WhatsAppConfigError('`appSecret` is required to exchange an authorization code');
    }
    if (typeof options.code !== 'string' || options.code === '') {
      throw new WhatsAppConfigError('`code` is required to exchange an authorization code');
    }

    const url = new URL(`${this.#graphApiVersion}/${TOKEN_PATH}`, `${this.#baseUrl}/`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', options.appSecret);
    url.searchParams.set('code', options.code);
    if (options.redirectUri !== undefined) {
      url.searchParams.set('redirect_uri', options.redirectUri);
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await this.#fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (cause) {
      // The URL carries the app secret and the code. Neither the URL nor the
      // underlying error's message is propagated — only the fact of failure.
      throw new WhatsAppApiError(
        {
          status: 0,
          message: 'The authorization-code exchange failed before a response',
          method: 'GET',
          operation: OPERATION,
        },
        'connection',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    const payload = await readJson(response);

    if (!response.ok) {
      const parsed = parseGraphError(payload);
      throw createApiError({
        status: response.status,
        message: parsed.message,
        code: parsed.code,
        subcode: parsed.subcode,
        type: parsed.type,
        details: parsed.details,
        fbtraceId: parsed.fbtraceId,
        method: 'GET',
        operation: OPERATION,
      });
    }

    const token = payload as ExchangeAuthorizationCodeResponse | undefined;
    if (!token || typeof token.access_token !== 'string' || token.access_token === '') {
      throw new WhatsAppApiError(
        {
          status: response.status,
          message: 'The exchange returned no access_token',
          method: 'GET',
          operation: OPERATION,
        },
        'unknown',
      );
    }

    const metadata: AccessTokenMetadata = { tokenLength: token.access_token.length };
    if (typeof token.token_type === 'string') metadata.tokenType = token.token_type;
    if (typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)) {
      metadata.expiresAt = new Date(this.#now() + token.expires_in * 1000);
    }

    const result: ExchangeAuthorizationCodeResult = { accessToken: token.access_token, metadata };
    // Serializing the result must never yield the token. Non-enumerable so it
    // does not itself show up in the serialized output.
    Object.defineProperty(result, 'toJSON', {
      value: () => ({ metadata }),
      enumerable: false,
    });
    return result;
  }
}

/**
 * Classify an exchange failure into a reason safe to surface to an operator.
 *
 * `expired_or_replayed_code` covers both cases because Meta does not
 * distinguish them, and guessing which one happened would be inventing detail.
 */
export function classifyExchangeFailure(error: unknown): {
  reason:
    | 'expired_or_replayed_code'
    | 'invalid_configuration'
    | 'insufficient_permissions'
    | 'provider_error';
  classification: WhatsAppErrorClassification;
} {
  if (!(error instanceof WhatsAppApiError)) {
    return { reason: 'provider_error', classification: 'unknown' };
  }
  // Meta answers a spent or expired code with a 100 on this endpoint, and a
  // bad app ID or secret with a 101 / OAuthException.
  if (error.code === 100) {
    return { reason: 'expired_or_replayed_code', classification: error.classification };
  }
  if (error.code === 101 || error.status === 401) {
    return { reason: 'invalid_configuration', classification: error.classification };
  }
  if (error.status === 403 || error.code === 10 || error.code === 200) {
    return { reason: 'insufficient_permissions', classification: error.classification };
  }
  return { reason: 'provider_error', classification: error.classification };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body on this endpoint could be an error page echoing the
    // query string — which holds the app secret. It is discarded, not kept.
    return undefined;
  }
}
