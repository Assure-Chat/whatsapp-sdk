import type { GraphErrorDetail } from '@assure-ai/whatsapp-types';

/**
 * The error hierarchy.
 *
 * Two properties hold across every class here:
 *
 * - **Nothing secret is stored.** No access token, no app secret, no
 *   authorization code, no destination, no message body, no request headers,
 *   no full provider response. What is kept is a status, Meta's numeric codes,
 *   a sanitized message, and a trace ID — enough to diagnose, not enough to
 *   leak. `toJSON` is defined so that `JSON.stringify(error)` cannot widen
 *   that set by accident.
 * - **`retryable` is an assessment, not an instruction.** It answers "could an
 *   identical request plausibly succeed", which is a different question from
 *   "should this send be repeated". For a mutation the answer to the second
 *   question lives in the caller's durable job, with its own record of what
 *   was already attempted. See {@link WhatsAppAmbiguousOutcomeError}.
 */

/** How a failure should be reasoned about, independent of HTTP status. */
export type WhatsAppErrorClassification =
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'template'
  | 'locale'
  | 'recipient'
  | 'policy'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'retryable_provider_failure'
  | 'ambiguous_outcome'
  | 'timeout'
  | 'connection'
  | 'unknown';

/** Base class for every error these packages throw. */
export class WhatsAppError extends Error {
  /** How to reason about this failure. */
  readonly classification: WhatsAppErrorClassification;

  constructor(
    message: string,
    classification: WhatsAppErrorClassification,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
    this.classification = classification;
  }

  /**
   * Whether an identical request could plausibly succeed.
   *
   * Conservative by default. Subclasses narrow it.
   */
  get retryable(): boolean {
    return false;
  }

  /** A redacted, serializable view. Used by `JSON.stringify`. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      classification: this.classification,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

/** The client was constructed or called with unusable arguments. */
export class WhatsAppConfigError extends WhatsAppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'configuration', options);
  }
}

/** A request exceeded its timeout, or the caller aborted it. */
export class WhatsAppTimeoutError extends WhatsAppError {
  readonly timeoutMs: number;
  /** True when the caller's own signal aborted, rather than the timeout. */
  readonly abortedByCaller: boolean;

  constructor(
    message: string,
    init: { timeoutMs: number; abortedByCaller: boolean },
    options?: { cause?: unknown },
  ) {
    super(message, 'timeout', options);
    this.timeoutMs = init.timeoutMs;
    this.abortedByCaller = init.abortedByCaller;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), timeoutMs: this.timeoutMs, abortedByCaller: this.abortedByCaller };
  }
}

/** The request never produced an HTTP response — DNS, TLS, socket. */
export class WhatsAppConnectionError extends WhatsAppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'connection', options);
  }

  override get retryable(): boolean {
    return true;
  }
}

/**
 * A mutation whose outcome is unknown.
 *
 * Thrown when a send, a template submission, or a registration was dispatched
 * and then the connection failed or timed out before a response arrived. The
 * provider may have processed it completely; the response may simply be lost.
 *
 * This is emphatically **not** retryable. Meta's `/messages` endpoint has no
 * idempotency key, so a blind replay of an ambiguous send can deliver the same
 * verification code twice — which looks, to a user, exactly like an account
 * compromise. The correct response is reconciliation: check for a status
 * webhook matching the `biz_opaque_callback_data` the send carried, and only
 * re-send if none arrives within the caller's window.
 */
export class WhatsAppAmbiguousOutcomeError extends WhatsAppError {
  /** `POST`, `DELETE`, … — the method whose effect is unknown. */
  readonly method: string;
  /** The route shape, with no query string and no caller identifiers. */
  readonly operation: string;

  constructor(
    init: { method: string; operation: string; detail: string },
    options?: { cause?: unknown },
  ) {
    super(
      `${init.method} ${init.operation} was dispatched but its outcome is unknown (${init.detail}). ` +
        'Do not retry blindly — reconcile against status webhooks first.',
      'ambiguous_outcome',
      options,
    );
    this.method = init.method;
    this.operation = init.operation;
  }

  override get retryable(): boolean {
    return false;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), method: this.method, operation: this.operation };
  }
}

export interface WhatsAppApiErrorInit {
  status: number;
  /** Sanitized provider message. */
  message: string;
  code?: number | undefined;
  subcode?: number | undefined;
  type?: string | undefined;
  details?: string | undefined;
  userTitle?: string | undefined;
  userMessage?: string | undefined;
  fbtraceId?: string | undefined;
  isTransient?: boolean | undefined;
  retryAfterMs?: number | undefined;
  method: string;
  /** Route shape only — never the full URL, which can carry identifiers. */
  operation: string;
}

