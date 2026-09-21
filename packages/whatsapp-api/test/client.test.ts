import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRAPH_BASE_URL,
  WhatsAppAmbiguousOutcomeError,
  WhatsAppAuthenticationError,
  WhatsAppAuthorizationError,
  WhatsAppConfigError,
  WhatsAppConflictError,
  WhatsAppNotFoundError,
  WhatsAppRateLimitError,
  WhatsAppServerError,
  WhatsAppTemplateError,
  WhatsAppTimeoutError,
  WhatsAppValidationError,
  asE164PhoneNumber,
  asPhoneNumberId,
  asWabaId,
  createWhatsAppClient,
  isAmbiguousOutcome,
} from '../src/index.js';
import {
  GRAPH_VERSION,
  PHONE_NUMBER_ID,
  SEND_OK,
  TEST_TOKEN,
  WABA_ID,
  connectionFails,
  createFetchDouble,
  errorResponse,
  jsonResponse,
  neverResolves,
  rejectionOf,
} from './helpers.js';

const TO = asE164PhoneNumber('+15555550123');
const PHONE = asPhoneNumberId(PHONE_NUMBER_ID);
const WABA = asWabaId(WABA_ID);

const TEMPLATE = {
  name: 'example_template',
  language: { code: 'en_US' as never, policy: 'deterministic' as const },
  components: [{ type: 'body' as const, parameters: [{ type: 'text' as const, text: '123456' }] }],
};

function client(fetch: ReturnType<typeof createFetchDouble>['fetch'], overrides = {}) {
  return createWhatsAppClient({
    accessToken: TEST_TOKEN,
    graphApiVersion: GRAPH_VERSION,
    fetch,
    ...overrides,
  });
}

describe('construction', () => {
  it('requires an explicit Graph API version', () => {
    expect(() =>
      createWhatsAppClient({ accessToken: TEST_TOKEN, graphApiVersion: 'latest' }),
    ).toThrow(/GraphApiVersion is malformed/);
    expect(() =>
      createWhatsAppClient({ accessToken: TEST_TOKEN, graphApiVersion: '24.0' }),
    ).toThrow(/GraphApiVersion is malformed/);
  });

  it('defaults to Meta’s production Graph host', () => {
    const c = client(createFetchDouble([]).fetch);
    expect(c.metadata.baseUrl).toBe(DEFAULT_GRAPH_BASE_URL);
    expect(c.metadata.graphApiVersion).toBe(GRAPH_VERSION);
  });

  it('rejects a plaintext base URL unless the override is set explicitly', () => {
    expect(() =>
      createWhatsAppClient({
        accessToken: TEST_TOKEN,
        graphApiVersion: GRAPH_VERSION,
        baseUrl: 'http://localhost:8080',
      }),
    ).toThrow(WhatsAppConfigError);

    const mock = createWhatsAppClient({
      accessToken: TEST_TOKEN,
      graphApiVersion: GRAPH_VERSION,
      baseUrl: 'http://localhost:8080',
      allowInsecureBaseUrl: true,
    });
    expect(mock.metadata.baseUrl).toBe('http://localhost:8080');
  });

  it.each([
    ['a query string', 'https://graph.facebook.com/?a=1'],
    ['embedded credentials', 'https://user:pass@graph.facebook.com'],
    ['a non-URL', 'not a url'],
  ])('rejects a base URL with %s', (_name, baseUrl) => {
    expect(() =>
      createWhatsAppClient({ accessToken: TEST_TOKEN, graphApiVersion: GRAPH_VERSION, baseUrl }),
    ).toThrow(WhatsAppConfigError);
  });

  it('rejects an empty access token', () => {
    expect(() => createWhatsAppClient({ accessToken: '', graphApiVersion: GRAPH_VERSION })).toThrow(
      WhatsAppConfigError,
    );
  });

  it('exposes metadata with no property that could hold a secret', () => {
    const c = client(createFetchDouble([]).fetch, { wabaId: WABA, phoneNumberId: PHONE });
    const serialized = JSON.stringify(c.metadata);
    expect(serialized).not.toContain(TEST_TOKEN);
    expect(Object.keys(c.metadata).sort()).toEqual([
      'baseUrl',
      'graphApiVersion',
      'phoneNumberId',
      'wabaId',
    ]);
  });
});

