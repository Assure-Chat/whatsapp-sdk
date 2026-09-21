import {
  WhatsAppAmbiguousOutcomeError,
  WhatsAppConfigError,
  WhatsAppConnectionError,
  WhatsAppTimeoutError,
  createApiError,
  parseGraphError,
  parseRetryAfterMs,
} from './errors.js';

/**
 * The transport every resource goes through.
 *
 * Three decisions distinguish it from a generic HTTP wrapper, and each is a
 * deliberate refusal:
 *
 * - **No automatic retries, ever, by default.** Meta's `/messages` endpoint
 *   has no idempotency key. A library that retried a send on the caller's
 *   behalf would eventually deliver a verification code twice.
 * - **No environment reads.** Credentials arrive as arguments so that a
 *   multitenant caller cannot accidentally share one tenant's token with
 *   another through an ambient variable.
 * - **No token in a URL, a log, an error, or a hook.** The access token is
 *   held in a closure, written to one header, and never read back out.
 */

/** The subset of `fetch` this client relies on. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Query values the client knows how to serialize. */
export type QueryValue =
  string | number | boolean | undefined | null | readonly (string | number)[];

/**
 * A logger that only ever receives safe metadata.
 *
 * There is no `debug(body)` and no way to ask for request or response bodies:
 * the client never has a shape to hand you that contains one. What arrives is
 * method, route shape, status, attempt, duration, and `fbtrace_id`.
 */
export interface SafeLogger {
  debug?(message: string, metadata: Record<string, unknown>): void;
  warn?(message: string, metadata: Record<string, unknown>): void;
}

/** Called before each attempt. Receives no headers and no body. */
export type RequestHook = (info: {
  method: string;
  /** Route shape, e.g. `POST /{phone-number-id}/messages`. Never the full URL. */
  operation: string;
  attempt: number;
}) => void;

/** Called after each response. Receives no body. */
export type ResponseHook = (info: {
  method: string;
  operation: string;
  status: number;
  attempt: number;
  durationMs: number;
  fbtraceId?: string;
}) => void;

/**
 * Optional retry policy for **safe reads only**.
 *
 * Off by default. Turning it on never affects a mutation: `request` refuses to
 * retry anything whose `mutation` flag is set, whatever this says.
 *
 * On an Edge runtime, note that a retry sleeps inside your function's billed
 * wall-clock time. That is why it is opt-in rather than a sensible default.
 */
export interface ReadRetryOptions {
  /** Attempts after the first. Default 0 — no retries. */
  maxRetries?: number;
  /** Base backoff in ms, doubled per attempt. Default 500. */
  initialDelayMs?: number;
  /** Ceiling for one backoff delay. Default 8000. */
  maxDelayMs?: number;
  /** Honour a `Retry-After` response header over the computed backoff. Default true. */
  respectRetryAfter?: boolean;
}

export interface HttpClientOptions {
  baseUrl: string;
  /** Returns the bearer token. Held in a closure; never stored on the client. */
  getAccessToken: () => string;
  graphApiVersion: string;
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
  readRetry?: ReadRetryOptions | undefined;
  userAgent?: string | undefined;
  logger?: SafeLogger | undefined;
  onRequest?: RequestHook | undefined;
  onResponse?: ResponseHook | undefined;
  /** Injectable clock, so tests need no real timers. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  /**
   * Path relative to the version segment, with identifiers already validated —
   * e.g. `106540352242922/messages`.
   */
  path: string;
  /** Route shape for logs and errors. Carries no caller identifiers. */
  operation: string;
  query?: Record<string, QueryValue> | undefined;
  body?: unknown;
  /**
   * True when the request changes provider state.
   *
   * A mutation is never retried, and a mutation that fails after dispatch
   * raises {@link WhatsAppAmbiguousOutcomeError} rather than a connection
   * error, because the caller must reconcile rather than assume.
   */
  mutation: boolean;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = '@assure-ai/whatsapp-api';

/**
 * Statuses where the server states it did not act.
 *
 * A 429 is a refusal at the rate limiter and a 503 is a refusal at the front
 * door: nothing was processed, so replay is safe even for a mutation — but
 * only when the caller has opted into read retries, because "safe" and
 * "wanted" are different questions and a send's replay policy belongs to the
 * caller's job runner.
 *
 * 500, 502, and 504 are deliberately excluded: those are ambiguous. The
 * request may have been fully processed and only the response lost.
 */
const REFUSED_STATUSES: readonly number[] = [429, 503];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @internal */
export class HttpClient {
  readonly baseUrl: string;
  readonly graphApiVersion: string;

