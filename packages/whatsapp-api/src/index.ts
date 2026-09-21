/**
 * `@assure-ai/whatsapp-api` — a narrow, stateless client for Meta's WhatsApp
 * Business Platform Cloud API.
 *
 * Built for a multitenant verification platform, which shapes almost every
 * decision in it:
 *
 * - **Per-instance credentials.** No singleton, no module state, no
 *   `process.env` reads. Two clients for two tenants cannot bleed.
 * - **Caller-pinned Graph version.** Required, with no default and no
 *   `latest`. Meta changes payload shapes between versions.
 * - **No automatic retry of mutations.** The send endpoint has no idempotency
 *   key, so a replayed send can deliver a verification code twice. A dispatch
 *   that fails mid-flight raises {@link WhatsAppAmbiguousOutcomeError} so the
 *   caller's durable job can reconcile instead of guessing.
 * - **Redacted by construction.** Errors, logs, and hooks receive route
 *   shapes, statuses, and Meta's codes. They never receive tokens, headers,
 *   destinations, message bodies, or full URLs.
 *
 * Web-standard throughout — `fetch`, `URL`, `AbortSignal`, `TextEncoder` — so
 * it runs on Node.js 20+, Deno, and Supabase Edge unchanged.
 *
 * This is an independent Assure package. It is not published, endorsed, or
 * reviewed by Meta, and it is not the archived official `whatsapp` npm SDK
 * (see `docs/migration-from-archived-sdk.md`). Meta's documentation and
 * policies remain authoritative.
 */

export {
  DEFAULT_GRAPH_BASE_URL,
  createWhatsAppClient,
  type CreateWhatsAppClientOptions,
  type WhatsAppClient,
} from './client.js';

export {
  classifyError,
  createApiError,
  isAmbiguousOutcome,
  isWhatsAppApiError,
  parseGraphError,
  parseRetryAfterMs,
  sanitizeProviderMessage,
  WhatsAppAmbiguousOutcomeError,
  WhatsAppApiError,
  WhatsAppAuthenticationError,
  WhatsAppAuthorizationError,
  WhatsAppConfigError,
  WhatsAppConflictError,
  WhatsAppConnectionError,
  WhatsAppError,
  WhatsAppLocaleError,
  WhatsAppNotFoundError,
  WhatsAppPolicyError,
  WhatsAppRateLimitError,
  WhatsAppRecipientError,
  WhatsAppServerError,
  WhatsAppTemplateError,
  WhatsAppTimeoutError,
  WhatsAppValidationError,
  type ParsedGraphError,
  type WhatsAppApiErrorInit,
  type WhatsAppErrorClassification,
} from './errors.js';

export type { FetchLike, ReadRetryOptions, RequestHook, ResponseHook, SafeLogger } from './http.js';

export {
  collect,
  iteratePages,
  toPageResult,
  type IterateOptions,
  type PageFetcher,
  type PageResult,
} from './paging.js';

export { createLocaleMap, type CreateLocaleMapOptions, type LocaleMap } from './locale.js';

export {
  validateInteractiveContent,
  validateOutboundMessage,
  validateSendResponse,
  validateTemplateContent,
} from './validate.js';

export { MessagesResource, type SendOptions } from './resources/messages.js';
export {
  DEFAULT_TEMPLATE_FIELDS,
  TemplatesResource,
  type ListTemplatesOptions,
} from './resources/templates.js';
export { AccountsResource } from './resources/accounts.js';
export {
  SignupResource,
  classifyExchangeFailure,
  type ExchangeCodeOptions,
} from './resources/signup.js';

// Re-exported so the common path needs one dependency.
export {
  asE164PhoneNumber,
  asGraphApiVersion,
  asMetaAppId,
  asPhoneNumberId,
  asTemplateId,
  asWabaId,
  asWhatsAppMessageId,
  asWhatsAppRecipient,
  toWhatsAppRecipient,
  type E164PhoneNumber,
  type GraphApiVersion,
  type MessageTemplate,
  type PhoneNumberId,
  type ProviderLocaleCode,
  type SendMessageResponse,
  type TemplateMessageContent,
  type WabaId,
  type WhatsAppConnectionMetadata,
  type WhatsAppMessageId,
} from '@assure-ai/whatsapp-types';
