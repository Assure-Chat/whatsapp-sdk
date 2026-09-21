# Examples

Every example uses placeholders — `WA_ACCESS_TOKEN`, `APP_SECRET`, `PHONE_NUMBER_ID`,
`WABA_ID`, `15555550123`, `example_template`. None contains a realistic bearer token, and
none puts a secret in frontend code.

| File                                                         | What it shows                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`send-template.ts`](send-template.ts)                       | Sending an approved template, with a durable-job shape around the ambiguous-outcome case |
| [`list-templates.ts`](list-templates.ts)                     | Listing templates with bounded paging                                                    |
| [`exchange-signup-code.ts`](exchange-signup-code.ts)         | Server-side Embedded Signup code exchange                                                |
| [`verify-challenge.ts`](verify-challenge.ts)                 | The one-time GET subscription handshake                                                  |
| [`verify-and-parse-webhook.ts`](verify-and-parse-webhook.ts) | Verifying and normalizing an event POST                                                  |

These are illustrative and are not part of the published packages.
