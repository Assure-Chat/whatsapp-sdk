import type {
  InteractionReceivedEvent,
  MessageStatusEntry,
  MessagesChangeValue,
  NormalizedError,
  NormalizedPhoneContext,
  NormalizedWhatsAppEvent,
  PhoneNumberId,
  PhoneNumberQualityUpdateValue,
  ProviderLocaleCode,
  TemplateStatusUpdateValue,
  WabaId,
  WebhookChange,
  WebhookEntry,
  WebhookError,
  WebhookPayload,
  WhatsAppMessageId,
  WhatsAppRecipient,
} from '@assure-ai/whatsapp-types';

/**
 * Normalization: provider envelopes in, Assure's stable event union out.
 *
 * Three rules hold throughout, and each exists because breaking it would be a
 * security bug rather than a bug:
 *
 * 1. **No event is ever interpreted as verification.** `delivered`, `read`,
 *    and a tapped button are transport facts. Nothing here sets, implies, or
 *    names an assurance level, OTP outcome, or passkey result.
 * 2. **Nothing is defaulted.** A missing WABA ID, phone number ID, or
 *    timestamp stays missing. Substituting a plausible value would route an
 *    event to the wrong tenant, which is worse than not routing it.
 * 3. **Nothing is discarded.** A field, variant, or value this package does
 *    not model becomes a `whatsapp.unknown` event carrying the original
 *    change, so it is countable and inspectable.
 */

/** Unix seconds (string or number) to an ISO-8601 instant, or `undefined`. */
function toIsoTimestamp(value: unknown): string | undefined {
  const seconds =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(seconds)) return undefined;
  // Meta sends Unix seconds. A value large enough to be milliseconds is a
  // schema change, not something to rescale on a guess.
  if (seconds <= 0 || seconds > 4_102_444_800) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function phoneContext(value: MessagesChangeValue | undefined): NormalizedPhoneContext {
  const metadata = value?.metadata;
  const context: NormalizedPhoneContext = {};
  if (metadata && typeof metadata.phone_number_id === 'string' && metadata.phone_number_id !== '') {
    context.phoneNumberId = metadata.phone_number_id as PhoneNumberId;
  }
  if (metadata && typeof metadata.display_phone_number === 'string') {
    context.displayPhoneNumber = metadata.display_phone_number;
  }
  return context;
}

/** Reduce a provider error to the fields that are safe to keep and log. */
function normalizeErrors(errors: WebhookError[] | undefined): NormalizedError[] {
  if (!Array.isArray(errors)) return [];
  const out: NormalizedError[] = [];
  for (const error of errors) {
    if (!error || typeof error !== 'object') continue;
    const code = typeof error.code === 'number' ? error.code : Number.NaN;
    if (!Number.isFinite(code)) continue;
    const normalized: NormalizedError = { code };
    if (typeof error.title === 'string') normalized.title = error.title;
    const details = error.error_data?.details;
    if (typeof details === 'string') normalized.details = details;
    out.push(normalized);
  }
  return out;
}

/**
 * Build deduplication key candidates, strongest first.
 *
 * These are candidates, not a decision. Meta explicitly warns that a delivery
 * may be repeated and that batching is not guaranteed, so duplicates are normal
 * traffic rather than an anomaly. The application owns the real uniqueness
 * constraint, because only it knows the tenant scope the key must be unique
 * within — the same `wamid` legitimately appears under two WABAs in a
 * multitenant deployment, and a global unique index on it would drop events.
 *
 * Every candidate is prefixed with the event kind, so a `sent` and a
 * `delivered` status for one message never collide.
 */
function deduplicationKeys(kind: string, wabaId: string, parts: (string | undefined)[]): string[] {
  const present = parts.filter((part): part is string => typeof part === 'string' && part !== '');
  const keys: string[] = [];
  if (present.length > 0) {
    keys.push([kind, wabaId, ...present].join('|'));
  }
  // A weaker fallback without the WABA, for callers that already scope by it.
  if (present.length > 0) {
    keys.push([kind, ...present].join('|'));
  }
  return keys;
}

function unknownEvent(
  wabaId: WabaId,
  change: WebhookChange,
  reason: 'unmodelled-field' | 'unmodelled-variant' | 'malformed-value',
  occurredAt?: string,
  rawTimestamp?: string | number,
): NormalizedWhatsAppEvent {
  const event: NormalizedWhatsAppEvent = {
    kind: 'whatsapp.unknown',
    wabaId,
    phone: {},
    deduplicationKeys: [],
    provider: change,
    field: change.field,
    reason,
  };
  if (occurredAt !== undefined) event.occurredAt = occurredAt;
  if (rawTimestamp !== undefined) event.rawTimestamp = rawTimestamp;
  return event;
}

