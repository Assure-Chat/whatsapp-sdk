/**
 * Webhook fixtures.
 *
 * Structure follows Meta's published webhook references; every value is a
 * placeholder. Source documents and the date they were read are recorded in
 * `docs/maintainers.md`.
 *
 * Nothing real appears here: destinations are `1555555xxxx` reserved-style
 * numbers, profile names are generic, WABA and phone-number IDs are made up,
 * and message IDs are structurally valid `wamid.` strings that decode to
 * nothing. No token, secret, or customer datum is in this file or in any
 * snapshot derived from it.
 */

/** The app secret used across the test suite. A literal, not a real secret. */
export const TEST_APP_SECRET = 'test_app_secret_not_a_real_value';

export const WABA_ID = '102290129340398';
export const PHONE_NUMBER_ID = '106540352242922';
export const DISPLAY_PHONE_NUMBER = '15555550100';
export const USER_NUMBER = '15555550123';

export const INBOUND_MESSAGE_ID = 'wamid.HBgLMTU1NTU1NTAxMjMVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=';
export const OUTBOUND_MESSAGE_ID = 'wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA';
export const QUOTED_MESSAGE_ID = 'wamid.HBgLMTU1NTU1NTAxMDAVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=';

const metadata = {
  display_phone_number: DISPLAY_PHONE_NUMBER,
  phone_number_id: PHONE_NUMBER_ID,
};

const contacts = [{ profile: { name: 'Example Person' }, wa_id: USER_NUMBER }];

/** Wrap a `messages`-field value in the standard envelope. */
function messagesEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: WABA_ID, changes: [{ value, field: 'messages' }] }],
  };
}

/**
 * Wrap an account-level value.
 *
 * Note the envelope difference: `entry[].time` is present here and absent on
 * `messages`, and `value` carries no `messaging_product` or `metadata`.
 */
function accountEnvelope(field: string, value: Record<string, unknown>, time = 1751247548) {
  return {
    entry: [{ id: WABA_ID, time, changes: [{ value, field }] }],
    object: 'whatsapp_business_account',
  };
}

/** An inbound text message. */
export const inboundTextPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  contacts,
  messages: [
    {
      from: USER_NUMBER,
      id: INBOUND_MESSAGE_ID,
      timestamp: '1749416383',
      type: 'text',
      text: { body: 'Does it come in another color?' },
    },
  ],
});

/** A `sent` status, with the v23-and-below `conversation` object. */
export const statusSentPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  statuses: [
    {
      id: OUTBOUND_MESSAGE_ID,
      status: 'sent',
      timestamp: '1750030073',
      recipient_id: USER_NUMBER,
      biz_opaque_callback_data: 'job_01HXYZ',
      conversation: {
        id: '72b14d6bd5407799e66f64d1b338e567',
        expiration_timestamp: '1750116480',
        origin: { type: 'authentication' },
      },
      pricing: {
        billable: true,
        pricing_model: 'PMP',
        type: 'regular',
        category: 'authentication',
      },
    },
  ],
});

/** A `delivered` status. */
export const statusDeliveredPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  statuses: [
    {
      id: OUTBOUND_MESSAGE_ID,
      status: 'delivered',
      timestamp: '1750030080',
      recipient_id: USER_NUMBER,
      biz_opaque_callback_data: 'job_01HXYZ',
    },
  ],
});

/** A `read` status, in the v24.0 shape with `conversation` omitted. */
export const statusReadPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  statuses: [
    {
      id: OUTBOUND_MESSAGE_ID,
      status: 'read',
      timestamp: '1750030090',
      recipient_id: USER_NUMBER,
    },
  ],
});

/** A `failed` status carrying Meta's documented error shape. */
export const statusFailedPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  statuses: [
    {
      id: OUTBOUND_MESSAGE_ID,
      status: 'failed',
      timestamp: '1751142888',
      recipient_id: USER_NUMBER,
      errors: [
        {
          code: 131049,
          title: 'This message was not delivered to maintain healthy ecosystem engagement.',
          message: 'This message was not delivered to maintain healthy ecosystem engagement.',
          error_data: {
            details:
              'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
          },
          href: '/documentation/business-messaging/whatsapp/support/error-codes',
        },
      ],
    },
  ],
});

