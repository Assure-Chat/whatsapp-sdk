import { describe, expect, it } from 'vitest';
import {
  WhatsAppValidationError,
  validateInteractiveContent,
  validateOutboundMessage,
  validateTemplateContent,
} from '../src/index.js';
import type {
  InteractiveContent,
  OutboundMessageRequest,
  TemplateMessageContent,
} from '@assure-ai/whatsapp-types';

const LOCALE = 'en_US' as never;

function template(overrides: Partial<TemplateMessageContent> = {}): TemplateMessageContent {
  return {
    name: 'example_template',
    language: { code: LOCALE },
    components: [{ type: 'body', parameters: [{ type: 'text', text: '123456' }] }],
    ...overrides,
  };
}

describe('validateTemplateContent', () => {
  it('accepts a well-formed template message', () => {
    expect(() => validateTemplateContent(template())).not.toThrow();
  });

  it('accepts currency and date_time parameters', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'currency',
                  currency: { fallback_value: '$10.00', code: 'USD', amount_1000: 10_000 },
                },
                { type: 'date_time', date_time: { fallback_value: 'February 25, 2027' } },
              ],
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['a missing name', template({ name: '' })],
    ['a missing language code', template({ language: { code: '' as never } })],
  ])('rejects %s', (_name, content) => {
    expect(() => validateTemplateContent(content)).toThrow(WhatsAppValidationError);
  });

  it('rejects two body components', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            { type: 'body', parameters: [{ type: 'text', text: 'a' }] },
            { type: 'body', parameters: [{ type: 'text', text: 'b' }] },
          ],
        }),
      ),
    ).toThrow(/at most one body/);
  });

  it('rejects a text parameter with no text', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [{ type: 'body', parameters: [{ type: 'text' } as never] }],
        }),
      ),
    ).toThrow(/requires a string/);
  });

  it('rejects a component mixing named and positional parameters', () => {
    // Meta accepts this sometimes and renders nothing where the parameter was.
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: '123456', parameter_name: 'code' },
                { type: 'text', text: '10' },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/mixes named and positional/);
  });

  it('rejects duplicate button indexes', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: 'a' }],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: 'b' }],
            },
          ],
        }),
      ),
    ).toThrow(/duplicate button index/);
  });

  it('rejects non-contiguous button indexes, which mis-target buttons', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: 'a' }],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '2',
              parameters: [{ type: 'text', text: 'x' }],
            },
          ],
        }),
      ),
    ).toThrow(/contiguous indexes/);
  });

  it('accepts contiguous button indexes in any declaration order', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            {
              type: 'button',
              sub_type: 'url',
              index: '1',
              parameters: [{ type: 'text', text: 'x' }],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: 'a' }],
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a non-numeric button index', () => {
    expect(() =>
      validateTemplateContent(
        template({
          components: [
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: 'first' as never,
              parameters: [{ type: 'payload', payload: 'a' }],
            },
          ],
        }),
      ),
    ).toThrow(/non-negative integer/);
  });
});

describe('validateInteractiveContent', () => {
  const buttons: InteractiveContent = {
    type: 'button',
    body: { text: 'Was this you?' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'yes_me', title: 'Yes, it was me' } },
        { type: 'reply', reply: { id: 'not_me', title: 'Not me' } },
      ],
    },
  };

  it('accepts a well-formed reply-button message', () => {
    expect(() => validateInteractiveContent(buttons)).not.toThrow();
  });

  it('rejects more than three reply buttons', () => {
    expect(() =>
      validateInteractiveContent({
        ...buttons,
        action: {
          buttons: Array.from({ length: 4 }, (_value, index) => ({
            type: 'reply' as const,
            reply: { id: `b${index}`, title: `Button ${index}` },
          })),
        },
      }),
    ).toThrow(/at most 3 reply buttons/);
  });

  it('rejects duplicate button ids, which make the webhook ambiguous', () => {
    expect(() =>
      validateInteractiveContent({
        ...buttons,
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'same', title: 'One' } },
            { type: 'reply', reply: { id: 'same', title: 'Two' } },
          ],
        },
      }),
    ).toThrow(/duplicate interactive button id/);
  });

  it('rejects a button with no id', () => {
    expect(() =>
      validateInteractiveContent({
        ...buttons,
        action: { buttons: [{ type: 'reply', reply: { id: '', title: 'x' } }] },
      }),
    ).toThrow(/requires `reply.id`/);
  });

  it('accepts a well-formed list message', () => {
    expect(() =>
      validateInteractiveContent({
        type: 'list',
        body: { text: 'Pick one' },
        action: {
          button: 'Options',
          sections: [{ title: 'Help', rows: [{ id: 'need_help', title: 'I need help' }] }],
        },
      }),
    ).not.toThrow();
  });

  it('rejects a list message over ten rows in total', () => {
    expect(() =>
      validateInteractiveContent({
        type: 'list',
        body: { text: 'Pick one' },
        action: {
          button: 'Options',
          sections: [
            {
              rows: Array.from({ length: 11 }, (_value, index) => ({
                id: `r${index}`,
                title: `Row ${index}`,
              })),
            },
          ],
        },
      }),
    ).toThrow(/at most 10 rows/);
  });

  it('rejects an empty body', () => {
    expect(() => validateInteractiveContent({ ...buttons, body: { text: '' } })).toThrow(
      /body.text is required/,
    );
  });
});

describe('validateOutboundMessage', () => {
  it('accepts each documented message shape', () => {
    const messages: OutboundMessageRequest[] = [
      {
        messaging_product: 'whatsapp',
        to: '15555550123' as never,
        type: 'text',
        text: { body: 'hi' },
      },
      {
        messaging_product: 'whatsapp',
        to: '15555550123' as never,
        type: 'template',
        template: template(),
      },
      {
        messaging_product: 'whatsapp',
        to: '15555550123' as never,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: 'Was this you?' },
          action: { buttons: [{ type: 'reply', reply: { id: 'not_me', title: 'Not me' } }] },
        },
      },
    ];
    for (const message of messages) {
      expect(() => validateOutboundMessage(message)).not.toThrow();
    }
  });

  it('rejects a wrong messaging_product', () => {
    expect(() =>
      validateOutboundMessage({
        messaging_product: 'sms' as never,
        to: '15555550123' as never,
        type: 'text',
        text: { body: 'hi' },
      }),
    ).toThrow(/messaging_product/);
  });

  it('rejects an unsupported message type rather than sending it', () => {
    expect(() =>
      validateOutboundMessage({
        messaging_product: 'whatsapp',
        to: '15555550123' as never,
        type: 'location',
      } as never),
    ).toThrow(/unhandled message type/);
  });

  it('never echoes the message body in a validation error', () => {
    const error = (() => {
      try {
        validateOutboundMessage({
          messaging_product: 'whatsapp',
          to: '15555550123' as never,
          type: 'template',
          template: template({ name: '' }),
        });
        return undefined;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error?.message).not.toContain('123456');
  });
});