describe('request construction', () => {
  it('sends the token as a bearer header and never in the URL', async () => {
    const double = createFetchDouble([jsonResponse(SEND_OK)]);
    await client(double.fetch).messages.sendTemplate({
      phoneNumberId: PHONE,
      to: TO,
      template: TEMPLATE,
    });

    const request = double.only();
    expect(request.headers['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    expect(request.url).not.toContain(TEST_TOKEN);
    expect(request.url).not.toContain('access_token');
  });

  it('builds the URL from the pinned version and the phone number id', async () => {
    const double = createFetchDouble([jsonResponse(SEND_OK)]);
    await client(double.fetch).messages.sendTemplate({
      phoneNumberId: PHONE,
      to: TO,
      template: TEMPLATE,
    });
    expect(double.only().url).toBe(
      `${DEFAULT_GRAPH_BASE_URL}/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    );
  });

  it('sends the documented message body', async () => {
    const double = createFetchDouble([jsonResponse(SEND_OK)]);
    await client(double.fetch).messages.sendTemplate({
      phoneNumberId: PHONE,
      to: TO,
      template: TEMPLATE,
      callbackData: 'job_01HXYZ',
    });
    expect(JSON.parse(double.only().body!)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+15555550123',
      type: 'template',
      template: TEMPLATE,
      biz_opaque_callback_data: 'job_01HXYZ',
    });
  });

  it('rejects an identifier that is not a valid Graph node id before building a URL', async () => {
    const double = createFetchDouble([]);
    await expect(
      client(double.fetch).messages.sendTemplate({
        phoneNumberId: '../../me' as never,
        to: TO,
        template: TEMPLATE,
      }),
    ).rejects.toThrow(/PhoneNumberId is malformed/);
    expect(double.requests).toHaveLength(0);
  });

  it('encodes template list filters as JSON arrays in one parameter', async () => {
    const double = createFetchDouble([jsonResponse({ data: [] })]);
    await client(double.fetch).templates.list({
      wabaId: WABA,
      status: ['APPROVED', 'PAUSED'],
      limit: 25,
    });
    const url = new URL(double.only().url);
    expect(url.searchParams.get('status')).toBe('["APPROVED","PAUSED"]');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('clamps a template page size above Graph’s maximum', async () => {
    const double = createFetchDouble([jsonResponse({ data: [] })]);
    await client(double.fetch).templates.list({ wabaId: WABA, limit: 5000 });
    expect(new URL(double.only().url).searchParams.get('limit')).toBe('100');
  });
});

describe('error classification', () => {
  it.each([
    [
      400,
      { message: 'Invalid parameter', type: 'OAuthException', code: 100 },
      WhatsAppValidationError,
    ],
    [
      401,
      { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 },
      WhatsAppAuthenticationError,
    ],
    [403, { message: 'Permission denied', code: 200 }, WhatsAppAuthorizationError],
    [404, { message: 'Unknown path components', code: 2500 }, WhatsAppNotFoundError],
    [409, { message: 'Conflicting state', code: 9999 }, WhatsAppConflictError],
    [429, { message: 'Rate limit hit', code: 130429 }, WhatsAppRateLimitError],
    [
      500,
      { message: 'An unexpected error occurred', type: 'GraphMethodException', code: 2 },
      WhatsAppServerError,
    ],
  ])('maps %i to the right error class', async (status, error, expected) => {
    const double = createFetchDouble([errorResponse(status, error)]);
    await expect(client(double.fetch).templates.list({ wabaId: WABA })).rejects.toBeInstanceOf(
      expected,
    );
  });

  it('classifies by Meta’s code over the HTTP status', async () => {
    // A disabled template is a 400, but it needs template handling, not
    // "your request was malformed".
    const double = createFetchDouble([
      errorResponse(400, { message: '(#132016) Template is disabled', code: 132016 }),
    ]);
    const error = await rejectionOf(
      client(double.fetch).messages.sendTemplate({
        phoneNumberId: PHONE,
        to: TO,
        template: TEMPLATE,
      }),
    );

    expect(error).toBeInstanceOf(WhatsAppTemplateError);
    expect((error as WhatsAppTemplateError).classification).toBe('template');
    expect((error as WhatsAppTemplateError).retryable).toBe(false);
  });

  it('parses Retry-After in seconds and as an HTTP date', async () => {
    const double = createFetchDouble([
      errorResponse(429, { message: 'Rate limit hit', code: 130429 }, { 'retry-after': '30' }),
    ]);
    const error = await rejectionOf<WhatsAppRateLimitError>(
      client(double.fetch).templates.list({ wabaId: WABA }),
    );
    expect(error.retryAfterMs).toBe(30_000);

    const future = new Date(Date.now() + 60_000).toUTCString();
    const dated = createFetchDouble([
      errorResponse(429, { message: 'Rate limit hit', code: 130429 }, { 'retry-after': future }),
    ]);
    const datedError = await rejectionOf<WhatsAppRateLimitError>(
      client(dated.fetch).templates.list({ wabaId: WABA }),
    );
    expect(datedError.retryAfterMs).toBeGreaterThan(50_000);
    expect(datedError.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('keeps the provider trace id for support escalation', async () => {
    const double = createFetchDouble([
      errorResponse(400, {
        message: 'Invalid parameter',
        code: 100,
        fbtrace_id: 'AXsgnV2Cm3ZMGF3dF_cfYIn',
      }),
    ]);
    const error = await rejectionOf<WhatsAppValidationError>(
      client(double.fetch).templates.list({ wabaId: WABA }),
    );
    expect(error.fbtraceId).toBe('AXsgnV2Cm3ZMGF3dF_cfYIn');
  });

  it('survives a non-JSON error body without keeping it', async () => {
    const double = createFetchDouble([
      new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    ]);
    const error = await rejectionOf<WhatsAppServerError>(
      client(double.fetch).templates.list({ wabaId: WABA }),
    );
    expect(error).toBeInstanceOf(WhatsAppServerError);
    expect(JSON.stringify(error)).not.toContain('Bad Gateway');
  });
});

describe('error redaction', () => {
  it('excludes token, destination, body, headers and full URL from the serialized error', async () => {
    const double = createFetchDouble([
      errorResponse(400, {
        message: 'Invalid parameter',
        code: 100,
        error_data: { messaging_product: 'whatsapp', details: 'param body[0] is invalid' },
      }),
    ]);
    const error = await rejectionOf<Error>(
      client(double.fetch).messages.sendTemplate({
        phoneNumberId: PHONE,
        to: TO,
        template: {
          ...TEMPLATE,
          components: [{ type: 'body', parameters: [{ type: 'text', text: '999111' }] }],
        },
      }),
    );

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(TEST_TOKEN);
    expect(serialized).not.toContain('+15555550123');
    expect(serialized).not.toContain('999111');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain(DEFAULT_GRAPH_BASE_URL);
    // The route shape survives, which is what an operator needs.
    expect(serialized).toContain('POST /{phone-number-id}/messages');
  });

  it('elides token-shaped runs from a provider message', async () => {
    const leaked = `Token EAAGm0PX4ZCpsBA${'x'.repeat(60)} was rejected`;
    const double = createFetchDouble([errorResponse(401, { message: leaked, code: 190 })]);
    const error = await rejectionOf<Error>(client(double.fetch).templates.list({ wabaId: WABA }));
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('EAAGm0PX4ZCpsBA');
  });

  it('gives the logger route shapes and codes, never bodies or tokens', async () => {
    const warn = vi.fn();
    const debug = vi.fn();
    const double = createFetchDouble([
      errorResponse(429, { message: 'Rate limit hit', code: 130429 }),
    ]);
    await client(double.fetch, { logger: { warn, debug } })
      .templates.list({ wabaId: WABA })
      .catch(() => undefined);

    const logged = JSON.stringify([debug.mock.calls, warn.mock.calls]);
    expect(logged).not.toContain(TEST_TOKEN);
    expect(logged).not.toContain(DEFAULT_GRAPH_BASE_URL);
    expect(warn).toHaveBeenCalledWith(
      'whatsapp.response.error',
      expect.objectContaining({ status: 429, code: 130429, classification: 'rate_limit' }),
    );
  });

  it('gives request and response hooks no headers and no body', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const double = createFetchDouble([jsonResponse(SEND_OK)]);
    await client(double.fetch, { onRequest, onResponse }).messages.sendTemplate({
      phoneNumberId: PHONE,
      to: TO,
      template: TEMPLATE,
    });

    const [requestInfo] = onRequest.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(requestInfo).sort()).toEqual(['attempt', 'method', 'operation']);
    const [responseInfo] = onResponse.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(responseInfo)).not.toContain('body');
    expect(Object.keys(responseInfo)).not.toContain('headers');
  });
});

describe('retry policy', () => {
  it('never retries a send, even on a 429', async () => {
    const double = createFetchDouble([
      errorResponse(429, { message: 'Rate limit hit', code: 130429 }),
    ]);
    await expect(
      client(double.fetch, {
        readRetry: { maxRetries: 3 },
        sleep: async () => undefined,
      }).messages.sendTemplate({ phoneNumberId: PHONE, to: TO, template: TEMPLATE }),
    ).rejects.toBeInstanceOf(WhatsAppRateLimitError);
    expect(double.requests).toHaveLength(1);
  });

  it('never retries a template submission', async () => {
    const double = createFetchDouble([errorResponse(503, { message: 'Service unavailable' })]);
    await expect(
      client(double.fetch, {
        readRetry: { maxRetries: 3 },
        sleep: async () => undefined,
      }).templates.create({
        wabaId: WABA,
        template: {
          name: 'example_template',
          language: 'en_US' as never,
          category: 'AUTHENTICATION',
          components: [{ type: 'BODY', text: 'Your code is {{1}}' }],
        },
      }),
    ).rejects.toThrow();
    expect(double.requests).toHaveLength(1);
  });

  it('does not retry a read either, unless the caller opted in', async () => {
    const double = createFetchDouble([errorResponse(500, { message: 'boom' })]);
    await expect(client(double.fetch).templates.list({ wabaId: WABA })).rejects.toThrow();
    expect(double.requests).toHaveLength(1);
  });

  it('retries a safe read when configured, honouring Retry-After', async () => {
    const sleep = vi.fn(async () => undefined);
    const double = createFetchDouble([
      errorResponse(429, { message: 'Rate limit hit', code: 130429 }, { 'retry-after': '2' }),
      jsonResponse({ data: [{ id: '1', name: 'example_template' }] }),
    ]);
    const result = await client(double.fetch, {
      readRetry: { maxRetries: 2 },
      sleep,
    }).templates.list({ wabaId: WABA });

    expect(double.requests).toHaveLength(2);
    expect(result.data).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('stops retrying a read at the configured cap', async () => {
    const double = createFetchDouble(() => errorResponse(500, { message: 'boom' }));
    await expect(
      client(double.fetch, {
        readRetry: { maxRetries: 2 },
        sleep: async () => undefined,
      }).templates.list({ wabaId: WABA }),
    ).rejects.toBeInstanceOf(WhatsAppServerError);
    expect(double.requests).toHaveLength(3);
  });
});

describe('ambiguous outcomes', () => {
  it('raises an ambiguous outcome when a send fails after dispatch', async () => {
    const error = await rejectionOf(
      client(connectionFails).messages.sendTemplate({
        phoneNumberId: PHONE,
        to: TO,
        template: TEMPLATE,
      }),
    );

    expect(error).toBeInstanceOf(WhatsAppAmbiguousOutcomeError);
    expect(isAmbiguousOutcome(error)).toBe(true);
    expect((error as WhatsAppAmbiguousOutcomeError).retryable).toBe(false);
    expect((error as Error).message).toContain('reconcile');
  });

  it('raises an ambiguous outcome when a send times out', async () => {
    const error = await rejectionOf(
      client(neverResolves, { timeoutMs: 5 }).messages.sendTemplate({
        phoneNumberId: PHONE,
        to: TO,
        template: TEMPLATE,
      }),
    );
    expect(error).toBeInstanceOf(WhatsAppAmbiguousOutcomeError);
  });

  it('raises a plain timeout for a read, which is unambiguous', async () => {
    const error = await rejectionOf(
      client(neverResolves, { timeoutMs: 5 }).templates.list({ wabaId: WABA }),
    );
    expect(error).toBeInstanceOf(WhatsAppTimeoutError);
    expect(isAmbiguousOutcome(error)).toBe(false);
  });

  it('keeps no destination or token in the ambiguous error', async () => {
    const error = await rejectionOf<Error>(
      client(connectionFails).messages.sendTemplate({
        phoneNumberId: PHONE,
        to: TO,
        template: TEMPLATE,
      }),
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('+15555550123');
    expect(serialized).not.toContain(TEST_TOKEN);
    expect(serialized).not.toContain(PHONE_NUMBER_ID);
  });
});

describe('cancellation', () => {
  it('honours a caller signal aborted before dispatch', async () => {
    const controller = new AbortController();
    controller.abort();
    const double = createFetchDouble([]);
    const error = await rejectionOf<WhatsAppTimeoutError>(
      client(double.fetch).templates.list({ wabaId: WABA, signal: controller.signal }),
    );
    expect(error).toBeInstanceOf(WhatsAppTimeoutError);
    expect(error.abortedByCaller).toBe(true);
  });

  it('dispatches nothing at all when the signal is already aborted', async () => {
    // Checked before dispatch rather than relying on fetch to reject: a real
    // `fetch` does, but an injected one may not, and for a mutation the
    // difference is between a clean cancellation and an ambiguous outcome.
    const double = createFetchDouble([]);
    const controller = new AbortController();
    controller.abort();

    await client(double.fetch, { readRetry: { maxRetries: 3 }, sleep: async () => undefined })
      .templates.list({ wabaId: WABA, signal: controller.signal })
      .catch(() => undefined);
    expect(double.requests).toHaveLength(0);
  });

  it('does not dispatch an aborted send, so the outcome is never ambiguous', async () => {
    const double = createFetchDouble([]);
    const controller = new AbortController();
    controller.abort();

    const error = await rejectionOf(
      client(double.fetch).messages.sendTemplate({
        phoneNumberId: PHONE,
        to: TO,
        template: TEMPLATE,
        signal: controller.signal,
      }),
    );
    expect(error).toBeInstanceOf(WhatsAppTimeoutError);
    expect(isAmbiguousOutcome(error)).toBe(false);
    expect(double.requests).toHaveLength(0);
  });
});

describe('tenant isolation', () => {
  it('keeps two concurrent clients’ credentials and phone numbers separate', async () => {
    const seen: { token: string; url: string }[] = [];
    const record = createFetchDouble((request) => {
      seen.push({ token: request.headers['authorization']!, url: request.url });
      return jsonResponse(SEND_OK);
    });

    const tenantA = createWhatsAppClient({
      accessToken: 'token_tenant_a',
      graphApiVersion: GRAPH_VERSION,
      fetch: record.fetch,
    });
    const tenantB = createWhatsAppClient({
      accessToken: 'token_tenant_b',
      graphApiVersion: 'v23.0',
      fetch: record.fetch,
    });

    await Promise.all([
      tenantA.messages.sendTemplate({
        phoneNumberId: asPhoneNumberId('111111111111111'),
        to: TO,
        template: TEMPLATE,
      }),
      tenantB.messages.sendTemplate({
        phoneNumberId: asPhoneNumberId('222222222222222'),
        to: TO,
        template: TEMPLATE,
      }),
    ]);

    const a = seen.find((entry) => entry.url.includes('111111111111111'));
    const b = seen.find((entry) => entry.url.includes('222222222222222'));
    expect(a?.token).toBe('Bearer token_tenant_a');
    expect(b?.token).toBe('Bearer token_tenant_b');
    expect(a?.url).toContain('/v24.0/');
    expect(b?.url).toContain('/v23.0/');
  });

  it('resolves the token per request when given a provider function', async () => {
    let current = 'token_one';
    const double = createFetchDouble(() => jsonResponse({ data: [] }));
    const c = createWhatsAppClient({
      accessToken: () => current,
      graphApiVersion: GRAPH_VERSION,
      fetch: double.fetch,
    });

    await c.templates.list({ wabaId: WABA });
    current = 'token_two';
    await c.templates.list({ wabaId: WABA });

    expect(double.requests[0]?.headers['authorization']).toBe('Bearer token_one');
    expect(double.requests[1]?.headers['authorization']).toBe('Bearer token_two');
  });

  it('fails closed when a token provider returns nothing', async () => {
    const double = createFetchDouble([]);
    const c = createWhatsAppClient({
      accessToken: () => '',
      graphApiVersion: GRAPH_VERSION,
      fetch: double.fetch,
    });
    await expect(c.templates.list({ wabaId: WABA })).rejects.toBeInstanceOf(WhatsAppConfigError);
    expect(double.requests).toHaveLength(0);
  });
});
