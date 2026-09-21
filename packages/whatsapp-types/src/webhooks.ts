import type {
  PhoneNumberId,
  ProviderLocaleCode,
  WabaId,
  WhatsAppMessageId,
  WhatsAppRecipient,
} from './brands.js';
import type { KnownOr, MessagingProduct } from './common.js';
import type { TemplateCategory, TemplateRejectedReason } from './templates.js';
import type { MessagingLimitTier } from './accounts.js';

/**
 * Provider-facing webhook envelopes for the `whatsapp_business_account` object.
 *
 * Two envelope families exist and they are not the same shape:
 *
 * - the `messages` field, whose `value` carries `messaging_product` and
 *   `metadata`, and whose `entry` has no `time`;
 * - the account-level fields (`message_template_status_update`,
 *   `phone_number_quality_update`, …), whose `entry` **does** carry `time` and
 *   whose `value` carries neither `messaging_product` nor `metadata`.
 *
 * Code that assumes `value.metadata` exists will throw on the second family.
 */

// --- Shared -----------------------------------------------------------------

/** Which business phone number a `messages` webhook concerns. */
export interface WebhookMetadata {
  display_phone_number: string;
  phone_number_id: PhoneNumberId;
}

/** A provider error, as embedded in webhook payloads. */
export interface WebhookError {
  code: number;
  title?: string;
  /** Documented as carrying the same value as `title`. */
  message?: string;
  error_data?: {
    details?: string;
  };
  href?: string;
  [extension: string]: unknown;
}

/** The sender's WhatsApp profile, as they have set it. Personal data. */
export interface WebhookContact {
  profile?: {
    name?: string;
  };
  wa_id: WhatsAppRecipient;
  /** Present only when the identity-change check is enabled on the number. */
  identity_key_hash?: string;
}

// --- Inbound messages -------------------------------------------------------

/** Documented inbound message types. Many are never sent to Assure numbers. */
export type InboundMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'order'
  | 'reaction'
  | 'system'
  | 'unsupported';

export const INBOUND_MESSAGE_TYPES: readonly InboundMessageType[] = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'button',
  'order',
  'reaction',
  'system',
  'unsupported',
];

/** What an inbound message was a reply to. */
export interface InboundMessageContext {
  /** The business number, when the quoted message was outbound. */
  from?: string;
  id?: WhatsAppMessageId;
  /** Set when the user deleted the quoted message. */
  forwarded?: boolean;
  frequently_forwarded?: boolean;
  [extension: string]: unknown;
}

/** A tapped reply button on an interactive message. */
export interface InboundButtonReply {
  id: string;
  title: string;
}

/** A tapped row in an interactive list message. */
export interface InboundListReply {
  id: string;
  title: string;
  description?: string;
}

export type InboundInteractive =
  | { type: 'button_reply'; button_reply: InboundButtonReply }
  | { type: 'list_reply'; list_reply: InboundListReply }
  | { type: KnownOr<'button_reply' | 'list_reply'>; [extension: string]: unknown };

/**
 * An inbound message.
 *
 * Typed as one open object rather than a closed discriminated union on `type`,
 * because Meta introduces message types continuously and a union would reject
 * traffic the day a new one ships. Narrow with the `is*` guards in
 * `@assure-ai/whatsapp-webhooks`, which check the payload rather than trusting
 * `type` alone.
 */
export interface InboundMessage {
  /** The sender. Personal data — never log it. */
  from: WhatsAppRecipient;
  id: WhatsAppMessageId;
  /** Unix seconds, as a string. */
  timestamp: string;
  type: KnownOr<InboundMessageType>;
  context?: InboundMessageContext;
  text?: { body: string };
  /** Quick-reply button tapped on a *template* message. */
  button?: { payload?: string; text?: string };
  interactive?: InboundInteractive;
  /** Present on `type: "unsupported"` messages. */
  errors?: WebhookError[];
  [extension: string]: unknown;
}

// --- Outbound status --------------------------------------------------------

/**
 * A message status transition.
 *
 * `played` is documented for voice messages and is easy to miss. None of these
 * values is evidence that a person read, understood, or acted on anything —
 * `read` means the WhatsApp client rendered the message in an open thread.
 */
export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'played';

export const MESSAGE_DELIVERY_STATUSES: readonly MessageDeliveryStatus[] = [
  'sent',
  'delivered',
  'read',
  'failed',
  'played',
];

export type ConversationCategory =
  | 'authentication'
  | 'authentication_international'
  | 'marketing'
  | 'marketing_lite'
  | 'referral_conversion'
  | 'service'
  | 'utility';

export type PricingModel = 'CBP' | 'PMP';

export type PricingType = 'regular' | 'free_customer_service' | 'free_entry_point';

/**
 * The conversation a status belongs to.
 *
 * Omitted entirely from v24.0 onward except inside a free entry point window,
 * so absence carries no information about the message.
 */
export interface StatusConversation {
  id?: string;
  /** Present on `sent` statuses only. Unix seconds as a string. */
  expiration_timestamp?: string;
  origin?: {
    type?: KnownOr<ConversationCategory>;
  };
}

export interface StatusPricing {
  /** Deprecated by Meta in favour of `type` + `category`. */
  billable?: boolean;
  pricing_model?: KnownOr<PricingModel>;
  type?: KnownOr<PricingType>;
  category?: KnownOr<ConversationCategory>;
}

