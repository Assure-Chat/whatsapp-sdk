import { describe, expect, it } from 'vitest';
import {
  WhatsAppApiError,
  asMetaAppId,
  classifyExchangeFailure,
  createWhatsAppClient,
} from '../src/index.js';
import {
  GRAPH_VERSION,
  TEST_TOKEN,
  createFetchDouble,
  errorResponse,
  jsonResponse,
  rejectionOf,
} from './helpers.js';

const APP_ID = asMetaAppId('236484624622562');
const APP_SECRET = 'test_app_secret_not_a_real_value';
const CODE = 'test_exchangeable_code_not_a_real_value';
const BUSINESS_TOKEN = 'EAAtest_business_token_not_a_real_value';

function client(fetch: ReturnType<typeof createFetchDouble>['fetch'], overrides = {}) {
  return createWhatsAppClient({
    accessToken: TEST_TOKEN,
    graphApiVersion: GRAPH_VERSION,
    fetch,
    ...overrides,
  });
}

describe('exchangeAuthorizationCode', () => {
  it('calls the documented endpoint with the documented parameters', async () => {
    const double = createFetchDouble([
      jsonResponse({ access_token: BUSINESS_TOKEN, token_type: 'bearer' }),
    ]);
    await client(double.fetch).signup.exchangeAuthorizationCode({
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: CODE,
    });

    const request = double.only();
    expect(request.method).toBe('GET');
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
    );
    expect(url.searchParams.get('client_id')).toBe(APP_ID);
    expect(url.searchParams.get('client_secret')).toBe(APP_SECRET);
    expect(url.searchParams.get('code')).toBe(CODE);
    // This call has no bearer credential of its own.
    expect(request.headers['authorization']).toBeUndefined();
  });

  it('separates the token from its metadata', async () => {
    const double = createFetchDouble([
      jsonResponse({ access_token: BUSINESS_TOKEN, token_type: 'bearer', expires_in: 3600 }),
    ]);
    const result = await client(double.fetch, {
      now: () => 1_700_000_000_000,
    }).signup.exchangeAuthorizationCode({ appId: APP_ID, appSecret: APP_SECRET, code: CODE });

    expect(result.accessToken).toBe(BUSINESS_TOKEN);
    expect(result.metadata).toEqual({
      tokenType: 'bearer',
      tokenLength: BUSINESS_TOKEN.length,
      expiresAt: new Date(1_700_000_000_000 + 3_600_000),
    });
  });

  it('serializes to metadata only, so a stray log line carries no token', async () => {
    const double = createFetchDouble([jsonResponse({ access_token: BUSINESS_TOKEN })]);
    const result = await client(double.fetch).signup.exchangeAuthorizationCode({
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: CODE,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(BUSINESS_TOKEN);
    expect(JSON.parse(serialized)).toEqual({ metadata: { tokenLength: BUSINESS_TOKEN.length } });
    // The property itself does not show up in the output either.
    expect(Object.keys(JSON.parse(serialized) as object)).not.toContain('toJSON');
  });

  it('omits expiresAt when Meta omits expires_in, rather than assuming', async () => {
    const double = createFetchDouble([jsonResponse({ access_token: BUSINESS_TOKEN })]);
    const result = await client(double.fetch).signup.exchangeAuthorizationCode({
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: CODE,
    });
    expect(result.metadata.expiresAt).toBeUndefined();
  });

  it('never persists or caches the token across calls', async () => {
    const double = createFetchDouble([
      jsonResponse({ access_token: 'token_one' }),
      jsonResponse({ access_token: 'token_two' }),
    ]);
    const c = client(double.fetch);
    const first = await c.signup.exchangeAuthorizationCode({
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: CODE,
    });
    const second = await c.signup.exchangeAuthorizationCode({
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: CODE,
    });
    expect(first.accessToken).toBe('token_one');
    expect(second.accessToken).toBe('token_two');
    expect(double.requests).toHaveLength(2);
  });

  it.each([
    ['an empty app secret', { appSecret: '' }],
    ['an empty code', { code: '' }],
  ])('refuses %s before making a request', async (_name, overrides) => {
    const double = createFetchDouble([]);
    await expect(
      client(double.fetch).signup.exchangeAuthorizationCode({
        appId: APP_ID,
        appSecret: APP_SECRET,
        code: CODE,
        ...overrides,
      }),
    ).rejects.toThrow();
    expect(double.requests).toHaveLength(0);
  });

  it('never puts the secret, the code, or the URL in a connection failure', async () => {
    const error = await rejectionOf<Error>(
      client(() =>
        Promise.reject(
          new TypeError(
            'fetch failed to graph.facebook.com/v24.0/oauth/access_token?client_secret=leaked',
          ),
        ),
      ).signup.exchangeAuthorizationCode({ appId: APP_ID, appSecret: APP_SECRET, code: CODE }),
    );

    const serialized = `${error.message} ${JSON.stringify(error)}`;
    expect(serialized).not.toContain(APP_SECRET);
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('leaked');
  });

  it('never puts the secret or code in a provider error', async () => {
    const double = createFetchDouble([
      errorResponse(400, {
        message: 'Invalid verification code format.',
        type: 'OAuthException',
        code: 100,
        fbtrace_id: 'AXsgnV2Cm3ZMGF3dF_cfYIn',
      }),
    ]);
    const error = await rejectionOf<WhatsAppApiError>(
      client(double.fetch).signup.exchangeAuthorizationCode({
        appId: APP_ID,
        appSecret: APP_SECRET,
        code: CODE,
      }),
    );

    const serialized = `${error.message} ${JSON.stringify(error)}`;
    expect(serialized).not.toContain(APP_SECRET);
    expect(serialized).not.toContain(CODE);
    expect(error.fbtraceId).toBe('AXsgnV2Cm3ZMGF3dF_cfYIn');
  });

  it('discards a non-JSON body, which could echo the query string', async () => {
    const double = createFetchDouble([
      new Response(`<html>Error at ?client_secret=${APP_SECRET}</html>`, { status: 500 }),
    ]);
    const error = await rejectionOf<Error>(
      client(double.fetch).signup.exchangeAuthorizationCode({
        appId: APP_ID,
        appSecret: APP_SECRET,
        code: CODE,
      }),
    );
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(APP_SECRET);
  });

  it('raises when the response carries no access_token', async () => {
    const double = createFetchDouble([jsonResponse({ token_type: 'bearer' })]);
    await expect(
      client(double.fetch).signup.exchangeAuthorizationCode({
        appId: APP_ID,
        appSecret: APP_SECRET,
        code: CODE,
      }),
    ).rejects.toThrow(/no access_token/);
  });
});

describe('classifyExchangeFailure', () => {
  it.each([
    [100, 'expired_or_replayed_code'],
    [101, 'invalid_configuration'],
    [10, 'insufficient_permissions'],
    [999999, 'provider_error'],
  ])('classifies code %i', (code, reason) => {
    const error = new WhatsAppApiError(
      { status: 400, message: 'x', code, method: 'GET', operation: 'GET /oauth/access_token' },
      'validation',
    );
    expect(classifyExchangeFailure(error).reason).toBe(reason);
  });

  it('falls back to provider_error for a non-API error', () => {
    expect(classifyExchangeFailure(new Error('boom')).reason).toBe('provider_error');
  });
});
