import { describe, expect, it } from 'vitest';
import {
  computeSignatureHeader,
  normalizeWebhookPayload,
  parseWebhookPayload,
  receiveWebhook,
  sha256Hex,
  summarizeEvents,
  toSafeEventMetadata,
} from '../src/index.js';
import {
  INBOUND_MESSAGE_ID,
  OUTBOUND_MESSAGE_ID,
  PHONE_NUMBER_ID,
  TEST_APP_SECRET,
  USER_NUMBER,
  WABA_ID,
  accountUpdatePayload,
  batchedPayload,
  encode,
  inboundTextPayload,
  interactiveButtonReplyPayload,
  interactiveListReplyPayload,
  phoneQualityPayload,
  statusDeliveredPayload,
  statusFailedPayload,
  statusPlayedPayload,
  statusReadPayload,
  statusSentPayload,
  templateApprovedPayload,
  templateQuickReplyPayload,
  templateRejectedPayload,
  unknownFieldPayload,
} from './fixtures/payloads.js';

/** Verify and normalize a fixture the way a real endpoint would. */
async function receive(payload: unknown) {
  const rawBody = encode(payload);
  return receiveWebhook({
    rawBody,
    signatureHeader: await computeSignatureHeader(TEST_APP_SECRET, rawBody),
    appSecret: TEST_APP_SECRET,
  });
}

/** Normalize a fixture, asserting the verified path succeeded. */
async function events(payload: unknown) {
  const result = await receive(payload);
  if (!result.ok) throw new Error(`unexpected failure at ${result.stage}: ${result.message}`);
  return result.events;
}