export interface MessageStatusEntry {
  id: WhatsAppMessageId;
  status: KnownOr<MessageDeliveryStatus>;
  /** Unix seconds, as a string. */
  timestamp: string;
  /** Destination, or a group ID when the message went to a group. */
  recipient_id: WhatsAppRecipient;
  recipient_type?: KnownOr<'group'>;
  recipient_participant_id?: WhatsAppRecipient;
  recipient_identity_key_hash?: string;
  /** Echoed back verbatim from the send request. */
  biz_opaque_callback_data?: string;
  conversation?: StatusConversation;
  pricing?: StatusPricing;
  errors?: WebhookError[];
  [extension: string]: unknown;
}

// --- `messages` field -------------------------------------------------------

/** The `value` of a `field: "messages"` change. */
export interface MessagesChangeValue {
  messaging_product: MessagingProduct;
  metadata: WebhookMetadata;
  contacts?: WebhookContact[];
  messages?: InboundMessage[];
  statuses?: MessageStatusEntry[];
  /** System-, app-, and account-level errors. */
  errors?: WebhookError[];
  [extension: string]: unknown;
}

export interface MessagesChange {
  field: 'messages';
  value: MessagesChangeValue;
}

// --- Account-level fields ---------------------------------------------------

/**
 * `message_template_status_update` events.
 *
 * The set is wider than the template `status` enum — `FLAGGED`, `REINSTATED`,
 * `LOCKED`, and `UNARCHIVED` appear here and nowhere else.
 */
export type TemplateStatusUpdateEvent =
  | 'APPROVED'
  | 'ARCHIVED'
  | 'UNARCHIVED'
  | 'DELETED'
  | 'DISABLED'
  | 'FLAGGED'
  | 'IN_APPEAL'
  | 'LIMIT_EXCEEDED'
  | 'LOCKED'
  | 'PAUSED'
  | 'PENDING'
  | 'PENDING_DELETION'
  | 'REINSTATED'
  | 'REJECTED';

export const TEMPLATE_STATUS_UPDATE_EVENTS: readonly TemplateStatusUpdateEvent[] = [
  'APPROVED',
  'ARCHIVED',
  'UNARCHIVED',
  'DELETED',
  'DISABLED',
  'FLAGGED',
  'IN_APPEAL',
  'LIMIT_EXCEEDED',
  'LOCKED',
  'PAUSED',
  'PENDING',
  'PENDING_DELETION',
  'REINSTATED',
  'REJECTED',
];

export interface TemplateStatusUpdateValue {
  event: KnownOr<TemplateStatusUpdateEvent>;
  /** Meta sends this as a JSON **number**, not a string. */
  message_template_id: number;
  message_template_name: string;
  message_template_language: ProviderLocaleCode;
  /** `null` when the template is scheduled for deletion. */
  reason?: KnownOr<TemplateRejectedReason> | null;
  message_template_category?: KnownOr<TemplateCategory>;
  disable_info?: { disable_date?: string };
  other_info?: { title?: string; description?: string };
  rejection_info?: { reason?: string; recommendation?: string };
  [extension: string]: unknown;
}

export interface TemplateStatusUpdateChange {
  field: 'message_template_status_update';
  value: TemplateStatusUpdateValue;
}

export type PhoneNumberQualityEvent = 'ONBOARDING' | 'THROUGHPUT_UPGRADE' | 'DOWNGRADE' | 'UPGRADE';

export interface PhoneNumberQualityUpdateValue {
  display_phone_number: string;
  event: KnownOr<PhoneNumberQualityEvent>;
  /** Removed by Meta in February 2026; still typed for older pinned versions. */
  old_limit?: KnownOr<MessagingLimitTier>;
  current_limit?: KnownOr<MessagingLimitTier>;
  max_daily_conversations_per_business?: KnownOr<MessagingLimitTier>;
  [extension: string]: unknown;
}

export interface PhoneNumberQualityUpdateChange {
  field: 'phone_number_quality_update';
  value: PhoneNumberQualityUpdateValue;
}

/**
 * `account_update` and its neighbours.
 *
 * The `value` shape varies substantially by `event`, and Meta documents the
 * variants inconsistently. Rather than model a union that would be wrong
 * somewhere, the whole value is kept open and only the fields present on every
 * documented example are named.
 */
export interface AccountUpdateValue {
  event?: string;
  phone_number?: string;
  ban_info?: { waba_ban_state?: string; waba_ban_date?: string };
  violation_info?: { violation_type?: string };
  restriction_info?: unknown;
  [extension: string]: unknown;
}

export interface AccountUpdateChange {
  field: 'account_update';
  value: AccountUpdateValue;
}

/** Any change whose `field` is not one this package models. */
export interface UnknownChange {
  field: string;
  value: unknown;
}

export type WebhookChange =
  | MessagesChange
  | TemplateStatusUpdateChange
  | PhoneNumberQualityUpdateChange
  | AccountUpdateChange
  | UnknownChange;

/**
 * One entry in the webhook batch.
 *
 * `id` is the WABA ID for every documented `whatsapp_business_account` field.
 * `time` is present on the account-level fields and absent on `messages`.
 */
export interface WebhookEntry {
  id: WabaId;
  time?: number;
  changes: WebhookChange[];
}

/** The top-level POST body. */
export interface WebhookPayload {
  object: KnownOr<'whatsapp_business_account'>;
  entry: WebhookEntry[];
}
