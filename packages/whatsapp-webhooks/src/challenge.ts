import { timingSafeEqualStrings } from './bytes.js';

/**
 * Meta's GET subscription-verification handshake.
 *
 * **This authenticates a subscription, not a delivery.** Meta sends the verify
 * token exactly once, when the Callback URL is saved in the App Dashboard (or
 * when a `subscribed_apps` override is registered). It is never sent on a POST.
 * An endpoint that checks a verify token on event POSTs is checking a header no
 * attacker has to supply, and is effectively unauthenticated — use
 * `verifyWebhookSignature` for POSTs.
 */

/** Query parameters, as untrusted input. */
export interface SubscriptionChallengeInput {
  /**
   * The request query. A `URLSearchParams` is preferred because it models
   * repeated keys correctly; a plain record is accepted for frameworks that
   * hand you one, and a repeated key arriving as an array is rejected.
   */
  query: URLSearchParams | Record<string, string | string[] | undefined>;
  /**
   * The verify token configured for this endpoint. Never returned, never
   * logged, never included in a failure reason.
   */
  expectedVerifyToken: string;
}

/** Why a challenge was refused. Deliberately coarse. */
export type SubscriptionChallengeFailureReason =
  | 'missing_parameters'
  | 'duplicate_parameters'
  | 'unsupported_mode'
  | 'token_mismatch'
  | 'malformed_challenge';

export type SubscriptionChallengeResult =
  | {
      ok: true;
      /**
       * Echo this back verbatim with a 200 and nothing else. Meta compares the
       * whole response body.
       */
      challenge: string;
    }
  | {
      ok: false;
      reason: SubscriptionChallengeFailureReason;
      /** A message safe to log. Contains no token material. */
      message: string;
    };

const MAX_CHALLENGE_LENGTH = 512;

/**
 * Read one query parameter, rejecting repeats.
 *
 * A repeated parameter is how a request smuggles a second value past a naive
 * reader that takes the first (or the last) — so it is an error rather than a
 * preference.
 */
function readSingle(
  query: URLSearchParams | Record<string, string | string[] | undefined>,
  name: string,
): { value?: string; duplicated: boolean } {
  if (query instanceof URLSearchParams) {
    const all = query.getAll(name);
    if (all.length > 1) return { duplicated: true };
    return { value: all[0], duplicated: false };
  }
  const raw = query[name];
  if (Array.isArray(raw)) {
    if (raw.length > 1) return { duplicated: true };
    return { value: raw[0], duplicated: false };
  }
  if (raw === undefined) return { duplicated: false };
  if (typeof raw !== 'string') return { duplicated: false };
  return { value: raw, duplicated: false };
}

/**
 * Validate a `hub.mode=subscribe` challenge.
 *
 * ```ts
 * const result = verifySubscriptionChallenge({
 *   query: new URL(request.url).searchParams,
 *   expectedVerifyToken: WEBHOOK_VERIFY_TOKEN,
 * });
 * return result.ok
 *   ? new Response(result.challenge, { status: 200 })
 *   : new Response('Forbidden', { status: 403 });
 * ```
 */
export function verifySubscriptionChallenge(
  input: SubscriptionChallengeInput,
): SubscriptionChallengeResult {
  const mode = readSingle(input.query, 'hub.mode');
  const token = readSingle(input.query, 'hub.verify_token');
  const challenge = readSingle(input.query, 'hub.challenge');

  if (mode.duplicated || token.duplicated || challenge.duplicated) {
    return {
      ok: false,
      reason: 'duplicate_parameters',
      message: 'A hub.* query parameter was supplied more than once',
    };
  }

  if (mode.value === undefined || token.value === undefined || challenge.value === undefined) {
    return {
      ok: false,
      reason: 'missing_parameters',
      message: 'hub.mode, hub.verify_token, and hub.challenge are all required',
    };
  }

  if (mode.value !== 'subscribe') {
    return {
      ok: false,
      reason: 'unsupported_mode',
      message: 'hub.mode must be "subscribe"',
    };
  }

  if (challenge.value.length === 0 || challenge.value.length > MAX_CHALLENGE_LENGTH) {
    return {
      ok: false,
      reason: 'malformed_challenge',
      message: `hub.challenge must be between 1 and ${MAX_CHALLENGE_LENGTH} characters`,
    };
  }

  if (typeof input.expectedVerifyToken !== 'string' || input.expectedVerifyToken.length === 0) {
    // Refuse rather than accept: an endpoint configured with an empty expected
    // token would otherwise match an empty supplied token.
    return {
      ok: false,
      reason: 'token_mismatch',
      message: 'No verify token is configured for this endpoint',
    };
  }

  if (!timingSafeEqualStrings(token.value, input.expectedVerifyToken)) {
    return {
      ok: false,
      reason: 'token_mismatch',
      message: 'hub.verify_token did not match the configured value',
    };
  }

  return { ok: true, challenge: challenge.value };
}
