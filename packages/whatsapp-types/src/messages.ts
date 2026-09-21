import type {
  E164PhoneNumber,
  ProviderLocaleCode,
  WhatsAppMessageId,
  WhatsAppRecipient,
} from './brands.js';
import type { KnownOr, MessagingProduct } from './common.js';

/**
 * Request and response contracts for `POST /{version}/{phone-number-id}/messages`.
 *
 * Only the message types Assure sends are modelled. Meta's endpoint accepts a
 * dozen more — audio, video, location, contacts, stickers, orders, flows — and
 * they are left out rather than typed speculatively: an unused union arm is a
 * maintenance liability that drifts out of sync with the provider unseen.
 */

/** Reply context — quotes an earlier message in the thread. */
export interface MessageContext {
  message_id: WhatsAppMessageId;
}

/**
 * A media reference. Exactly one of `id` or `link` is set.
 *
 * `link` makes Meta fetch the URL from its own servers, so a caller-supplied
 * link is a server-side request Meta performs on the caller's behalf. Treat it
 * as an SSRF surface: see the threat model.
 */
export type MediaObject = { id: string; link?: never } | { link: string; id?: never };

/** Fields every outbound message carries. */
interface OutboundMessageBase {
  messaging_product: MessagingProduct;
  /**
   * `individual` for a single destination. Meta also documents `group`, which
   * these packages do not send.
   */
  recipient_type?: 'individual';
  /**
   * The destination. Either representation is accepted by Meta; Assure passes
   * E.164 and lets the provider echo back its digits-only form.
   */
  to: E164PhoneNumber | WhatsAppRecipient;
  context?: MessageContext;
  /**
   * Opaque caller-supplied correlation value. Meta echoes it verbatim on every
   * status webhook for this message, which makes it the cleanest join key for
   * a durable job — and, for exactly that reason, a place where a careless
   * caller could park a tenant ID or an OTP. Put an opaque job ID here.
   */
  biz_opaque_callback_data?: string;
}

// --- Text -------------------------------------------------------------------

export interface TextMessageContent {
  body: string;
  /** Whether Meta renders a link preview for a URL in `body`. */
  preview_url?: boolean;
}

/**
 * A free-form text message.
 *
 * Only deliverable inside an open customer-service window. This package types
 * the request; it does not and cannot know whether the window is open — a send
 * outside it fails at the provider with a 131047-class error.
 */
export interface TextMessageRequest extends OutboundMessageBase {
  type: 'text';
  text: TextMessageContent;
}

// --- Template ---------------------------------------------------------------

/** Documented parameter types for template components. */
export type TemplateParameterType =
  'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';

/** A positional or named text substitution. */
export interface TemplateTextParameter {
  type: 'text';
  text: string;
  /**
   * Set only when the template's `parameter_format` is `NAMED`. Mixing named
   * and positional parameters in one component is rejected by Meta.
   */
  parameter_name?: string;
}

/** A localized currency amount. `amount_1000` is the value times 1000. */
export interface TemplateCurrencyParameter {
  type: 'currency';
  currency: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  parameter_name?: string;
}

/**
 * A localized date/time.
 *
 * Meta renders `fallback_value` as-is in practice; the structured component
 * fields it once documented are not relied on here.
 */
export interface TemplateDateTimeParameter {
  type: 'date_time';
  date_time: {
    fallback_value: string;
  };
  parameter_name?: string;
}

/** A media parameter, used by templates whose header is IMAGE/VIDEO/DOCUMENT. */
export type TemplateMediaParameter =
  | { type: 'image'; image: MediaObject }
  | { type: 'video'; video: MediaObject }
  | { type: 'document'; document: MediaObject & { filename?: string } };

/** Any documented parameter an Assure template component may carry. */
export type TemplateParameter =
  | TemplateTextParameter
  | TemplateCurrencyParameter
  | TemplateDateTimeParameter
  | TemplateMediaParameter;

/** Header component. Media headers take exactly one media parameter. */
export interface TemplateHeaderComponent {
  type: 'header';
  parameters: TemplateParameter[];
}

/** Body component. Parameter order must match the template's placeholders. */
export interface TemplateBodyComponent {
  type: 'body';
  parameters: TemplateParameter[];
}

/**
 * A button component.
 *
 * `index` is the button's zero-based position **in the approved template**, as
 * a string. Meta matches on the index, not on the label, so reordering buttons
 * in the template without updating callers silently sends the wrong payload to
 * the wrong button.
 */
