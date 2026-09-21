/**
 * Verify and normalize a WhatsApp webhook delivery.
 *
 * The order is the point: signature first, on the exact raw bytes, before the
 * body is even decoded. `receiveWebhook` enforces it, which is why every
 * example uses it rather than calling parse and normalize separately.
 */

import {
  receiveWebhook,
  toSafeEventMetadata,
  summarizeEvents,
  type NormalizedWhatsAppEvent,
} from '@assure-ai/whatsapp-webhooks';

declare const APP_SECRET: string;
declare const log: {
  info(message: string, metadata: unknown): void;
  warn(message: string, metadata: unknown): void;
};
declare const metrics: { increment(name: string, tags?: Record<string, string>): void };
declare const queue: { push(event: NormalizedWhatsAppEvent): Promise<void> };
declare const db: { insertIfAbsent(row: { dedupKey: string }): Promise<boolean> };

export async function handleWebhook(request: Request): Promise<Response> {
  // Bytes first. `await request.json()` would consume the body and destroy the
  // exact bytes Meta signed — and a body parser running before this handler
  // does the same thing invisibly.
  const rawBody = new Uint8Array(await request.arrayBuffer());

  const result = await receiveWebhook({
    rawBody,
    headers: request.headers,
    appSecret: APP_SECRET,
  });

  if (!result.ok) {
    // 4xx, not 5xx. Meta retries 5xx, and a forged or malformed delivery
    // should be refused and counted, not retried. The reason is coarse and
    // carries no secret, so it is safe to log.
    log.warn('whatsapp.webhook.rejected', { stage: result.stage, reason: result.reason });
    metrics.increment('whatsapp.webhook_rejected', { reason: result.reason });
    return new Response('Forbidden', { status: 403 });
  }

  // Counts per kind, no identifiers at all — safe at any log level.
  log.info('whatsapp.webhook.received', summarizeEvents(result.events));

  // Enqueue durably, THEN acknowledge. Meta retries anything that is not a
  // 200, and there is no API for fetching missed webhooks, so a slow handler
  // loses events that a fast handoff would have kept.
  for (const event of result.events) {
    await enqueueOnce(event);
  }

  return new Response('', { status: 200 });
}

/**
 * Deduplicate before enqueueing.
 *
 * The library supplies key candidates; the constraint is the application's,
 * because only it knows the tenant scope the key must be unique within.
 */
async function enqueueOnce(event: NormalizedWhatsAppEvent): Promise<void> {
  const key = event.deduplicationKeys[0];
  if (key === undefined) {
    metrics.increment('whatsapp.event_without_dedup_key');
    await queue.push(event);
    return;
  }

  const inserted = await db.insertIfAbsent({ dedupKey: key });
  if (!inserted) {
    // A redelivery. Normal traffic — Meta does not guarantee exactly-once.
    metrics.increment('whatsapp.duplicate_event');
    return;
  }
  await queue.push(event);
}

/** Route a normalized event. Exhaustive, with a safe `default`. */
export async function route(event: NormalizedWhatsAppEvent): Promise<void> {
  // Safe metadata: no destinations, names, message content, or callback data.
  log.info('whatsapp.event', toSafeEventMetadata(event));

  switch (event.kind) {
    case 'whatsapp.message.status.sent':
    case 'whatsapp.message.status.delivered':
    case 'whatsapp.message.status.read':
      // Transport progress ONLY. `read` means a WhatsApp client rendered the
      // message; it says nothing about who was holding the phone. This must
      // never be allowed to advance a verification.
      await recordTransportStatus(event.callbackData, event.kind);
      return;

    case 'whatsapp.message.status.failed':
      // Provider error codes, already reduced to the safe fields.
      await recordFailure(event.callbackData, event.errors);
      return;

    case 'whatsapp.interaction.received':
      // Route on the business-assigned id, never the user-visible label:
      // labels are localized, editable, and unstable.
      if (event.replyId === 'not_me') await raiseNotMeSignal(event);
      return;

    case 'whatsapp.message.received':
      await recordInbound(event);
      return;

    case 'whatsapp.template.status.updated':
      // Approval is revocable. This is how you learn a template was paused.
      await syncTemplateStatus(event.templateId, event.event);
      return;

    case 'whatsapp.phone.status.updated':
    case 'whatsapp.account.updated':
      await refreshConnection(event.wabaId);
      return;

    case 'whatsapp.unknown':
      // Count it. The first notice of a provider schema change should be a
      // metric, not a support ticket.
      metrics.increment('whatsapp.unknown_event', {
        field: event.field,
        reason: event.reason,
      });
      return;

    default: {
      // Fails to compile if a new event kind is added without a branch above.
      const exhaustive: never = event;
      throw new Error(`unhandled event kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

declare function recordTransportStatus(
  callbackData: string | undefined,
  kind: string,
): Promise<void>;
declare function recordFailure(callbackData: string | undefined, errors: unknown): Promise<void>;
declare function raiseNotMeSignal(event: NormalizedWhatsAppEvent): Promise<void>;
declare function recordInbound(event: NormalizedWhatsAppEvent): Promise<void>;
declare function syncTemplateStatus(templateId: string, status: string): Promise<void>;
declare function refreshConnection(wabaId: string): Promise<void>;
