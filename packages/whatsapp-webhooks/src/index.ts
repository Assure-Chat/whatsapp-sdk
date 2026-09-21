/**
 * `@assure-ai/whatsapp-webhooks` — framework-neutral primitives for receiving
 * WhatsApp Business Platform webhooks.
 *
 * It starts no server, depends on no framework, and reads no environment. It
 * works from raw bytes and web-standard APIs, so the same code runs on
 * Node.js 20+, Deno, and Supabase Edge Functions.
 *
 * ## The order that matters
 *
 * 1. `verifySubscriptionChallenge` answers Meta's one-time GET handshake.
 * 2. `verifyWebhookSignature` authenticates each POST against the **exact raw
 *    bytes** using HMAC-SHA-256 and the app secret.
 * 3. Only then: parse and normalize.
 *
 * `receiveWebhook` does all three in the right order and is what the examples
 * use. Reaching a parsed payload without step 2 is not a documented path.
 *
 * ## Three things this package will not pretend
 *
 * - **The verify token is not POST authentication.** Meta sends it once, when
 *   the callback URL is saved. It never appears on an event delivery.
 * - **Delivered / read / clicked is not verified.** Normalized events carry
 *   provider facts and nothing about assurance, OTPs, or passkeys.
 * - **A header is not mTLS.** Client-certificate enforcement belongs at the
 *   TLS ingress. See `ingress.ts`.
 *
 * This is an independent Assure package. It is not published or endorsed by
 * Meta, whose documentation and policies remain authoritative.
 */

export {
  bytesToHex,
  hexToBytes,
  timingSafeEqualBytes,
  timingSafeEqualStrings,
  toRawBytes,
} from './bytes.js';

export {
  verifySubscriptionChallenge,
  type SubscriptionChallengeFailureReason,
  type SubscriptionChallengeInput,
  type SubscriptionChallengeResult,
} from './challenge.js';

export {
  SIGNATURE_HEADER,
  computeSignatureHeader,
  verifyWebhookSignature,
  type HeadersLike,
  type SignatureFailureReason,
  type SignatureVerificationResult,
  type VerifySignatureInput,
} from './signature.js';

export {
  parseWebhookPayload,
  type ParseWebhookOptions,
  type WebhookParseFailureReason,
  type WebhookParseResult,
} from './parse.js';

export { normalizeChange, normalizeWebhookPayload } from './normalize.js';

export { receiveWebhook, type ReceiveWebhookInput, type ReceiveWebhookResult } from './receive.js';

export { sha256Hex } from './digest.js';

export {
  summarizeEvents,
  toSafeEventMetadata,
  toSafeEventMetadataList,
  type SafeEventMetadata,
} from './redact.js';

export {
  assertTrustedIngress,
  type TrustedIngressAssertion,
  type TrustedIngressResult,
  type TrustedIngressVerifier,
} from './ingress.js';

export { readRawRequest, readRawStream, type RawWebhookRequest } from './raw-body.js';

// Re-exported so the common webhook path needs one import.
export type {
  MessageDeliveredEvent,
  MessageFailedEvent,
  MessageReadEvent,
  MessageReceivedEvent,
  MessageSentEvent,
  MessageStatusEvent,
  NormalizedEventKind,
  NormalizedWhatsAppEvent,
  UnknownEvent,
  WebhookChange,
  WebhookEntry,
  WebhookPayload,
} from '@assure-ai/whatsapp-types';
