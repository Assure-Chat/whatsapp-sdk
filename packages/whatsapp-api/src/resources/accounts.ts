import type {
  BusinessPhoneNumber,
  GraphPage,
  GraphSuccessResponse,
  ListPhoneNumbersQuery,
  PhoneNumberId,
  RegisterPhoneNumberResponse,
  SubscribeAppRequest,
  SubscribeAppResponse,
  SubscribedAppsResponse,
  WabaId,
  WhatsAppBusinessAccount,
} from '@assure-ai/whatsapp-types';
import { PHONE_NUMBER_FIELDS, asPhoneNumberId, asWabaId } from '@assure-ai/whatsapp-types';
import type { HttpClient, QueryValue } from '../http.js';
import { WhatsAppConfigError } from '../errors.js';
import { iteratePages, toPageResult, type IterateOptions, type PageResult } from '../paging.js';

/**
 * WABA, phone-number, and webhook-subscription discovery.
 *
 * These are the provider facts a connection-readiness check is built from.
 * They are inputs to that decision, never the decision: whether a tenant may
 * send in production is an Assure judgement made elsewhere, from these facts
 * plus entitlement, consent, and budget — none of which Meta knows about.
 */

export class AccountsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Read a WABA node. */
  async getWaba(options: {
    wabaId: WabaId;
    fields?: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<WhatsAppBusinessAccount> {
    const wabaId = asWabaId(options.wabaId);
    const fields = options.fields ?? [
      'id',
      'name',
      'currency',
      'timezone_id',
      'message_template_namespace',
      'account_review_status',
    ];
    return this.#http.request<WhatsAppBusinessAccount>({
      method: 'GET',
      path: wabaId,
      operation: 'GET /{waba-id}',
      mutation: false,
      query: { fields: fields.join(',') },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /** List one page of a WABA's business phone numbers. */
  async listPhoneNumbers(
    options: ListPhoneNumbersQuery & {
      wabaId: WabaId;
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ): Promise<PageResult<BusinessPhoneNumber>> {
    const wabaId = asWabaId(options.wabaId);
    const fields = options.fields ?? [...PHONE_NUMBER_FIELDS];
    const query: Record<string, QueryValue> = { fields: fields.join(',') };
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new WhatsAppConfigError('`limit` must be a positive integer');
      }
      query['limit'] = Math.min(options.limit, 100);
    }
    if (options.after !== undefined) query['after'] = options.after;
    if (options.before !== undefined) query['before'] = options.before;
    if (options.sort !== undefined) query['sort'] = options.sort;

    const page = await this.#http.request<GraphPage<BusinessPhoneNumber>>({
      method: 'GET',
      path: `${wabaId}/phone_numbers`,
      operation: 'GET /{waba-id}/phone_numbers',
      mutation: false,
      query,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    return toPageResult(page);
  }

  /** Walk a WABA's phone numbers, up to `maxPages`. */
  iteratePhoneNumbers(
    options: Omit<ListPhoneNumbersQuery, 'after'> & {
      wabaId: WabaId;
      timeoutMs?: number;
    } & IterateOptions,
  ): AsyncGenerator<BusinessPhoneNumber, void, undefined> {
    return iteratePages<BusinessPhoneNumber>(
      ({ after, signal }) =>
        this.listPhoneNumbers({
          ...options,
          ...(after !== undefined ? { after: after as string } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
      options,
    );
  }

  /** Read one business phone number node. */
  async getPhoneNumber(options: {
    phoneNumberId: PhoneNumberId;
    fields?: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<BusinessPhoneNumber> {
    const phoneNumberId = asPhoneNumberId(options.phoneNumberId);
    const fields = options.fields ?? [...PHONE_NUMBER_FIELDS];
    return this.#http.request<BusinessPhoneNumber>({
      method: 'GET',
      path: phoneNumberId,
      operation: 'GET /{phone-number-id}',
      mutation: false,
      query: { fields: fields.join(',') },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Register a business phone number for Cloud API use.
   *
   * Part of the Embedded Signup onboarding sequence. The `pin` is the number's
   * two-step verification PIN — a credential. It is passed straight into the
   * request body and never stored, logged, or echoed in an error.
   *
   * A mutation, so never retried. A registration that times out after dispatch
   * may have succeeded; check `getPhoneNumber` before trying again, because a
   * second attempt with a different PIN fails and a repeat with the same PIN is
   * merely redundant.
   */
  async registerPhoneNumber(options: {
    phoneNumberId: PhoneNumberId;
    pin: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<RegisterPhoneNumberResponse> {
    const phoneNumberId = asPhoneNumberId(options.phoneNumberId);
    if (typeof options.pin !== 'string' || !/^\d{6}$/.test(options.pin)) {
      // The PIN itself is never included in this message.
      throw new WhatsAppConfigError('`pin` must be a 6-digit string');
    }
    return this.#http.request<RegisterPhoneNumberResponse>({
      method: 'POST',
      path: `${phoneNumberId}/register`,
      operation: 'POST /{phone-number-id}/register',
      mutation: true,
      body: { messaging_product: 'whatsapp', pin: options.pin },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /** List the apps subscribed to a WABA's webhooks. */
  async listSubscribedApps(options: {
    wabaId: WabaId;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<SubscribedAppsResponse> {
    const wabaId = asWabaId(options.wabaId);
    return this.#http.request<SubscribedAppsResponse>({
      method: 'GET',
      path: `${wabaId}/subscribed_apps`,
      operation: 'GET /{waba-id}/subscribed_apps',
      mutation: false,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Subscribe the calling app to a WABA's webhooks.
   *
   * With no options, the app's dashboard-configured callback URL and verify
   * token are used. With `overrideCallbackUri`, a `verifyToken` is required —
   * Meta runs the GET challenge against the override before accepting it, and
   * omitting the token produces a confusing failure at the wrong layer.
   */
  async subscribeApp(options: {
    wabaId: WabaId;
    overrideCallbackUri?: string;
    /** Required when overriding the callback URI. Never logged. */
    verifyToken?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<SubscribeAppResponse> {
    const wabaId = asWabaId(options.wabaId);
    const body: SubscribeAppRequest = {};

    if (options.overrideCallbackUri !== undefined) {
      const uri = new URL(options.overrideCallbackUri);
      if (uri.protocol !== 'https:') {
        throw new WhatsAppConfigError('`overrideCallbackUri` must be https');
      }
      if (options.verifyToken === undefined || options.verifyToken === '') {
        throw new WhatsAppConfigError(
          '`verifyToken` is required with `overrideCallbackUri` — Meta verifies the override ' +
            'with a GET challenge before it accepts the subscription',
        );
      }
      body.override_callback_uri = uri.toString();
      body.verify_token = options.verifyToken;
    }

    return this.#http.request<SubscribeAppResponse>({
      method: 'POST',
      path: `${wabaId}/subscribed_apps`,
      operation: 'POST /{waba-id}/subscribed_apps',
      mutation: true,
      ...(Object.keys(body).length > 0 ? { body } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Unsubscribe the calling app from a WABA's webhooks.
   *
   * Stops event delivery for that WABA immediately. There is no API for
   * fetching webhook history, so anything Meta would have sent while
   * unsubscribed is lost permanently.
   */
  async unsubscribeApp(options: {
    wabaId: WabaId;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<GraphSuccessResponse> {
    const wabaId = asWabaId(options.wabaId);
    return this.#http.request<GraphSuccessResponse>({
      method: 'DELETE',
      path: `${wabaId}/subscribed_apps`,
      operation: 'DELETE /{waba-id}/subscribed_apps',
      mutation: true,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }
}