/** Map a provider status string onto its normalized event kind. */
function statusKind(
  status: string,
):
  | 'whatsapp.message.status.sent'
  | 'whatsapp.message.status.delivered'
  | 'whatsapp.message.status.read'
  | 'whatsapp.message.status.failed'
  | undefined {
  switch (status) {
    case 'sent':
      return 'whatsapp.message.status.sent';
    case 'delivered':
      return 'whatsapp.message.status.delivered';
    case 'read':
      return 'whatsapp.message.status.read';
    case 'failed':
      return 'whatsapp.message.status.failed';
    // `played` is documented but has no normalized kind of its own: it is a
    // voice-message signal Assure does not act on, and inventing an event for
    // it would imply a consumer. It surfaces as `whatsapp.unknown` instead.
    default:
      return undefined;
  }
}

function normalizeStatus(
  wabaId: WabaId,
  change: WebhookChange,
  value: MessagesChangeValue,
  status: MessageStatusEntry,
): NormalizedWhatsAppEvent {
  const occurredAt = toIsoTimestamp(status.timestamp);
  const kind = typeof status.status === 'string' ? statusKind(status.status) : undefined;
  if (kind === undefined || typeof status.id !== 'string') {
    return unknownEvent(wabaId, change, 'unmodelled-variant', occurredAt, status.timestamp);
  }

  const base = {
    wabaId,
    phone: phoneContext(value),
    provider: change,
    messageId: status.id as WhatsAppMessageId,
    recipientId: status.recipient_id as WhatsAppRecipient,
    providerStatus: status.status,
    deduplicationKeys: deduplicationKeys(kind, wabaId, [status.id, status.status]),
  };

  const event = { kind, ...base } as NormalizedWhatsAppEvent & { kind: typeof kind };
  if (occurredAt !== undefined) event.occurredAt = occurredAt;
  if (status.timestamp !== undefined) event.rawTimestamp = status.timestamp;
  if (typeof status.biz_opaque_callback_data === 'string') {
    (event as { callbackData?: string }).callbackData = status.biz_opaque_callback_data;
  }
  const category = status.conversation?.origin?.type ?? status.pricing?.category;
  if (typeof category === 'string') {
    (event as { conversationCategory?: string }).conversationCategory = category;
  }
  if (kind === 'whatsapp.message.status.failed') {
    (event as { errors: NormalizedError[] }).errors = normalizeErrors(status.errors);
  }
  return event;
}

function normalizeInboundMessage(
  wabaId: WabaId,
  change: WebhookChange,
  value: MessagesChangeValue,
  message: NonNullable<MessagesChangeValue['messages']>[number],
): NormalizedWhatsAppEvent {
  const occurredAt = toIsoTimestamp(message.timestamp);
  if (typeof message.id !== 'string' || typeof message.from !== 'string') {
    return unknownEvent(wabaId, change, 'malformed-value', occurredAt, message.timestamp);
  }

  const phone = phoneContext(value);
  const inReplyTo =
    typeof message.context?.id === 'string' ? (message.context.id as WhatsAppMessageId) : undefined;

  // An interactive reply or a template quick-reply tap is a distinct event:
  // it carries a business-assigned identifier that routing depends on, and
  // collapsing it into a generic inbound message loses that.
  const interaction = readInteraction(message);
  if (interaction !== undefined) {
    const event: InteractionReceivedEvent = {
      kind: 'whatsapp.interaction.received',
      wabaId,
      phone,
      provider: change,
      messageId: message.id as WhatsAppMessageId,
      from: message.from as WhatsAppRecipient,
      interactionType: interaction.interactionType,
      replyId: interaction.replyId,
      deduplicationKeys: deduplicationKeys('whatsapp.interaction.received', wabaId, [message.id]),
    };
    if (occurredAt !== undefined) event.occurredAt = occurredAt;
    if (message.timestamp !== undefined) event.rawTimestamp = message.timestamp;
    if (inReplyTo !== undefined) event.inReplyTo = inReplyTo;
    return event;
  }

  const event: NormalizedWhatsAppEvent = {
    kind: 'whatsapp.message.received',
    wabaId,
    phone,
    provider: change,
    messageId: message.id as WhatsAppMessageId,
    from: message.from as WhatsAppRecipient,
    messageType: typeof message.type === 'string' ? message.type : 'unsupported',
    deduplicationKeys: deduplicationKeys('whatsapp.message.received', wabaId, [message.id]),
  };
  if (occurredAt !== undefined) event.occurredAt = occurredAt;
  if (message.timestamp !== undefined) event.rawTimestamp = message.timestamp;
  if (inReplyTo !== undefined) event.inReplyTo = inReplyTo;
  return event;
}

