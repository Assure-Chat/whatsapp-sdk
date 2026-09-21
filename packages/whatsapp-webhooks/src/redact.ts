import type { NormalizedWhatsAppEvent } from '@assure-ai/whatsapp-types';

/**
 * Safe metadata selectors.
 *
 * The rule these implement: **nothing that identifies a person, and nothing a
 * person wrote, leaves this package into a log.** That means no phone numbers
 * in either representation, no profile names, no message bodies, no media
 * references, no button labels, no `biz_opaque_callback_data` (a caller may
 * have put something identifying there), and no raw payloads.
 *
 * What is left is still enough to operate on: event kind, WABA, phone number
 * ID, provider error codes, timing, and a truncated message ID. That is the
 * deliberate trade — an on-call engineer can see the shape of a failure
 * without the logs becoming a directory of who was verified when.
 */

/** Metadata safe to emit to logs, metrics, and traces. */
export interface SafeEventMetadata {
  kind: NormalizedWhatsAppEvent['kind'];
  wabaId: string;
  /** Present only when the payload carried an ID; never a display number. */
  phoneNumberId?: string;
  occurredAt?: string;
  /**
   * The message ID, truncated to its first 24 characters.
   *
   * A `wamid` encodes the destination in its base64 body, so the whole value
   * is quasi-identifying. The prefix is stable enough to correlate two log
   * lines about one message and short enough not to carry the number.
   */
  messageIdPrefix?: string;
  /** Provider error codes only — never their human-readable details. */
  errorCodes?: number[];
  /** For unknown events: which field could not be normalized. */
  field?: string;
  /** For unknown events: why. */
  reason?: string;
}

const MESSAGE_ID_PREFIX_LENGTH = 24;

/**
 * Reduce a normalized event to metadata that is safe to log.
 *
 * The `provider` payload is never read here beyond what is already on the
 * normalized event, so a provider field added tomorrow cannot leak through
 * this function.
 */
export function toSafeEventMetadata(event: NormalizedWhatsAppEvent): SafeEventMetadata {
  const metadata: SafeEventMetadata = {
    kind: event.kind,
    wabaId: event.wabaId,
  };
  if (event.phone.phoneNumberId !== undefined) metadata.phoneNumberId = event.phone.phoneNumberId;
  if (event.occurredAt !== undefined) metadata.occurredAt = event.occurredAt;

  const messageId = (event as { messageId?: unknown }).messageId;
  if (typeof messageId === 'string' && messageId !== '') {
    metadata.messageIdPrefix = messageId.slice(0, MESSAGE_ID_PREFIX_LENGTH);
  }

  if (event.kind === 'whatsapp.message.status.failed') {
    metadata.errorCodes = event.errors.map((error) => error.code);
  }

  if (event.kind === 'whatsapp.unknown') {
    metadata.field = event.field;
    metadata.reason = event.reason;
  }

  return metadata;
}

/** Map a batch of events to safe metadata. */
export function toSafeEventMetadataList(
  events: readonly NormalizedWhatsAppEvent[],
): SafeEventMetadata[] {
  return events.map(toSafeEventMetadata);
}

/**
 * A one-line counter summary of a batch — kinds and how many of each.
 *
 * Carries no identifiers at all, so it is safe at any log level.
 */
export function summarizeEvents(
  events: readonly NormalizedWhatsAppEvent[],
): Record<string, number> {
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return { ...counts };
}
