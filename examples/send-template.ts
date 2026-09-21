/**
 * Send an approved template message.
 *
 * The important part is not the send — it is the shape around it. A send has
 * three distinct failure modes and they need three different responses.
 */

import {
  asE164PhoneNumber,
  asPhoneNumberId,
  createLocaleMap,
  createWhatsAppClient,
  isAmbiguousOutcome,
  isWhatsAppApiError,
  type WhatsAppError,
} from '@assure-ai/whatsapp-api';

// Built once at startup. Provider codes are validated here, so a typo in
// configuration fails at boot rather than on the first send in that language.
const locales = createLocaleMap({
  'en-US': 'en_US',
  'es-MX': 'es_MX',
  'pt-BR': 'pt_BR',
});

declare const secrets: { get(tenantId: string, key: string): Promise<string> };
declare const jobs: {
  markDispatching(id: string): Promise<void>;
  markSent(id: string, messageId?: string): Promise<void>;
  markNeedsReconciliation(id: string): Promise<void>;
  scheduleRetry(id: string, delayMs: number): Promise<void>;
  markFailed(id: string, detail: Record<string, unknown>): Promise<void>;
};

interface VerificationJob {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  destination: string; // E.164
  locale: string; // BCP 47
  code: string;
}

export async function sendVerification(job: VerificationJob): Promise<void> {
  const client = createWhatsAppClient({
    // Per tenant, per request. Never a module-level client.
    accessToken: await secrets.get(job.tenantId, 'WA_ACCESS_TOKEN'),
    // Pinned deliberately. No default, no `latest`.
    graphApiVersion: 'v24.0',
    timeoutMs: 15_000,
  });

  // Record the attempt BEFORE dispatch. If this process dies mid-send, this is
  // what tells the reconciler a message may exist.
  await jobs.markDispatching(job.id);

  try {
    const response = await client.messages.sendTemplate({
      phoneNumberId: asPhoneNumberId(job.phoneNumberId),
      to: asE164PhoneNumber(job.destination),
      template: {
        name: 'example_template',
        language: {
          // Explicit mapping. Throws for an unmapped locale rather than
          // guessing — a wrong guess sends a code nobody can read.
          code: locales.require(job.locale),
          policy: 'deterministic',
        },
        components: [{ type: 'body', parameters: [{ type: 'text', text: job.code }] }],
      },
      // Echoed verbatim on every status webhook for this message. The join key
      // reconciliation needs. An opaque job ID — never a tenant ID or the code.
      callbackData: job.id,
    });

    await jobs.markSent(job.id, response.messages?.[0]?.id);
  } catch (error) {
    // 1. The message may or may not exist. Do NOT re-send.
    if (isAmbiguousOutcome(error)) {
      await jobs.markNeedsReconciliation(job.id);
      return;
    }

    // 2. The provider refused in a way that could succeed later.
    if (isWhatsAppApiError(error) && error.retryable) {
      await jobs.scheduleRetry(job.id, error.retryAfterMs ?? 30_000);
      return;
    }

    // 3. Terminal. Record the classification, not the error's full text.
    await jobs.markFailed(job.id, {
      classification: (error as WhatsAppError).classification,
    });
  }
}