describe('receiveWebhook', () => {
  it('refuses to reach the parse stage without a valid signature', async () => {
    const rawBody = encode(inboundTextPayload);
    const result = await receiveWebhook({
      rawBody,
      signatureHeader: `sha256=${'0'.repeat(64)}`,
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, stage: 'signature', reason: 'mismatch' });
  });

  it('returns the verified bytes for archival', async () => {
    const result = await receive(inboundTextPayload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await sha256Hex(result.rawBody)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a parse failure distinctly from a signature failure', async () => {
    const rawBody = new TextEncoder().encode('{not json');
    const result = await receiveWebhook({
      rawBody,
      signatureHeader: await computeSignatureHeader(TEST_APP_SECRET, rawBody),
      appSecret: TEST_APP_SECRET,
    });
    expect(result).toMatchObject({ ok: false, stage: 'parse', reason: 'malformed_json' });
  });
});

describe('normalization — inbound', () => {
  it('normalizes an inbound text message', async () => {
    const [event] = await events(inboundTextPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.message.received',
      wabaId: WABA_ID,
      messageId: INBOUND_MESSAGE_ID,
      from: USER_NUMBER,
      messageType: 'text',
      occurredAt: '2025-06-08T20:59:43.000Z',
      rawTimestamp: '1749416383',
    });
    expect(event?.phone).toEqual({
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhoneNumber: '15555550100',
    });
  });

  it('normalizes an interactive button reply to its business-assigned id', async () => {
    const [event] = await events(interactiveButtonReplyPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.interaction.received',
      interactionType: 'button_reply',
      replyId: 'not_me',
    });
  });

  it('normalizes an interactive list reply', async () => {
    const [event] = await events(interactiveListReplyPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.interaction.received',
      interactionType: 'list_reply',
      replyId: 'need_help',
    });
  });

  it('normalizes a template quick-reply tap, which has a different shape', async () => {
    const [event] = await events(templateQuickReplyPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.interaction.received',
      interactionType: 'template_quick_reply',
      replyId: 'not_me',
    });
  });

  it('carries the quoted message id on a reply', async () => {
    const [event] = await events(interactiveButtonReplyPayload);
    expect(event).toHaveProperty('inReplyTo');
  });

  it('never routes an interaction to a verification-shaped field', async () => {
    // Guards rule 1 of normalization: a tapped button is a transport fact.
    const [event] = await events(interactiveButtonReplyPayload);
    const keys = Object.keys(event ?? {});
    for (const forbidden of ['verified', 'assurance', 'otp', 'passkey', 'tenant', 'tenantId']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('normalization — status', () => {
  it.each([
    ['sent', statusSentPayload, 'whatsapp.message.status.sent'],
    ['delivered', statusDeliveredPayload, 'whatsapp.message.status.delivered'],
    ['read', statusReadPayload, 'whatsapp.message.status.read'],
    ['failed', statusFailedPayload, 'whatsapp.message.status.failed'],
  ])('normalizes a %s status', async (status, payload, kind) => {
    const [event] = await events(payload);
    expect(event).toMatchObject({
      kind,
      messageId: OUTBOUND_MESSAGE_ID,
      recipientId: USER_NUMBER,
      providerStatus: status,
    });
  });

  it('preserves provider error codes and details on a failure', async () => {
    const [event] = await events(statusFailedPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.message.status.failed',
      errors: [
        {
          code: 131049,
          title: 'This message was not delivered to maintain healthy ecosystem engagement.',
        },
      ],
    });
  });

  it('carries the caller callback data through for reconciliation', async () => {
    const [event] = await events(statusSentPayload);
    expect(event).toMatchObject({ callbackData: 'job_01HXYZ' });
  });

  it('reads the conversation category from either conversation or pricing', async () => {
    const [event] = await events(statusSentPayload);
    expect(event).toMatchObject({ conversationCategory: 'authentication' });
  });

  it('handles the v24.0 shape with conversation and pricing omitted', async () => {
    const [event] = await events(statusReadPayload);
    expect(event).toMatchObject({ kind: 'whatsapp.message.status.read' });
    expect(event).not.toHaveProperty('conversationCategory');
  });

  it('surfaces a documented-but-unmapped status as unknown rather than dropping it', async () => {
    const [event] = await events(statusPlayedPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.unknown',
      field: 'messages',
      reason: 'unmodelled-variant',
    });
    // Still inspectable: the original change is attached.
    expect(event?.provider).toBeDefined();
  });

  it('gives sent and delivered for one message distinct deduplication keys', async () => {
    const [sent] = await events(statusSentPayload);
    const [delivered] = await events(statusDeliveredPayload);
    expect(sent?.deduplicationKeys[0]).not.toBe(delivered?.deduplicationKeys[0]);
    expect(sent?.deduplicationKeys[0]).toContain(OUTBOUND_MESSAGE_ID);
  });

  it('gives a repeated identical delivery identical deduplication keys', async () => {
    const [first] = await events(statusDeliveredPayload);
    const [second] = await events(statusDeliveredPayload);
    expect(first?.deduplicationKeys).toEqual(second?.deduplicationKeys);
  });

  it('preserves receipt order rather than sorting by timestamp', async () => {
    // Meta guarantees no ordering. Re-sorting here would hide out-of-order
    // arrival from the layer that owns the state machine.
    const normalized = await events(batchedPayload);
    expect(normalized[0]).toMatchObject({ kind: 'whatsapp.message.status.read' });
    expect(normalized[1]).toMatchObject({ kind: 'whatsapp.message.status.sent' });
    expect(normalized[2]).toMatchObject({ kind: 'whatsapp.template.status.updated' });
  });
});

describe('normalization — account-level fields', () => {
  it('normalizes a template approval, stringifying the numeric template id', async () => {
    const [event] = await events(templateApprovedPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.template.status.updated',
      templateId: '1689556908129832',
      templateName: 'example_template',
      templateLanguage: 'en_US',
      event: 'APPROVED',
      category: 'AUTHENTICATION',
    });
    expect(typeof (event as { templateId: unknown }).templateId).toBe('string');
  });

  it('prefers the richer rejection_info reason when present', async () => {
    const [event] = await events(templateRejectedPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.template.status.updated',
      event: 'REJECTED',
      reason: 'Your template has parameters placed next to each other.',
    });
  });

  it('uses entry.time for account-level events, which carry no value timestamp', async () => {
    const [event] = await events(templateApprovedPayload);
    expect(event).toMatchObject({ rawTimestamp: 1751247548 });
    expect(event?.occurredAt).toBe('2025-06-30T01:39:08.000Z');
  });

  it('normalizes a throughput change without inventing a phone number id', async () => {
    const [event] = await events(phoneQualityPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.phone.status.updated',
      event: 'THROUGHPUT_UPGRADE',
      currentLimit: 'TIER_UNLIMITED',
    });
    // The payload identifies the number by display form only.
    expect(event?.phone.phoneNumberId).toBeUndefined();
    expect(event?.phone.displayPhoneNumber).toBe('15555550100');
  });

  it('normalizes an account update', async () => {
    const [event] = await events(accountUpdatePayload);
    expect(event).toMatchObject({ kind: 'whatsapp.account.updated', event: 'VERIFIED_ACCOUNT' });
  });

  it('keeps an unmodelled field observable instead of crashing or discarding', async () => {
    const [event] = await events(unknownFieldPayload);
    expect(event).toMatchObject({
      kind: 'whatsapp.unknown',
      field: 'some_future_field_2027',
      reason: 'unmodelled-field',
    });
    expect(event?.provider).toMatchObject({ field: 'some_future_field_2027' });
  });
});