  readonly #getAccessToken: () => string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #initialDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #respectRetryAfter: boolean;
  readonly #userAgent: string;
  readonly #logger: SafeLogger | undefined;
  readonly #onRequest: RequestHook | undefined;
  readonly #onResponse: ResponseHook | undefined;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.graphApiVersion = options.graphApiVersion;
    this.#getAccessToken = options.getAccessToken;
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = options.readRetry?.maxRetries ?? 0;
    this.#initialDelayMs = options.readRetry?.initialDelayMs ?? 500;
    this.#maxDelayMs = options.readRetry?.maxDelayMs ?? 8_000;
    this.#respectRetryAfter = options.readRetry?.respectRetryAfter ?? true;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#logger = options.logger;
    this.#onRequest = options.onRequest;
    this.#onResponse = options.onResponse;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /** Build an absolute URL for a path under the pinned version. */
  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const trimmed = path.replace(/^\/+/, '');
    // `URL` handles percent-encoding of the path segments; identifiers have
    // already been validated by their `as*` parsers before reaching here.
    const url = new URL(`${this.graphApiVersion}/${trimmed}`, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        // Graph takes list filters as a JSON array in one parameter, not as
        // repeated keys.
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Perform a request and decode its JSON body. */
  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const { method, operation, mutation } = options;
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;

    // Read through a function rather than a property: checking it once must
    // not narrow it to `false` for the rest of the loop, because the caller
    // can abort at any point during the awaits below.
    const callerAborted = (): boolean => options.signal?.aborted === true;

    let attempt = 0;

    for (;;) {
      attempt += 1;

      // Check before dispatch, not only after. A real `fetch` rejects on an
      // already-aborted signal, but an injected one may not, and dispatching a
      // mutation the caller has already cancelled is exactly the case where
      // that difference matters — nothing has left the process yet, so this is
      // a clean cancellation rather than an ambiguous outcome.
      if (callerAborted()) {
        throw new WhatsAppTimeoutError(
          `${method} ${operation} was aborted by the caller before dispatch`,
          { timeoutMs, abortedByCaller: true },
        );
      }

      this.#onRequest?.({ method, operation, attempt });
      this.#logger?.debug?.('whatsapp.request', { method, operation, attempt });

      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': this.#userAgent,
        // The token goes here and nowhere else. Meta also accepts it as an
        // `access_token` query parameter; that form is never used, because a
        // URL ends up in proxy logs, browser history, and error messages.
        authorization: `Bearer ${this.#getAccessToken()}`,
      };

      let body: string | undefined;
      if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        headers['content-type'] = 'application/json';
      }

