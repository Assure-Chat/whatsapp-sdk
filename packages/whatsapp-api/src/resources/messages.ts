import type {
  E164PhoneNumber,
  InteractiveContent,
  MarkMessageReadResponse,
  MessageContext,
  PhoneNumberId,
  SendMessageResponse,
  TemplateMessageContent,
  TextMessageContent,
  WhatsAppMessageId,
  WhatsAppRecipient,
} from '@assure-ai/whatsapp-types';
import { asPhoneNumberId, asWhatsAppMessageId } from '@assure-ai/whatsapp-types';
import type { HttpClient } from '../http.js';
import {
  validateInteractiveContent,
  validateSendResponse,
  validateTemplateContent,
} from '../validate.js';

/**
 * `POST /{version}/{phone-number-id}/messages`.
 *
 * **Nothing here is ever retried automatically.** Meta's send endpoint has no
 * idempotency key, so the client cannot make a replay safe and does not
 * pretend otherwise. A send that fails after dispatch raises
 * `WhatsAppAmbiguousOutcomeError`; reconcile against status webhooks before
 * deciding whether to send again.
 *
 * Attaching `callbackData` to every send makes that reconciliation possible:
 * Meta echoes it verbatim on every status webhook for the message, so a
 * durable job can match an outcome to the attempt that produced it.
 */

/** Options every send shares. */
export interface SendOptions {
  /** The business phone number to send from. */
  phoneNumberId: PhoneNumberId;
  /** The destination. */
  to: E164PhoneNumber | WhatsAppRecipient;
  /** Quote an earlier message. */
  context?: MessageContext;
  /**
   * An opaque correlation value echoed on every status webhook.
   *
   * Use a job ID. Do not put a tenant identifier, a user identifier, an OTP,
   * or anything else meaningful here — Meta stores it and returns it, and a
   * webhook payload is not a place to put data you would not want kept.
   */
  callbackData?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const SEND_OPERATION = 'POST /{phone-number-id}/messages';

export class MessagesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Send an approved template message.
   *
   * The only kind deliverable outside a customer-service window, and the kind
   * Assure's verification traffic uses.
   *
   * ```ts
   * await client.messages.sendTemplate({
   *   phoneNumberId,
   *   to: asE164PhoneNumber('+15555550123'),
   *   template: {
   *     name: 'example_template',
   *     language: { code: locales.require('en-US'), policy: 'deterministic' },
   *     components: [{ type: 'body', parameters: [{ type: 'text', text: '123456' }] }],
   *   },
   *   callbackData: jobId,
   * });
   * ```
   */
  async sendTemplate(
    options: SendOptions & { template: TemplateMessageContent },
  ): Promise<SendMessageResponse> {
    validateTemplateContent(options.template);
    return this.#send(options, { type: 'template', template: options.template });
  }

  /**
   * Send a free-form text message.
   *
   * Deliverable only inside an open 24-hour customer-service window, which
   * this client cannot see. Calling it outside one fails at the provider.
   */
  async sendText(
    options: SendOptions & { text: TextMessageContent },
  ): Promise<SendMessageResponse> {
    return this.#send(options, { type: 'text', text: options.text });
  }

  /**
   * Send an interactive message — reply buttons or a list.
   *
   * In-window only, like text. Used for "Not me" and help flows, where the
   * reply's `id` comes back on the webhook as a stable routing key.
   */
  async sendInteractive(
    options: SendOptions & { interactive: InteractiveContent },
  ): Promise<SendMessageResponse> {
    validateInteractiveContent(options.interactive);
    return this.#send(options, { type: 'interactive', interactive: options.interactive });
  }

  /**
   * Mark an inbound message as read.
   *
   * A courtesy to the user — it turns on the blue checkmarks in their client.
   * It is a mutation and so is never retried, but losing one is harmless.
   */
  async markRead(options: {
    phoneNumberId: PhoneNumberId;
    messageId: WhatsAppMessageId;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<MarkMessageReadResponse> {
    const phoneNumberId = asPhoneNumberId(options.phoneNumberId);
    const messageId = asWhatsAppMessageId(options.messageId);
    return this.#http.request<MarkMessageReadResponse>({
      method: 'POST',
      path: `${phoneNumberId}/messages`,
      operation: SEND_OPERATION,
      mutation: true,
      body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  async #send(
    options: SendOptions,
    payload: Record<string, unknown>,
  ): Promise<SendMessageResponse> {
    // Validated before URL construction: the ID becomes a path segment, and a
    // path segment built from an unvalidated string is how traversal happens.
    const phoneNumberId = asPhoneNumberId(options.phoneNumberId);

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: options.to,
      ...payload,
    };
    if (options.context !== undefined) body['context'] = options.context;
    if (options.callbackData !== undefined) {
      body['biz_opaque_callback_data'] = options.callbackData;
    }

    const response = await this.#http.request<unknown>({
      method: 'POST',
      path: `${phoneNumberId}/messages`,
      operation: SEND_OPERATION,
      mutation: true,
      body,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });

    return validateSendResponse(response, SEND_OPERATION);
  }
}