/** A non-2xx response from the Graph API. */
export class WhatsAppApiError extends WhatsAppError {
  readonly status: number;
  /** Meta's numeric error code — the field to branch on. */
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  /** Meta's error `type`, e.g. `OAuthException`. */
  readonly type: string | undefined;
  /** `error_data.details`, sanitized. */
  readonly details: string | undefined;
  /** Safe-to-display title Meta intends for end users. */
  readonly userTitle: string | undefined;
  /** Safe-to-display message Meta intends for end users. */
  readonly userMessage: string | undefined;
  /** Trace identifier to quote in a Meta support ticket. */
  readonly fbtraceId: string | undefined;
  readonly isTransient: boolean | undefined;
  /** From `Retry-After`, when the response carried one. */
  readonly retryAfterMs: number | undefined;
  readonly method: string;
  readonly operation: string;

  constructor(init: WhatsAppApiErrorInit, classification: WhatsAppErrorClassification) {
    super(
      `${init.method} ${init.operation} failed with ${init.status}: ${init.message}`,
      classification,
    );
    this.status = init.status;
    this.code = init.code;
    this.subcode = init.subcode;
    this.type = init.type;
    this.details = init.details;
    this.userTitle = init.userTitle;
    this.userMessage = init.userMessage;
    this.fbtraceId = init.fbtraceId;
    this.isTransient = init.isTransient;
    this.retryAfterMs = init.retryAfterMs;
    this.method = init.method;
    this.operation = init.operation;
  }

  override get retryable(): boolean {
    // 429 and 5xx could succeed on repeat. Whether they *should* be repeated
    // depends on whether the request was a mutation, which the transport
    // decides — this only says the server did not refuse on the merits.
    return this.status === 429 || this.status >= 500;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      status: this.status,
      code: this.code,
      subcode: this.subcode,
      type: this.type,
      details: this.details,
      fbtraceId: this.fbtraceId,
      retryAfterMs: this.retryAfterMs,
      method: this.method,
      operation: this.operation,
    };
  }
}

/** 401, or a token-related code — the credential is unusable. */
export class WhatsAppAuthenticationError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'authentication');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** 403 — authenticated, but not permitted on this resource. */
export class WhatsAppAuthorizationError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'authorization');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** 429, or one of Meta's throughput codes. */
export class WhatsAppRateLimitError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'rate_limit');
  }
  override get retryable(): boolean {
    return true;
  }
}

/** A template does not exist, is unapproved, paused, or disabled. */
export class WhatsAppTemplateError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'template');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** The template exists but not in the requested language. */
export class WhatsAppLocaleError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'locale');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** The destination is not reachable on WhatsApp, or was rejected. */
export class WhatsAppRecipientError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'recipient');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** Blocked by Meta's integrity or business policy. Escalate, do not retry. */
export class WhatsAppPolicyError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'policy');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** 400/422 — the request was malformed or semantically rejected. */
export class WhatsAppValidationError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'validation');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** 404 — no such node, or the token cannot see it. */
export class WhatsAppNotFoundError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'not_found');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** 409 — the resource is in a state that forbids this change. */
export class WhatsAppConflictError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'conflict');
  }
  override get retryable(): boolean {
    return false;
  }
}

/** 5xx — the platform or a downstream failed. */
export class WhatsAppServerError extends WhatsAppApiError {
  constructor(init: WhatsAppApiErrorInit) {
    super(init, 'retryable_provider_failure');
  }
  override get retryable(): boolean {
    return true;
  }
}

/**
 * Meta error codes whose meaning is more specific than their HTTP status.
 *
 * Only codes confirmed in Meta's published Cloud API error-code reference are
 * listed. A code that is not here falls back to status-based classification,
 * which is correct if coarse — better than guessing at a code's meaning.
 */
const CODE_CLASSIFICATION = new Map<number, WhatsAppErrorClassification>([
  // Authentication and permissions.
  [0, 'authentication'], // Unable to authenticate the app user.
  [190, 'authentication'], // Access token expired or invalidated.
  [200, 'authorization'], // Permission missing.
  [10, 'authorization'], // Permission not granted or removed.
  [3, 'authorization'], // Capability or permissions issue.
  // Rate limiting and throughput.
  [4, 'rate_limit'], // App API call rate limit.
  [80007, 'rate_limit'], // WABA rate limit reached.
  [130429, 'rate_limit'], // Cloud API throughput reached.
  [131056, 'rate_limit'], // Too many messages to the same recipient.
  [131048, 'rate_limit'], // Sender messaging restrictions.
  // Integrity and policy.
  [368, 'policy'], // Temporarily blocked for policy violations.
  [130497, 'policy'], // Restricted from certain countries.
  [131031, 'policy'], // Account locked after a policy violation.
  // Templates.
  [132000, 'template'], // Parameter count mismatch.
  [132001, 'template'], // Template does not exist or is unapproved.
  [132005, 'template'], // Translated text too long.
  [132007, 'template'], // Format character policy violation.
  [132012, 'template'], // Parameter format mismatch.
  [132015, 'template'], // Template paused for low quality.
  [132016, 'template'], // Template permanently disabled.
  [2388019, 'template'], // Template limit exceeded.
  // Recipient reachability.
  [131026, 'recipient'], // Message undeliverable.
  [131051, 'recipient'], // Unsupported message type for the recipient.
]);

