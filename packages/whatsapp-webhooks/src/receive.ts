import type { NormalizedWhatsAppEvent, WebhookPayload } from '@assure-ai/whatsapp-types';
import { toRawBytes } from './bytes.js';
import { normalizeWebhookPayload } from './normalize.js';
import {
  parseWebhookPayload,
  type ParseWebhookOptions,
  type WebhookParseFailureReason,
} from './parse.js';
import {
  verifyWebhookSignature,
  type HeadersLike,
  type SignatureFailureReason,
} from './signature.js';

/**
 * The one-call happy path: verify, then parse, then normalize.
 *
 * This exists so that the shortest correct thing to write is also the safe
 * thing. `parseWebhookPayload` and `normalizeWebhookPayload` remain exported
 * for callers who need the steps apart, but every example, every README, and
 * every integration guide uses this function — there is no documented route
 * that reaches a parsed payload without a signature check first, because the
 * signature check happens here before the body is even decoded.
 *
 * A failure never throws. A webhook endpoint that throws returns a 500, and
 * Meta retries 500s; a forged or malformed delivery should be refused quietly
 * with a 4xx and counted, not retried.
 */

export interface ReceiveWebhookInput {
  /** The exact bytes of the request body. Not a parsed object. */
  rawBody: Uint8Array | ArrayBuffer | string;
  headers?: HeadersLike;
  signatureHeader?: string;
  /** The Meta app secret. Never logged or returned. */
  appSecret: string;
  parse?: ParseWebhookOptions;
  /** Size cap applied before any crypto. Defaults to 1 MiB. */
  maxBodyBytes?: number;
}

export type ReceiveWebhookResult =
  | {
      ok: true;
      payload: WebhookPayload;
      events: NormalizedWhatsAppEvent[];
      /** The verified bytes, for the caller to archive or digest. */
      rawBody: Uint8Array;
    }
  | {
      ok: false;
      stage: 'signature';
      reason: SignatureFailureReason;
      message: string;
    }
  | {
      ok: false;
      stage: 'parse';
      reason: WebhookParseFailureReason;
      message: string;
    };

/**
 * Verify a delivery and normalize it.
 *
 * ```ts
 * const result = await receiveWebhook({
 *   rawBody: new Uint8Array(await request.arrayBuffer()),
 *   headers: request.headers,
 *   appSecret: APP_SECRET,
 * });
 * if (!result.ok) return new Response('Forbidden', { status: 403 });
 * for (const event of result.events) await enqueue(event);
 * return new Response('', { status: 200 });
 * ```
 *
 * Acknowledge with a 200 once the events are durably enqueued — not after they
 * are processed. Meta retries anything that is not a 200, and there is no API
 * for fetching webhook history, so a slow handler loses events that a fast
 * handoff to a queue would have kept.
 */
export async function receiveWebhook(input: ReceiveWebhookInput): Promise<ReceiveWebhookResult> {
  const rawBody = toRawBytes(input.rawBody);

  const verified = await verifyWebhookSignature({
    rawBody,
    ...(input.headers !== undefined ? { headers: input.headers } : {}),
    ...(input.signatureHeader !== undefined ? { signatureHeader: input.signatureHeader } : {}),
    appSecret: input.appSecret,
    ...(input.maxBodyBytes !== undefined ? { maxBodyBytes: input.maxBodyBytes } : {}),
  });
  if (!verified.ok) {
    return { ok: false, stage: 'signature', reason: verified.reason, message: verified.message };
  }

  const parsed = parseWebhookPayload(rawBody, {
    ...(input.maxBodyBytes !== undefined ? { maxBodyBytes: input.maxBodyBytes } : {}),
    ...input.parse,
  });
  if (!parsed.ok) {
    return { ok: false, stage: 'parse', reason: parsed.reason, message: parsed.message };
  }

  return {
    ok: true,
    payload: parsed.payload,
    events: normalizeWebhookPayload(parsed.payload),
    rawBody,
  };
}
