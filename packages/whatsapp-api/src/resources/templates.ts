import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  GraphPage,
  GraphSuccessResponse,
  ListTemplatesQuery,
  MessageTemplate,
  PagingCursor,
  TemplateId,
  UpdateTemplateRequest,
  WabaId,
} from '@assure-ai/whatsapp-types';
import { asTemplateId, asWabaId } from '@assure-ai/whatsapp-types';
import type { HttpClient, QueryValue } from '../http.js';
import { WhatsAppConfigError } from '../errors.js';
import { iteratePages, toPageResult, type IterateOptions, type PageResult } from '../paging.js';

/**
 * Message-template management, against the WhatsApp Business Management API.
 *
 * These methods report what Meta says about a template. None of them makes a
 * template usable: approval is a review outcome Meta produces on its own
 * schedule, per language, and a template that is `APPROVED` today can be
 * `PAUSED` an hour later on quality signals. Treat every answer here as a
 * point-in-time observation, and subscribe to
 * `message_template_status_update` for the changes in between.
 */

/** The fields worth requesting by default. */
export const DEFAULT_TEMPLATE_FIELDS = [
  'id',
  'name',
  'language',
  'status',
  'category',
  'sub_category',
  'parameter_format',
  'rejected_reason',
  'quality_score',
  'components',
  'message_send_ttl_seconds',
  'previous_category',
  'last_updated_time',
] as const;

export interface ListTemplatesOptions extends ListTemplatesQuery {
  wabaId: WabaId;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class TemplatesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * List one page of templates.
   *
   * Returns a page plus its cursors. It does not follow `paging.next`, which
   * carries the access token in its query string — see `paging.ts`.
   */
  async list(options: ListTemplatesOptions): Promise<PageResult<MessageTemplate>> {
    const wabaId = asWabaId(options.wabaId);
    const query: Record<string, QueryValue> = {};

    const fields = options.fields ?? [...DEFAULT_TEMPLATE_FIELDS];
    query['fields'] = fields.join(',');
    if (options.limit !== undefined) query['limit'] = clampLimit(options.limit);
    if (options.after !== undefined) query['after'] = options.after;
    if (options.before !== undefined) query['before'] = options.before;
    if (options.name !== undefined) query['name'] = options.name;
    if (options.name_or_content !== undefined) query['name_or_content'] = options.name_or_content;
    // Graph takes these filters as JSON arrays in a single parameter; the
    // transport handles that encoding for array values.
    if (options.language !== undefined) query['language'] = [...options.language];
    if (options.status !== undefined) query['status'] = [...options.status];
    if (options.category !== undefined) query['category'] = [...options.category];
    if (options.quality_score !== undefined) query['quality_score'] = [...options.quality_score];

    const page = await this.#http.request<GraphPage<MessageTemplate>>({
      method: 'GET',
      path: `${wabaId}/message_templates`,
      operation: 'GET /{waba-id}/message_templates',
      mutation: false,
      query,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    return toPageResult(page);
  }

  /**
   * Walk templates across pages, up to `maxPages`.
   *
   * The cap is required. An unbounded walk of a large WABA against a
   * rate-limited API is a slow outage.
   */
  iterate(
    options: Omit<ListTemplatesOptions, 'after'> & IterateOptions,
  ): AsyncGenerator<MessageTemplate, void, undefined> {
    return iteratePages<MessageTemplate>(
      ({ after, signal }) =>
        this.list({
          ...options,
          ...(after !== undefined ? { after: after as string } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
      options,
    );
  }

  /** Read one template by ID. */
  async get(options: {
    templateId: TemplateId;
    fields?: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<MessageTemplate> {
    const templateId = asTemplateId(options.templateId);
    const fields = options.fields ?? [...DEFAULT_TEMPLATE_FIELDS];
    return this.#http.request<MessageTemplate>({
      method: 'GET',
      path: templateId,
      operation: 'GET /{template-id}',
      mutation: false,
      query: { fields: fields.join(',') },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Submit a new template for review.
   *
   * A mutation: never retried. A submission that times out after dispatch may
   * still have created the template, so reconcile with `list({ name })` before
   * submitting again — a duplicate submission counts against the WABA's
   * template limit.
   */
  async create(options: {
    wabaId: WabaId;
    template: CreateTemplateRequest;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<CreateTemplateResponse> {
    const wabaId = asWabaId(options.wabaId);
    validateCreateRequest(options.template);
    return this.#http.request<CreateTemplateResponse>({
      method: 'POST',
      path: `${wabaId}/message_templates`,
      operation: 'POST /{waba-id}/message_templates',
      mutation: true,
      body: options.template,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Edit an existing template.
   *
   * Meta permits this only in certain statuses, and never for `name` or
   * `language` — a different language is a different template. An edit sends
   * the template back for review.
   */
  async update(options: {
    templateId: TemplateId;
    changes: UpdateTemplateRequest;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<GraphSuccessResponse> {
    const templateId = asTemplateId(options.templateId);
    if (!options.changes || Object.keys(options.changes).length === 0) {
      throw new WhatsAppConfigError('`changes` must contain at least one field to update');
    }
    return this.#http.request<GraphSuccessResponse>({
      method: 'POST',
      path: templateId,
      operation: 'POST /{template-id}',
      mutation: true,
      body: options.changes,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /**
   * Delete a template.
   *
   * **`name` alone deletes every language of that template.** Meta documents
   * this and it is easy to do by accident, so `templateId` is a separate,
   * explicit argument: passing it scopes the delete to one language, which is
   * almost always what was meant.
   */
  async delete(options: {
    wabaId: WabaId;
    name: string;
    /** Pass to delete only this language. Omit to delete all languages. */
    templateId?: TemplateId;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<GraphSuccessResponse> {
    const wabaId = asWabaId(options.wabaId);
    if (typeof options.name !== 'string' || options.name === '') {
      throw new WhatsAppConfigError('`name` is required to delete a template');
    }
    const query: Record<string, QueryValue> = { name: options.name };
    if (options.templateId !== undefined) query['hsm_id'] = asTemplateId(options.templateId);

    return this.#http.request<GraphSuccessResponse>({
      method: 'DELETE',
      path: `${wabaId}/message_templates`,
      operation: 'DELETE /{waba-id}/message_templates',
      mutation: true,
      query,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }
}

/** Graph caps template page size at 100; anything above is silently clamped. */
function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new WhatsAppConfigError('`limit` must be a positive integer');
  }
  return Math.min(limit, 100);
}

function validateCreateRequest(template: CreateTemplateRequest): void {
  if (!template || typeof template !== 'object') {
    throw new WhatsAppConfigError('`template` is required');
  }
  if (typeof template.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(template.name)) {
    // Meta's rule: lowercase alphanumerics and underscores, up to 512 chars.
    // Checked here because the failure message from Graph is unhelpfully generic.
    throw new WhatsAppConfigError(
      '`template.name` must be lowercase alphanumerics and underscores, 1-512 characters',
    );
  }
  if (typeof template.language !== 'string' || template.language === '') {
    throw new WhatsAppConfigError('`template.language` is required');
  }
  if (!Array.isArray(template.components) || template.components.length === 0) {
    throw new WhatsAppConfigError('`template.components` must contain at least one component');
  }
}

export type { PagingCursor };
