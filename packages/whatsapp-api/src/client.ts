import type {
  GraphApiVersion,
  PhoneNumberId,
  WabaId,
  WhatsAppConnectionMetadata,
} from '@assure-ai/whatsapp-types';
import { asGraphApiVersion, asPhoneNumberId, asWabaId } from '@assure-ai/whatsapp-types';
import { WhatsAppConfigError } from './errors.js';
import {
  HttpClient,
  normalizeBaseUrl,
  type FetchLike,
  type ReadRetryOptions,
  type RequestHook,
  type ResponseHook,
  type SafeLogger,
} from './http.js';
import { AccountsResource } from './resources/accounts.js';
import { MessagesResource } from './resources/messages.js';
import { SignupResource } from './resources/signup.js';
import { TemplatesResource } from './resources/templates.js';

/** Meta's production Graph host. */
export const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface CreateWhatsAppClientOptions {
  /**
   * A Cloud API access token, scoped to one tenant.
   *
   * Either the value, or a function returning it. A function is the better
   * choice in a multitenant service: it lets a secret store be consulted per
   * request without the token ever sitting on a long-lived object. Either way
   * the token is held in a closure and written to exactly one header.
   *
   * There is no environment fallback. Reading `process.env` inside a client is
   * how one tenant's token ends up on another tenant's request.
   */
  accessToken: string | (() => string);

  /**
   * The Graph API version to pin to, e.g. `'v24.0'`.
   *
   * Required, with no default and no `latest`. Meta retires versions on a
   * schedule and changes payload shapes between them — status webhooks stopped
   * carrying a `conversation` object at v24.0 — so a library that tracked the
   * newest version would change a caller's wire contract during an unrelated
   * dependency bump. Pinning is the caller's decision and belongs in their
   * config, next to a calendar reminder. See `docs/maintainers.md`.
   */
  graphApiVersion: GraphApiVersion | string;

  /** Graph host. Defaults to Meta's production host. */
  baseUrl?: string;

  /**
   * Permit an `http://` base URL.
   *
   * **Only for a local mock.** Turning this on sends the access token over
   * plaintext HTTP. It is a separate, obviously-named flag rather than an
   * inference from the URL so it cannot be enabled by accident or by a
   * configuration value that drifted.
   */
  allowInsecureBaseUrl?: boolean;

  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;

  /**
   * Retry policy for safe reads. Off by default.
   *
   * Never applies to a send, a template submission, a registration, or any
   * other mutation, whatever it is set to.
   */
  readRetry?: ReadRetryOptions;

  /** Injected `fetch`, for proxies, mocks, and tests. */
  fetch?: FetchLike;

  /** Receives safe metadata only — never bodies, headers, or tokens. */
  logger?: SafeLogger;

  /** Called before each attempt. Receives no headers and no body. */
  onRequest?: RequestHook;

  /** Called after each response. Receives no body. */
  onResponse?: ResponseHook;

  /** Value sent as `user-agent`. */
  userAgent?: string;

  /** Injectable clock, so tests need no real timers. */
  now?: () => number;

  /** Injectable sleep, so retry tests need no real timers. */
  sleep?: (ms: number) => Promise<void>;

  /** Recorded in `metadata` for observability. Scopes nothing by itself. */
  wabaId?: WabaId;
  /** Recorded in `metadata` for observability. Scopes nothing by itself. */
  phoneNumberId?: PhoneNumberId;
}

/**
 * A stateless, per-tenant WhatsApp Cloud API client.
 *
 * Every instance holds its own token and its own configuration. There is no
 * module-level singleton and no shared mutable state, so two clients built
 * with two tenants' credentials cannot bleed into each other — which is the
 * property a multitenant verification platform most needs and the one a
 * convenience singleton would quietly destroy.
 */
export interface WhatsAppClient {
  /** Sending messages. Nothing here is ever retried automatically. */
  readonly messages: MessagesResource;
  /** Message-template management and status discovery. */
  readonly templates: TemplatesResource;
  /** WABA, phone-number, and webhook-subscription discovery. */
  readonly accounts: AccountsResource;
  /** Server-side Embedded Signup code exchange. */
  readonly signup: SignupResource;
  /**
   * Connection metadata that is safe to log and serialize.
   *
   * Carries no token, by construction — {@link WhatsAppConnectionMetadata} has
   * no property that could hold one.
   */
  readonly metadata: WhatsAppConnectionMetadata;
}

/**
 * Build a client.
 *
 * ```ts
 * const client = createWhatsAppClient({
 *   accessToken: await secrets.get(tenantId, 'WA_ACCESS_TOKEN'),
 *   graphApiVersion: 'v24.0',
 * });
 * ```
 */
export function createWhatsAppClient(options: CreateWhatsAppClientOptions): WhatsAppClient {
  const graphApiVersion = asGraphApiVersion(options.graphApiVersion);
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? DEFAULT_GRAPH_BASE_URL,
    options.allowInsecureBaseUrl === true,
  );

  const getAccessToken = buildTokenGetter(options.accessToken);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WhatsAppConfigError('`timeoutMs` must be a positive number');
  }

  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const http = new HttpClient({
    baseUrl,
    graphApiVersion,
    getAccessToken,
    fetch: fetchImpl,
    timeoutMs,
    readRetry: options.readRetry,
    userAgent: options.userAgent,
    logger: options.logger,
    onRequest: options.onRequest,
    onResponse: options.onResponse,
    ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
  });

  const metadata: WhatsAppConnectionMetadata = { graphApiVersion, baseUrl };
  if (options.wabaId !== undefined) metadata.wabaId = asWabaId(options.wabaId);
  if (options.phoneNumberId !== undefined) {
    metadata.phoneNumberId = asPhoneNumberId(options.phoneNumberId);
  }

  return {
    messages: new MessagesResource(http),
    templates: new TemplatesResource(http),
    accounts: new AccountsResource(http),
    signup: new SignupResource({
      baseUrl,
      graphApiVersion,
      fetch: fetchImpl,
      timeoutMs,
      ...(options.now !== undefined ? { now: options.now } : {}),
    }),
    // Frozen so a caller cannot mutate one client's recorded identity and be
    // misled by a later log line.
    metadata: Object.freeze(metadata),
  };
}

/** Wrap a token or token-provider, validating it produces something usable. */
function buildTokenGetter(accessToken: string | (() => string)): () => string {
  if (typeof accessToken === 'function') {
    return () => {
      const token = accessToken();
      if (typeof token !== 'string' || token === '') {
        throw new WhatsAppConfigError('The accessToken provider returned an empty token');
      }
      return token;
    };
  }
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new WhatsAppConfigError('`accessToken` is required and must be a non-empty string');
  }
  return () => accessToken;
}