describe('normalization — resilience', () => {
  it('does not stamp a fabricated timestamp on a payload missing one', () => {
    const parsed = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '1', phone_number_id: PHONE_NUMBER_ID },
                  messages: [{ from: USER_NUMBER, id: INBOUND_MESSAGE_ID, type: 'text' }],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [event] = normalizeWebhookPayload(parsed.payload);
    expect(event?.occurredAt).toBeUndefined();
  });

  it('ignores an out-of-range timestamp rather than producing a wrong date', () => {
    const parsed = parseWebhookPayload(
      encode({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '1', phone_number_id: PHONE_NUMBER_ID },
                  // Milliseconds, not seconds — a schema change, not something
                  // to rescale on a guess.
                  messages: [
                    {
                      from: USER_NUMBER,
                      id: INBOUND_MESSAGE_ID,
                      type: 'text',
                      timestamp: '1749416383000',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error('fixture should parse');
    const [event] = normalizeWebhookPayload(parsed.payload);
    expect(event?.occurredAt).toBeUndefined();
    expect(event?.rawTimestamp).toBe('1749416383000');
  });
});

describe('redaction', () => {
  it('omits destinations, names, and content from safe metadata', async () => {
    const all = await events(inboundTextPayload);
    const metadata = toSafeEventMetadata(all[0]!);
    const serialized = JSON.stringify(metadata);

    expect(serialized).not.toContain(USER_NUMBER);
    expect(serialized).not.toContain('Example Person');
    expect(serialized).not.toContain('another color');
    expect(serialized).not.toContain('15555550100');
    expect(metadata).toMatchObject({ kind: 'whatsapp.message.received', wabaId: WABA_ID });
  });

  it('truncates the message id, which encodes the destination', async () => {
    const [event] = await events(inboundTextPayload);
    const metadata = toSafeEventMetadata(event!);
    expect(metadata.messageIdPrefix).toBe(INBOUND_MESSAGE_ID.slice(0, 24));
    expect(metadata.messageIdPrefix!.length).toBeLessThan(INBOUND_MESSAGE_ID.length);
  });

  it('keeps error codes but not their human-readable details', async () => {
    const [event] = await events(statusFailedPayload);
    const metadata = toSafeEventMetadata(event!);
    expect(metadata.errorCodes).toEqual([131049]);
    expect(JSON.stringify(metadata)).not.toContain('healthy ecosystem');
  });

  it('omits caller callback data, which may carry anything', async () => {
    const [event] = await events(statusSentPayload);
    expect(JSON.stringify(toSafeEventMetadata(event!))).not.toContain('job_01HXYZ');
  });

  it('summarizes a batch with counts and no identifiers at all', async () => {
    const summary = summarizeEvents(await events(batchedPayload));
    expect(summary).toEqual({
      'whatsapp.message.status.read': 1,
      'whatsapp.message.status.sent': 1,
      'whatsapp.template.status.updated': 1,
    });
    expect(JSON.stringify(summary)).not.toContain(USER_NUMBER);
  });
});
