/**
 * Answer Meta's one-time GET subscription handshake.
 *
 * Meta sends this when the Callback URL is saved in the App Dashboard, or when
 * a `subscribed_apps` override is registered.
 *
 * This authenticates a SUBSCRIPTION, not a delivery. The verify token never
 * appears on an event POST. An endpoint that checks a verify token on POSTs is
 * checking a header no attacker has to supply — see verify-and-parse-webhook.ts
 * for what actually authenticates a delivery.
 */

import { verifySubscriptionChallenge } from '@assure-ai/whatsapp-webhooks';

declare const WEBHOOK_VERIFY_TOKEN: string;
declare const log: { warn(message: string, metadata: unknown): void };

export function handleChallenge(request: Request): Response {
  const result = verifySubscriptionChallenge({
    query: new URL(request.url).searchParams,
    expectedVerifyToken: WEBHOOK_VERIFY_TOKEN,
  });

  if (!result.ok) {
    // The reason is coarse and carries no token material, so it is safe to log.
    log.warn('whatsapp.challenge.rejected', { reason: result.reason });
    return new Response('Forbidden', { status: 403 });
  }

  // Echo the challenge verbatim with a 200 and nothing else. Meta compares the
  // whole response body — an extra newline or a JSON wrapper fails the setup.
  return new Response(result.challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

/**
 * The comparison is constant-time, and these are all rejected rather than
 * resolved:
 *
 *   - a missing hub.mode, hub.verify_token, or hub.challenge
 *   - any of them supplied twice (the classic way to smuggle a second value
 *     past a reader that takes the first)
 *   - a hub.mode other than "subscribe"
 *   - an empty or oversized challenge
 *   - an endpoint configured with an empty expected token, which would
 *     otherwise match an empty supplied one
 *
 * The expected token is never returned, logged, or embedded in a reason.
 */
