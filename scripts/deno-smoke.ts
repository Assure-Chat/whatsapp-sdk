/**
 * Deno / Supabase Edge compatibility smoke test.
 *
 * Runs the built ESM bundles under Deno with no network and no environment
 * access, exercising the paths that matter on an Edge runtime: Web Crypto
 * HMAC, the signature and challenge checks, normalization, and a full client
 * request against an injected `fetch`.
 *
 * Run with:
 *   deno run --allow-read scripts/deno-smoke.ts
 *
 * Deliberately granted no `--allow-net` and no `--allow-env`: if any package
 * reached for the network or an environment variable, Deno would refuse and
 * this script would fail.
 */

import {
  computeSignatureHeader,
  receiveWebhook,
  verifySubscriptionChallenge,
  verifyWebhookSignature,
} from '../packages/whatsapp-webhooks/dist/index.js';
import { createWhatsAppClient } from '../packages/whatsapp-api/dist/index.js';
import {
  asGraphApiVersion,
  asPhoneNumberId,
  asE164PhoneNumber,
} from '../packages/whatsapp-types/dist/index.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    console.error(`  FAIL ${name}`);
    failures += 1;
  }
}

const APP_SECRET = 'test_app_secret_not_a_real_value';

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15555550100', phone_number_id: '106540352242922' },
            statuses: [
              {
                id: 'wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA',
                status: 'delivered',
                timestamp: '1750030080',
                recipient_id: '15555550123',
              },
            ],
          },
        },
      ],
    },
  ],
};

console.log('Deno smoke test');
console.log(`  runtime: Deno ${Deno.version.deno}`);

// --- Web Crypto signature round trip ---------------------------------------
const rawBody = new TextEncoder().encode(JSON.stringify(payload));
const header = await computeSignatureHeader(APP_SECRET, rawBody);
check('computes a sha256= header via Web Crypto', /^sha256=[0-9a-f]{64}$/.test(header));

const verified = await verifyWebhookSignature({
  rawBody,
  signatureHeader: header,
  appSecret: APP_SECRET,
});
check('verifies a valid signature', verified.ok);

const tampered = Uint8Array.from(rawBody);
tampered[10] = (tampered[10] ?? 0) ^ 0x01;
const rejected = await verifyWebhookSignature({
  rawBody: tampered,
  signatureHeader: header,
  appSecret: APP_SECRET,
});
check('rejects a tampered body', !rejected.ok);

// --- Subscription challenge -------------------------------------------------
const challenge = verifySubscriptionChallenge({
  query: new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'a_configured_verify_token',
    'hub.challenge': '1158201444',
  }),
  expectedVerifyToken: 'a_configured_verify_token',
});
check('answers a correct challenge', challenge.ok && challenge.challenge === '1158201444');

// --- End-to-end receive -----------------------------------------------------
const received = await receiveWebhook({ rawBody, signatureHeader: header, appSecret: APP_SECRET });
check(
  'verifies, parses, and normalizes',
  received.ok && received.events[0]?.kind === 'whatsapp.message.status.delivered',
);

// --- Client with an injected fetch (no network permission granted) ----------
let capturedUrl = '';
let capturedAuth = '';
const client = createWhatsAppClient({
  accessToken: 'test_access_token_not_a_real_value',
  graphApiVersion: asGraphApiVersion('v24.0'),
  fetch: (input: string, init: RequestInit) => {
    capturedUrl = input;
    capturedAuth = (init.headers as Record<string, string>)['authorization'] ?? '';
    return Promise.resolve(
      new Response(
        JSON.stringify({
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  },
});

const sent = await client.messages.sendTemplate({
  phoneNumberId: asPhoneNumberId('106540352242922'),
  to: asE164PhoneNumber('+15555550123'),
  template: { name: 'example_template', language: { code: 'en_US' as never } },
});

check('sends a template through an injected fetch', sent.messages?.[0]?.id !== undefined);
check('builds the pinned-version URL', capturedUrl.includes('/v24.0/106540352242922/messages'));
check(
  'sends the token as a bearer header, not a query parameter',
  capturedAuth.startsWith('Bearer ') && !capturedUrl.includes('access_token'),
);
check(
  'exposes token-free metadata',
  !JSON.stringify(client.metadata).includes('test_access_token'),
);

// --- Timers and abort -------------------------------------------------------
const aborting = new AbortController();
aborting.abort();
let abortedCorrectly = false;
try {
  await client.templates.list({ wabaId: '102290129340398' as never, signal: aborting.signal });
} catch {
  abortedCorrectly = true;
}
check('honours AbortSignal', abortedCorrectly);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed under Deno.`);
  Deno.exit(1);
}
console.log('\nAll Deno checks passed.');