/**
 * Classify a failure from its status and Meta's error code.
 *
 * Code wins over status where a code is known, because Graph answers 400 for
 * everything from a malformed body to a disabled template, and those need very
 * different handling.
 */
export function classifyError(
  status: number,
  code: number | undefined,
): WhatsAppErrorClassification {
  if (code !== undefined) {
    const byCode = CODE_CLASSIFICATION.get(code);
    if (byCode !== undefined) return byCode;
  }
  switch (status) {
    case 400:
    case 422:
      return 'validation';
    case 401:
      return 'authentication';
    case 403:
      return 'authorization';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limit';
    default:
      return status >= 500 ? 'retryable_provider_failure' : 'unknown';
  }
}

/** Build the most specific error class for a classified failure. */
export function createApiError(init: WhatsAppApiErrorInit): WhatsAppApiError {
  switch (classifyError(init.status, init.code)) {
    case 'authentication':
      return new WhatsAppAuthenticationError(init);
    case 'authorization':
      return new WhatsAppAuthorizationError(init);
    case 'rate_limit':
      return new WhatsAppRateLimitError(init);
    case 'template':
      return new WhatsAppTemplateError(init);
    case 'locale':
      return new WhatsAppLocaleError(init);
    case 'recipient':
      return new WhatsAppRecipientError(init);
    case 'policy':
      return new WhatsAppPolicyError(init);
    case 'not_found':
      return new WhatsAppNotFoundError(init);
    case 'conflict':
      return new WhatsAppConflictError(init);
    case 'retryable_provider_failure':
      return new WhatsAppServerError(init);
    case 'validation':
      return new WhatsAppValidationError(init);
    default:
      return new WhatsAppApiError(init, 'unknown');
  }
}

/** Type guard for {@link WhatsAppApiError}. */
export function isWhatsAppApiError(value: unknown): value is WhatsAppApiError {
  return value instanceof WhatsAppApiError;
}

/** Type guard for {@link WhatsAppAmbiguousOutcomeError}. */
export function isAmbiguousOutcome(value: unknown): value is WhatsAppAmbiguousOutcomeError {
  return value instanceof WhatsAppAmbiguousOutcomeError;
}

const MAX_PROVIDER_MESSAGE_LENGTH = 300;

/** Matches ASCII control characters, which have no place in a log line. */
const CONTROL_CHARACTERS = /[\p{Cc}]/gu;

/** A long unbroken token-ish run — the shape of a leaked credential. */
const TOKEN_SHAPED = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Strip anything token-shaped or control-flavoured out of provider text.
 *
 * Meta's messages are usually benign, but they are attacker-influenceable in
 * places — a rejected template echoes its own content back — and they end up
 * in logs. Long base64-ish runs have the shape of a token, so they are elided;
 * control characters are removed so a message cannot forge a log line.
 */
export function sanitizeProviderMessage(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'No provider message';
  return value
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(TOKEN_SHAPED, '[redacted]')
    .slice(0, MAX_PROVIDER_MESSAGE_LENGTH)
    .trim();
}

/** What {@link parseGraphError} could safely pull out of a failure body. */
export interface ParsedGraphError {
  message: string;
  code?: number;
  subcode?: number;
  type?: string;
  details?: string;
  userTitle?: string;
  userMessage?: string;
  fbtraceId?: string;
  isTransient?: boolean;
}

/** Pull the safe fields out of a Graph error body. */
export function parseGraphError(body: unknown): ParsedGraphError {
  if (!body || typeof body !== 'object') {
    return { message: 'No provider message' };
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return { message: 'No provider message' };
  }
  const detail = error as GraphErrorDetail;
  const result: ParsedGraphError = { message: sanitizeProviderMessage(detail.message) };
  if (typeof detail.code === 'number') result.code = detail.code;
  if (typeof detail.error_subcode === 'number') result.subcode = detail.error_subcode;
  if (typeof detail.type === 'string') result.type = sanitizeProviderMessage(detail.type);
  if (typeof detail.error_data?.details === 'string') {
    result.details = sanitizeProviderMessage(detail.error_data.details);
  }
  if (typeof detail.error_user_title === 'string') {
    result.userTitle = sanitizeProviderMessage(detail.error_user_title);
  }
  if (typeof detail.error_user_msg === 'string') {
    result.userMessage = sanitizeProviderMessage(detail.error_user_msg);
  }
  if (typeof detail.fbtrace_id === 'string') result.fbtraceId = detail.fbtrace_id.slice(0, 64);
  if (typeof detail.is_transient === 'boolean') result.isTransient = detail.is_transient;
  return result;
}

/**
 * Parse `Retry-After` into milliseconds.
 *
 * Handles both documented forms — delay-seconds and an HTTP-date. A date in
 * the past clamps to zero rather than going negative.
 */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
