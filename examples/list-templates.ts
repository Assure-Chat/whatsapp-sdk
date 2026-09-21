/**
 * List message templates, with bounded paging.
 *
 * An approved template is a point-in-time fact: approval is per language and
 * revocable on quality signals. Treat this as a snapshot and subscribe to
 * `message_template_status_update` for what happens between calls.
 */

import { asWabaId, collect, createWhatsAppClient } from '@assure-ai/whatsapp-api';

declare const WA_ACCESS_TOKEN: string;
declare const WABA_ID: string;

const client = createWhatsAppClient({
  accessToken: WA_ACCESS_TOKEN,
  graphApiVersion: 'v24.0',
});

const wabaId = asWabaId(WABA_ID);

// One page, with the cursors needed to ask for the next.
const page = await client.templates.list({
  wabaId,
  status: ['APPROVED'],
  limit: 50,
});

for (const template of page.data) {
  console.log(template.name, template.language, template.status);
}

if (page.hasNextPage) {
  await client.templates.list({ wabaId, after: page.nextCursor, limit: 50 });
}

// Or walk pages. `maxPages` is required: there is no unbounded traversal,
// because an accidental infinite loop against a rate-limited API is a slow
// outage — and on an Edge runtime, a billed one.
const approved = await collect(
  client.templates.iterate({ wabaId, status: ['APPROVED'], maxPages: 10 }),
  { maxItems: 500 },
);

console.log(`${approved.length} approved templates`);

// Find which languages one template is actually approved in. A template
// approved in en_US does not exist in en_GB.
const byName = approved.filter((template) => template.name === 'example_template');
console.log(
  'approved languages:',
  byName.map((template) => template.language),
);