/**
 * Extract a business-assigned reply identifier, if the message carries one.
 *
 * Checks the payload shape rather than trusting `type`: a message typed
 * `interactive` with no recognized reply object is not an interaction, and a
 * `button` message is a quick-reply tap on a *template*, which Meta models
 * completely differently from an interactive reply.
 */
function readInteraction(
  message: NonNullable<MessagesChangeValue['messages']>[number],
): { interactionType: InteractionReceivedEvent['interactionType']; replyId: string } | undefined {
  const interactive = message.interactive;
  if (interactive && typeof interactive === 'object') {
    const buttonReply = (interactive as { button_reply?: { id?: unknown } }).button_reply;
    if (buttonReply && typeof buttonReply.id === 'string' && buttonReply.id !== '') {
      return { interactionType: 'button_reply', replyId: buttonReply.id };
    }
    const listReply = (interactive as { list_reply?: { id?: unknown } }).list_reply;
    if (listReply && typeof listReply.id === 'string' && listReply.id !== '') {
      return { interactionType: 'list_reply', replyId: listReply.id };
    }
  }
  const button = message.button;
  if (
    button &&
    typeof button === 'object' &&
    typeof button.payload === 'string' &&
    button.payload !== ''
  ) {
    return { interactionType: 'template_quick_reply', replyId: button.payload };
  }
  return undefined;
}

function normalizeMessagesChange(
  wabaId: WabaId,
  change: WebhookChange,
  value: unknown,
): NormalizedWhatsAppEvent[] {
  if (!value || typeof value !== 'object') {
    return [unknownEvent(wabaId, change, 'malformed-value')];
  }
  const messagesValue = value as MessagesChangeValue;
  const events: NormalizedWhatsAppEvent[] = [];

  if (Array.isArray(messagesValue.statuses)) {
    for (const status of messagesValue.statuses) {
      if (!status || typeof status !== 'object') {
        events.push(unknownEvent(wabaId, change, 'malformed-value'));
        continue;
      }
      events.push(normalizeStatus(wabaId, change, messagesValue, status));
    }
  }

  if (Array.isArray(messagesValue.messages)) {
    for (const message of messagesValue.messages) {
      if (!message || typeof message !== 'object') {
        events.push(unknownEvent(wabaId, change, 'malformed-value'));
        continue;
      }
      events.push(normalizeInboundMessage(wabaId, change, messagesValue, message));
    }
  }

  if (events.length === 0) {
    // A `messages` change with neither array — a value-level error webhook, or
    // a variant not yet modelled. Surfaced, not swallowed.
    events.push(unknownEvent(wabaId, change, 'unmodelled-variant'));
  }
  return events;
}

function normalizeTemplateStatusChange(
  wabaId: WabaId,
  change: WebhookChange,
  value: unknown,
  entryTime: number | undefined,
): NormalizedWhatsAppEvent {
  if (!value || typeof value !== 'object') {
    return unknownEvent(wabaId, change, 'malformed-value');
  }
  const update = value as TemplateStatusUpdateValue;
  if (
    typeof update.event !== 'string' ||
    typeof update.message_template_name !== 'string' ||
    update.message_template_id === undefined
  ) {
    return unknownEvent(wabaId, change, 'malformed-value', toIsoTimestamp(entryTime), entryTime);
  }

  // Meta sends this ID as a JSON number while every other template identifier
  // is a string. Stringified here so downstream comparisons are uniform and
  // large IDs are never rounded through a float.
  const templateId = String(update.message_template_id);
  const event: NormalizedWhatsAppEvent = {
    kind: 'whatsapp.template.status.updated',
    wabaId,
    phone: {},
    provider: change,
    templateId,
    templateName: update.message_template_name,
    templateLanguage: (update.message_template_language ?? '') as ProviderLocaleCode,
    event: update.event,
    deduplicationKeys: deduplicationKeys('whatsapp.template.status.updated', wabaId, [
      templateId,
      update.event,
      entryTime === undefined ? undefined : String(entryTime),
    ]),
  };
  const occurredAt = toIsoTimestamp(entryTime);
  if (occurredAt !== undefined) event.occurredAt = occurredAt;
  if (entryTime !== undefined) event.rawTimestamp = entryTime;
  if (typeof update.message_template_category === 'string') {
    (event as { category?: string }).category = update.message_template_category;
  }
  const reason = update.rejection_info?.reason ?? update.reason;
  if (typeof reason === 'string') (event as { reason?: string }).reason = reason;
  return event;
}