      const startedAt = Date.now();
      const { signal, dispose } = withTimeout(timeoutMs, options.signal);
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal,
        });
      } catch (cause) {
        dispose();
        const abortedByCaller = callerAborted();

        if (mutation) {
          // The request left this process. Whether Meta acted on it is
          // unknowable from here, and that is the single most important fact
          // to hand back — more important than which transport error occurred.
          throw new WhatsAppAmbiguousOutcomeError(
            {
              method,
              operation,
              detail: abortedByCaller
                ? 'aborted by the caller after dispatch'
                : isAbortError(cause)
                  ? `no response within ${timeoutMs}ms`
                  : 'the connection failed before a response',
            },
            { cause },
          );
        }

        const error = abortedByCaller
          ? new WhatsAppTimeoutError(
              `${method} ${operation} was aborted by the caller`,
              { timeoutMs, abortedByCaller: true },
              { cause },
            )
          : isAbortError(cause)
            ? new WhatsAppTimeoutError(
                `${method} ${operation} timed out after ${timeoutMs}ms`,
                { timeoutMs, abortedByCaller: false },
                { cause },
              )
            : new WhatsAppConnectionError(`${method} ${operation} failed before a response`, {
                cause,
              });

        if (abortedByCaller || attempt > this.#maxRetries) throw error;
        await this.#sleep(this.#backoffMs(attempt));
        continue;
      }
      dispose();

      const payload = await decodeBody(response);
      const fbtraceId = readTraceId(payload);

      this.#onResponse?.({
        method,
        operation,
        status: response.status,
        attempt,
        durationMs: Date.now() - startedAt,
        ...(fbtraceId !== undefined ? { fbtraceId } : {}),
      });

      if (response.ok) return payload as T;

      const parsed = parseGraphError(payload);
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const error = createApiError({
        status: response.status,
        message: parsed.message,
        code: parsed.code,
        subcode: parsed.subcode,
        type: parsed.type,
        details: parsed.details,
        userTitle: parsed.userTitle,
        userMessage: parsed.userMessage,
        fbtraceId: parsed.fbtraceId,
        isTransient: parsed.isTransient,
        retryAfterMs,
        method,
        operation,
      });

      this.#logger?.warn?.('whatsapp.response.error', {
        method,
        operation,
        status: response.status,
        code: parsed.code,
        classification: error.classification,
        attempt,
        ...(parsed.fbtraceId !== undefined ? { fbtraceId: parsed.fbtraceId } : {}),
      });

      // A mutation is never replayed here, not even on a refusal status. The
      // caller's durable job owns that decision and has the context to make it.
      const replayable =
        !mutation && (REFUSED_STATUSES.includes(response.status) || error.retryable);
      if (replayable && attempt <= this.#maxRetries) {
        const delay =
          this.#respectRetryAfter && retryAfterMs !== undefined
            ? retryAfterMs
            : this.#backoffMs(attempt);
        await this.#sleep(Math.min(delay, this.#maxDelayMs));
        continue;
      }

      throw error;
    }
  }

  /** Exponential backoff with full jitter, capped at `maxDelayMs`. */
  #backoffMs(attempt: number): number {
    const ceiling = Math.min(this.#initialDelayMs * 2 ** (attempt - 1), this.#maxDelayMs);
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
  }
}

/** Read `fbtrace_id` from a body without keeping the rest of it. */
function readTraceId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: { fbtrace_id?: unknown } }).error;
  const traceId = error?.fbtrace_id;
  return typeof traceId === 'string' ? traceId.slice(0, 64) : undefined;
}

async function decodeBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy's HTML error page, or a truncated body. The text itself is not
    // kept — it could contain anything — only the fact that it did not parse.
    return undefined;
  }
}

/** Combine a timeout with the caller's signal without leaking the timer. */
function withTimeout(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) onAbort();
    else callerSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
    },
  };
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && (value.name === 'AbortError' || value.name === 'TimeoutError');
}

/** Validate a base URL for the Graph API. @internal */
export function normalizeBaseUrl(raw: string, allowInsecure: boolean): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new WhatsAppConfigError('`baseUrl` must be a non-empty string');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (cause) {
    throw new WhatsAppConfigError('`baseUrl` is not a valid absolute URL', { cause });
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new WhatsAppConfigError(
      '`baseUrl` must use https. Set `allowInsecureBaseUrl: true` only to point at a local mock.',
    );
  }
  if (url.search !== '' || url.hash !== '') {
    throw new WhatsAppConfigError('`baseUrl` must not carry a query string or fragment');
  }
  if (url.username !== '' || url.password !== '') {
    throw new WhatsAppConfigError('`baseUrl` must not embed credentials');
  }
  return url.toString().replace(/\/+$/, '');
}