export type TemplateButtonComponent =
  | {
      type: 'button';
      sub_type: 'quick_reply';
      index: string;
      parameters: [{ type: 'payload'; payload: string }];
    }
  | {
      type: 'button';
      sub_type: 'url';
      index: string;
      /** Substituted into the approved URL's trailing `{{1}}` placeholder. */
      parameters: [{ type: 'text'; text: string }];
    }
  | {
      type: 'button';
      sub_type: 'copy_code';
      index: string;
      parameters: [{ type: 'coupon_code'; coupon_code: string }];
    };

export type TemplateComponent =
  TemplateHeaderComponent | TemplateBodyComponent | TemplateButtonComponent;

export interface TemplateMessageContent {
  name: string;
  language: {
    /**
     * The template's locale, exactly as approved. Never derived from an Assure
     * locale by string substitution — see `AssureLocale`.
     */
    code: ProviderLocaleCode;
    /**
     * `deterministic` delivers the named locale or fails. Meta's `policy`
     * field is legacy; `deterministic` is the only value that is safe for
     * verification traffic, where the wrong language is a failed login.
     */
    policy?: 'deterministic';
  };
  components?: TemplateComponent[];
}

/** A template message — the only kind deliverable outside a service window. */
export interface TemplateMessageRequest extends OutboundMessageBase {
  type: 'template';
  template: TemplateMessageContent;
}

// --- Interactive ------------------------------------------------------------

export interface InteractiveBody {
  text: string;
}

export interface InteractiveFooter {
  text: string;
}

export type InteractiveHeader =
  | { type: 'text'; text: string }
  | { type: 'image'; image: MediaObject }
  | { type: 'document'; document: MediaObject }
  | { type: 'video'; video: MediaObject };

/** A reply button. `id` comes back on the webhook; `title` is what the user sees. */
export interface InteractiveReplyButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

/** A row inside a list section. */
export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveListSection {
  title?: string;
  rows: InteractiveListRow[];
}

/**
 * Reply buttons — the shape Assure uses for "Not me" and "Need help".
 *
 * Meta allows at most three buttons; the tuple below does not encode that
 * limit, because a hard cap in the type would break the moment Meta raises it.
 * `validateInteractiveMessage` checks it at runtime instead.
 */
export interface InteractiveButtonAction {
  buttons: InteractiveReplyButton[];
}

export interface InteractiveListAction {
  button: string;
  sections: InteractiveListSection[];
}

export type InteractiveContent =
  | {
      type: 'button';
      header?: InteractiveHeader;
      body: InteractiveBody;
      footer?: InteractiveFooter;
      action: InteractiveButtonAction;
    }
  | {
      type: 'list';
      header?: InteractiveHeader;
      body: InteractiveBody;
      footer?: InteractiveFooter;
      action: InteractiveListAction;
    };

/** An interactive message. In-window only, like text. */
export interface InteractiveMessageRequest extends OutboundMessageBase {
  type: 'interactive';
  interactive: InteractiveContent;
}

// --- Union ------------------------------------------------------------------

/** Every message shape these packages will send. Discriminated on `type`. */
export type OutboundMessageRequest =
  TextMessageRequest | TemplateMessageRequest | InteractiveMessageRequest;

/** `POST /{phone-number-id}/messages` with `status: "read"`. */
export interface MarkMessageReadRequest {
  messaging_product: MessagingProduct;
  status: 'read';
  message_id: WhatsAppMessageId;
}

// --- Responses --------------------------------------------------------------

/**
 * The provider's acceptance status for a message it took.
 *
 * All three mean "accepted for processing". None of them means delivered, and
 * none of them means the recipient saw anything.
 */
export type MessageAcceptanceStatus = 'accepted' | 'held_for_quality_assessment' | 'paused';

export const MESSAGE_ACCEPTANCE_STATUSES: readonly MessageAcceptanceStatus[] = [
  'accepted',
  'held_for_quality_assessment',
  'paused',
];

export interface SendMessageResponseContact {
  /** The destination exactly as it was submitted. */
  input: string;
  /** The provider's canonical ID for that user. May differ from `input`. */
  wa_id: WhatsAppRecipient;
}

export interface SendMessageResponseMessage {
  id: WhatsAppMessageId;
  message_status?: KnownOr<MessageAcceptanceStatus>;
}

/** The 200 body of a successful send. */
export interface SendMessageResponse {
  messaging_product: MessagingProduct;
  contacts?: SendMessageResponseContact[];
  messages?: SendMessageResponseMessage[];
}

/** The 200 body of a successful read receipt. */
export interface MarkMessageReadResponse {
  success: boolean;
}