function normalizePhoneQualityChange(
  wabaId: WabaId,
  change: WebhookChange,
  value: unknown,
  entryTime: number | undefined,
): NormalizedWhatsAppEvent {
  if (!value || typeof value !== 'object') {
    return unknownEvent(wabaId, change, 'malformed-value');
  }
  const update = value as PhoneNumberQualityUpdateValue;
  if (typeof update.event !== 'string') {
    return unknownEvent(wabaId, change, 'malformed-value', toIsoTimestamp(entryTime), entryTime);
  }

  const phone: NormalizedPhoneContext = {};
  if (typeof update.display_phone_number === 'string') {
    // This webhook identifies the number by display form only — there is no
    // phone_number_id in the payload, so none is invented.
    phone.displayPhoneNumber = update.display_phone_number;
  }

  const event: NormalizedWhatsAppEvent = {
    kind: 'whatsapp.phone.status.updated',
    wabaId,
    phone,
    provider: change,
    event: update.event,
    deduplicationKeys: deduplicationKeys('whatsapp.phone.status.updated', wabaId, [
      update.display_phone_number,
      update.event,
      entryTime === undefined ? undefined : String(entryTime),
    ]),
  };
  const occurredAt = toIsoTimestamp(entryTime);
  if (occurredAt !== undefined) event.occurredAt = occurredAt;
  if (entryTime !== undefined) event.rawTimestamp = entryTime;
  if (typeof update.old_limit === 'string') {
    (event as { previousLimit?: string }).previousLimit = update.old_limit;
  }
  const current = update.current_limit ?? update.max_daily_conversations_per_business;
  if (typeof current === 'string') (event as { currentLimit?: string }).currentLimit = current;
  return event;
}

function normalizeAccountChange(
  wabaId: WabaId,
  change: WebhookChange,
  value: unknown,
  entryTime: number | undefined,
): NormalizedWhatsAppEvent {
  const event: NormalizedWhatsAppEvent = {
    kind: 'whatsapp.account.updated',
    wabaId,
    phone: {},
    provider: change,
    deduplicationKeys: deduplicationKeys('whatsapp.account.updated', wabaId, [
      change.field,
      entryTime === undefined ? undefined : String(entryTime),
    ]),
  };
  const occurredAt = toIsoTimestamp(entryTime);
  if (occurredAt !== undefined) event.occurredAt = occurredAt;
  if (entryTime !== undefined) event.rawTimestamp = entryTime;
  if (value && typeof value === 'object') {
    const named = (value as { event?: unknown }).event;
    if (typeof named === 'string') (event as { event?: string }).event = named;
  }
  return event;
}

/** Normalize a single change. Exposed for callers that iterate themselves. */
export function normalizeChange(
  entry: Pick<WebhookEntry, 'id' | 'time'>,
  change: WebhookChange,
): NormalizedWhatsAppEvent[] {
  const wabaId = entry.id;
  switch (change.field) {
    case 'messages':
      return normalizeMessagesChange(wabaId, change, change.value);
    case 'message_template_status_update':
      return [normalizeTemplateStatusChange(wabaId, change, change.value, entry.time)];
    case 'phone_number_quality_update':
      return [normalizePhoneQualityChange(wabaId, change, change.value, entry.time)];
    case 'account_update':
    case 'account_review_update':
    case 'account_alerts':
    case 'business_capability_update':
      return [normalizeAccountChange(wabaId, change, change.value, entry.time)];
    default:
      return [
        unknownEvent(wabaId, change, 'unmodelled-field', toIsoTimestamp(entry.time), entry.time),
      ];
  }
}

/**
 * Normalize an entire verified, parsed payload.
 *
 * Order is preserved exactly as received. It is deliberately **not** sorted by
 * timestamp: Meta does not guarantee ordering, several statuses can share a
 * second, and `read` can arrive without a preceding `delivered`. Re-ordering
 * here would hide that from the application, which is the layer that owns the
 * state machine and must be able to see events arrive out of order.
 */
export function normalizeWebhookPayload(payload: WebhookPayload): NormalizedWhatsAppEvent[] {
  const events: NormalizedWhatsAppEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      events.push(...normalizeChange(entry, change));
    }
  }
  return events;
}
