import type {
  PhoneNumberId,
  ProviderLocaleCode,
  WabaId,
  WhatsAppMessageId,
  WhatsAppRecipient,
} from './brands.js';
import type { KnownOr } from './common.js';
import type {
  ConversationCategory,
  InboundMessageType,
  MessageDeliveryStatus,
  PhoneNumberQualityEvent,
  TemplateStatusUpdateEvent,
  WebhookChange,
} from './webhooks.js';
import type { TemplateCategory } from './templates.js';
import type { MessagingLimitTier } from './accounts.js';

/**
 * Assure's normalized WhatsApp event union.
 *
 * This is the stable contract the rest of Assure consumes, so that a change in
 * Meta's envelope is absorbed here rather than rippling through the platform.
 *
 * **What these events are not.** Every field below is a provider fact. There is
 * no tenant, no environment, no verification status, no achieved assurance
 * level, no OTP correctness, and no passkey result — and none should be added.
 * A `whatsapp.message.status.read` event means a WhatsApp client rendered a
 * message; it is not evidence that a person read it, that the right person
 * received it, or that any verification succeeded. Conflating the two is the
 * single most dangerous mistake available at this boundary, so the type system
 * is used to make it impossible to make accidentally.
 */

export type NormalizedEventKind =
  | 'whatsapp.message.received'
  | 'whatsapp.message.status.sent'
  | 'whatsapp.message.status.delivered'
  | 'whatsapp.message.status.read'
  | 'whatsapp.message.status.failed'
  | 'whatsapp.interaction.received'
  | 'whatsapp.template.status.updated'
  | 'whatsapp.phone.status.updated'
  | 'whatsapp.account.updated'
  | 'whatsapp.unknown';

export const NORMALIZED_EVENT_KINDS: readonly NormalizedEventKind[] = [
  'whatsapp.message.received',
  'whatsapp.message.status.sent',
  'whatsapp.message.status.delivered',
  'whatsapp.message.status.read',
  'whatsapp.message.status.failed',
  'whatsapp.interaction.received',
  'whatsapp.template.status.updated',
  'whatsapp.phone.status.updated',
  'whatsapp.account.updated',
  'whatsapp.unknown',
];

/** Which business phone number an event concerns, when the payload says. */
export interface NormalizedPhoneContext {
  phoneNumberId?: PhoneNumberId;
  displayPhoneNumber?: string;
}

/** A provider error, reduced to what is safe to keep. */
export interface NormalizedError {
  code: number;
  title?: string;
  details?: string;
}

/** Fields shared by every normalized event. */
export interface NormalizedEventBase {
  kind: NormalizedEventKind;
  /** WABA the batch entry belonged to. */
  wabaId: WabaId;
  phone: NormalizedPhoneContext;
  /**
   * The provider timestamp as an ISO-8601 instant, when one could be derived.
   *
   * Absent rather than defaulted: a webhook with no usable timestamp must not
   * be silently stamped with receipt time, because ordering decisions made on
   * a fabricated timestamp are worse than ordering decisions deferred.
   */
  occurredAt?: string;
  /** The timestamp exactly as the provider sent it, whatever its form. */
  rawTimestamp?: string | number;
  /**
   * Candidate keys for deduplication, strongest first.
   *
   * These are *candidates*. The application owns the actual uniqueness
   * constraint — only it knows the tenant scope the key must be unique within.
   */
  deduplicationKeys: string[];
  /** The originating change, for inspection. Never log it wholesale. */
  provider: WebhookChange;
}

export interface MessageReceivedEvent extends NormalizedEventBase {
  kind: 'whatsapp.message.received';
  messageId: WhatsAppMessageId;
  /** The sender. Personal data. */
  from: WhatsAppRecipient;
  messageType: KnownOr<InboundMessageType>;
  /** The message this replies to, when it is a reply. */
  inReplyTo?: WhatsAppMessageId;
}

/** Fields common to the four status events. */
interface StatusEventBase extends NormalizedEventBase {
  messageId: WhatsAppMessageId;
  /** Destination, or a group ID. Personal data. */
  recipientId: WhatsAppRecipient;
  /** The opaque value the caller attached at send time, if any. */
  callbackData?: string;
  conversationCategory?: KnownOr<ConversationCategory>;
  /** The provider's status string, preserved even when it is a known value. */
  providerStatus: KnownOr<MessageDeliveryStatus>;
}

export interface MessageSentEvent extends StatusEventBase {
  kind: 'whatsapp.message.status.sent';
}

export interface MessageDeliveredEvent extends StatusEventBase {
  kind: 'whatsapp.message.status.delivered';
}

export interface MessageReadEvent extends StatusEventBase {
  kind: 'whatsapp.message.status.read';
}

export interface MessageFailedEvent extends StatusEventBase {
  kind: 'whatsapp.message.status.failed';
  errors: NormalizedError[];
}

/**
 * A tapped button or selected list row.
 *
 * Carries the developer-assigned `replyId` and not the user-visible label:
 * labels are localized, editable, and unstable, so routing on them breaks.
 */
export interface InteractionReceivedEvent extends NormalizedEventBase {
  kind: 'whatsapp.interaction.received';
  messageId: WhatsAppMessageId;
  from: WhatsAppRecipient;
  interactionType: 'button_reply' | 'list_reply' | 'template_quick_reply';
  /** The `id` (or quick-reply `payload`) the business assigned. */
  replyId: string;
  /** The message carrying the control the user acted on. */
  inReplyTo?: WhatsAppMessageId;
}

export interface TemplateStatusUpdatedEvent extends NormalizedEventBase {
  kind: 'whatsapp.template.status.updated';
  templateId: string;
  templateName: string;
  templateLanguage: ProviderLocaleCode;
  event: KnownOr<TemplateStatusUpdateEvent>;
  category?: KnownOr<TemplateCategory>;
  /** Rejection reason, when Meta sent one. */
  reason?: string;
}

export interface PhoneStatusUpdatedEvent extends NormalizedEventBase {
  kind: 'whatsapp.phone.status.updated';
  event: KnownOr<PhoneNumberQualityEvent>;
  previousLimit?: KnownOr<MessagingLimitTier>;
  currentLimit?: KnownOr<MessagingLimitTier>;
}

export interface AccountUpdatedEvent extends NormalizedEventBase {
  kind: 'whatsapp.account.updated';
  event?: string;
}

/**
 * A change this package does not model.
 *
 * Emitted rather than thrown or dropped: an unrecognized field is a fact about
 * the provider worth counting, and discarding it silently means the first
 * notice of a schema change is a support ticket.
 */
export interface UnknownEvent extends NormalizedEventBase {
  kind: 'whatsapp.unknown';
  /** The `field` of the change that could not be normalized. */
  field: string;
  /** Why normalization declined it. */
  reason: 'unmodelled-field' | 'unmodelled-variant' | 'malformed-value';
}

export type NormalizedWhatsAppEvent =
  | MessageReceivedEvent
  | MessageSentEvent
  | MessageDeliveredEvent
  | MessageReadEvent
  | MessageFailedEvent
  | InteractionReceivedEvent
  | TemplateStatusUpdatedEvent
  | PhoneStatusUpdatedEvent
  | AccountUpdatedEvent
  | UnknownEvent;

/** Narrow to the four status events. */
export type MessageStatusEvent =
  MessageSentEvent | MessageDeliveredEvent | MessageReadEvent | MessageFailedEvent;