/** A tapped interactive reply button. */
export const interactiveButtonReplyPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  contacts,
  messages: [
    {
      context: { from: DISPLAY_PHONE_NUMBER, id: QUOTED_MESSAGE_ID },
      from: USER_NUMBER,
      id: INBOUND_MESSAGE_ID,
      timestamp: '1749854575',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'not_me', title: 'Not me' },
      },
    },
  ],
});

/** A selected interactive list row. */
export const interactiveListReplyPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  contacts,
  messages: [
    {
      context: { from: DISPLAY_PHONE_NUMBER, id: QUOTED_MESSAGE_ID },
      from: USER_NUMBER,
      id: INBOUND_MESSAGE_ID,
      timestamp: '1749854590',
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: {
          id: 'need_help',
          title: 'I need help',
          description: 'Talk to support',
        },
      },
    },
  ],
});

/** A quick-reply button tapped on a *template* message — a different shape. */
export const templateQuickReplyPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  contacts,
  messages: [
    {
      context: { from: DISPLAY_PHONE_NUMBER, id: QUOTED_MESSAGE_ID },
      from: USER_NUMBER,
      id: INBOUND_MESSAGE_ID,
      timestamp: '1750091045',
      type: 'button',
      button: { payload: 'not_me', text: 'Not me' },
    },
  ],
});

/** A template approval. */
export const templateApprovedPayload = accountEnvelope('message_template_status_update', {
  event: 'APPROVED',
  message_template_id: 1689556908129832,
  message_template_name: 'example_template',
  message_template_language: 'en_US',
  reason: 'NONE',
  message_template_category: 'AUTHENTICATION',
});

/** A template rejection, with the richer `rejection_info` block. */
export const templateRejectedPayload = accountEnvelope('message_template_status_update', {
  event: 'REJECTED',
  message_template_id: 1689556908129833,
  message_template_name: 'example_template',
  message_template_language: 'en_US',
  reason: 'INVALID_FORMAT',
  message_template_category: 'UTILITY',
  rejection_info: {
    reason: 'Your template has parameters placed next to each other.',
    recommendation: 'Separate parameters with descriptive text.',
  },
});

/** A throughput change. Identifies the number by display form only. */
export const phoneQualityPayload = accountEnvelope(
  'phone_number_quality_update',
  {
    display_phone_number: DISPLAY_PHONE_NUMBER,
    event: 'THROUGHPUT_UPGRADE',
    current_limit: 'TIER_UNLIMITED',
  },
  1748454394,
);

/** An account-level update. */
export const accountUpdatePayload = accountEnvelope('account_update', {
  event: 'VERIFIED_ACCOUNT',
  phone_number: DISPLAY_PHONE_NUMBER,
});

/** A field this package does not model, for the unknown-event path. */
export const unknownFieldPayload = accountEnvelope('some_future_field_2027', {
  event: 'SOMETHING_NEW',
  detail: 'a shape nobody has reviewed',
});

/** A `messages` change whose status value is documented but unmapped. */
export const statusPlayedPayload = messagesEnvelope({
  messaging_product: 'whatsapp',
  metadata,
  statuses: [
    {
      id: OUTBOUND_MESSAGE_ID,
      status: 'played',
      timestamp: '1750030095',
      recipient_id: USER_NUMBER,
    },
  ],
});

/** A batch carrying several entries and several changes, out of order. */
export const batchedPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: WABA_ID,
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata,
            statuses: [
              {
                id: OUTBOUND_MESSAGE_ID,
                status: 'read',
                timestamp: '1750030090',
                recipient_id: USER_NUMBER,
              },
              {
                id: OUTBOUND_MESSAGE_ID,
                status: 'sent',
                timestamp: '1750030073',
                recipient_id: USER_NUMBER,
              },
            ],
          },
        },
      ],
    },
    {
      id: WABA_ID,
      time: 1751247548,
      changes: [
        {
          field: 'message_template_status_update',
          value: {
            event: 'APPROVED',
            message_template_id: 1689556908129832,
            message_template_name: 'example_template',
            message_template_language: 'en_US',
          },
        },
      ],
    },
  ],
};

/** Encode a fixture the way Meta would put it on the wire. */
export function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}
