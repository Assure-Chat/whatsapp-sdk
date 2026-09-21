import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  MESSAGE_DELIVERY_STATUSES,
  NORMALIZED_EVENT_KINDS,
  TEMPLATE_STATUSES,
  isKnown,
  type InteractiveMessageRequest,
  type KnownOr,
  type MessageDeliveryStatus,
  type NormalizedWhatsAppEvent,
  type OutboundMessageRequest,
  type TemplateMessageRequest,
  type TemplateStatus,
  type TextMessageRequest,
  type WhatsAppConnectionMetadata,
} from '../src/index.js';

describe('extensible enums', () => {
  it('narrows a documented value', () => {
    const status: KnownOr<MessageDeliveryStatus> = 'delivered';
    if (isKnown(status, MESSAGE_DELIVERY_STATUSES)) {
      expectTypeOf(status).toEqualTypeOf<MessageDeliveryStatus>();
      expect(status).toBe('delivered');
    } else {
      throw new Error('delivered should be a known status');
    }
  });

  it('lets an undocumented provider value through instead of crashing', () => {
    // The failure mode this prevents: Meta ships a new status, a closed union
    // makes it a type error, and a webhook handler throws on live traffic.
    const status: KnownOr<MessageDeliveryStatus> = 'teleported';
    expect(isKnown(status, MESSAGE_DELIVERY_STATUSES)).toBe(false);
    expect(status).toBe('teleported');
  });

  it('includes the easily-missed documented values', () => {
    // `played` is documented for voice messages and is the value most
    // implementations forget.
    expect(MESSAGE_DELIVERY_STATUSES).toContain('played');
    expect(MESSAGE_DELIVERY_STATUSES).toContain('failed');
    expect(TEMPLATE_STATUSES).toContain('PENDING_DELETION');
    expect(TEMPLATE_STATUSES).toContain('IN_APPEAL');
  });

  it('accepts a documented template status and an unknown one alike', () => {
    const known: KnownOr<TemplateStatus> = 'APPROVED';
    const future: KnownOr<TemplateStatus> = 'SOMETHING_NEW_IN_2027';
    expect(isKnown(known, TEMPLATE_STATUSES)).toBe(true);
    expect(isKnown(future, TEMPLATE_STATUSES)).toBe(false);
  });
});

describe('message discriminated union', () => {
  it('discriminates on `type` exhaustively', () => {
    const describe_ = (message: OutboundMessageRequest): string => {
      switch (message.type) {
        case 'text':
          expectTypeOf(message).toEqualTypeOf<TextMessageRequest>();
          return message.text.body;
        case 'template':
          expectTypeOf(message).toEqualTypeOf<TemplateMessageRequest>();
          return message.template.name;
        case 'interactive':
          expectTypeOf(message).toEqualTypeOf<InteractiveMessageRequest>();
          return message.interactive.type;
        default: {
          // Fails to compile if an arm is added without a branch here.
          const exhaustive: never = message;
          return exhaustive;
        }
      }
    };

    expect(
      describe_({
        messaging_product: 'whatsapp',
        to: '15555550123' as never,
        type: 'text',
        text: { body: 'hello' },
      }),
    ).toBe('hello');
  });

  it('does not accept a loose record as a message', () => {
    expectTypeOf<Record<string, unknown>>().not.toMatchTypeOf<OutboundMessageRequest>();
  });

  it('requires the template language code to be a branded locale', () => {
    expectTypeOf<{ name: string; language: { code: string } }>().not.toMatchTypeOf<
      TemplateMessageRequest['template']
    >();
  });
});

describe('normalized events', () => {
  it('discriminates exhaustively on `kind`', () => {
    const route = (event: NormalizedWhatsAppEvent): string => {
      switch (event.kind) {
        case 'whatsapp.message.received':
        case 'whatsapp.interaction.received':
          return 'inbound';
        case 'whatsapp.message.status.sent':
        case 'whatsapp.message.status.delivered':
        case 'whatsapp.message.status.read':
          return 'status';
        case 'whatsapp.message.status.failed':
          return `failed:${event.errors.length}`;
        case 'whatsapp.template.status.updated':
          return event.templateName;
        case 'whatsapp.phone.status.updated':
        case 'whatsapp.account.updated':
          return 'account';
        case 'whatsapp.unknown':
          return `unknown:${event.field}`;
        default: {
          const exhaustive: never = event;
          return exhaustive;
        }
      }
    };
    expect(typeof route).toBe('function');
  });

  it('enumerates every kind in the exported constant', () => {
    expect(NORMALIZED_EVENT_KINDS).toHaveLength(10);
    expect(new Set(NORMALIZED_EVENT_KINDS).size).toBe(NORMALIZED_EVENT_KINDS.length);
  });

  it('carries no Assure verification concept on any event', () => {
    // A compile-time guard on the most dangerous possible mistake at this
    // boundary: reading a delivery receipt as proof of verification.
    type EventKeys = keyof NormalizedWhatsAppEvent;
    expectTypeOf<'verified'>().not.toMatchTypeOf<EventKeys>();
    expectTypeOf<'assuranceLevel'>().not.toMatchTypeOf<EventKeys>();
    expectTypeOf<'otpValid'>().not.toMatchTypeOf<EventKeys>();
    expectTypeOf<'passkeyResult'>().not.toMatchTypeOf<EventKeys>();
    expectTypeOf<'tenantId'>().not.toMatchTypeOf<EventKeys>();
    expectTypeOf<'environment'>().not.toMatchTypeOf<EventKeys>();
  });
});

describe('connection metadata', () => {
  it('has no property that could carry a secret', () => {
    type Keys = keyof WhatsAppConnectionMetadata;
    expectTypeOf<'accessToken'>().not.toMatchTypeOf<Keys>();
    expectTypeOf<'appSecret'>().not.toMatchTypeOf<Keys>();
    expectTypeOf<'verifyToken'>().not.toMatchTypeOf<Keys>();
    expectTypeOf<'pin'>().not.toMatchTypeOf<Keys>();
  });

  it('serializes to exactly the declared fields', () => {
    const metadata: WhatsAppConnectionMetadata = {
      graphApiVersion: 'v24.0' as never,
      baseUrl: 'https://graph.facebook.com',
    };
    expect(JSON.parse(JSON.stringify(metadata))).toEqual({
      graphApiVersion: 'v24.0',
      baseUrl: 'https://graph.facebook.com',
    });
  });
});
