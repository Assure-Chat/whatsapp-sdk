import type { ProviderLocaleCode, TemplateId } from './brands.js';
import type { GraphPage, KnownOr } from './common.js';

/**
 * Message-template management contracts, from the WhatsApp Business Management
 * API's Message Template endpoints.
 *
 * Every enum below is a {@link KnownOr}. Meta has shipped new template statuses
 * and rejection reasons without a version bump, and a closed union here would
 * turn a routine provider change into a crash in a webhook handler.
 */

/** Template category. `FREE_SERVICE` appears on reads but is not creatable. */
export type TemplateCategory = 'AUTHENTICATION' | 'MARKETING' | 'UTILITY' | 'FREE_SERVICE';

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  'AUTHENTICATION',
  'MARKETING',
  'UTILITY',
  'FREE_SERVICE',
];

/** Categories Meta accepts on template creation. */
export type CreatableTemplateCategory = Extract<
  TemplateCategory,
  'AUTHENTICATION' | 'MARKETING' | 'UTILITY'
>;

/**
 * Template review/lifecycle status.
 *
 * `APPROVED` is the provider's statement that the template may be sent. It is
 * not a statement that Assure should send it, nor that the locale the caller
 * wants exists — each language of a template is reviewed separately.
 */
export type TemplateStatus =
  | 'APPROVED'
  | 'ARCHIVED'
  | 'DELETED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'LIMIT_EXCEEDED'
  | 'PAUSED'
  | 'PENDING'
  | 'PENDING_DELETION'
  | 'REJECTED';

export const TEMPLATE_STATUSES: readonly TemplateStatus[] = [
  'APPROVED',
  'ARCHIVED',
  'DELETED',
  'DISABLED',
  'IN_APPEAL',
  'LIMIT_EXCEEDED',
  'PAUSED',
  'PENDING',
  'PENDING_DELETION',
  'REJECTED',
];

export type TemplateRejectedReason =
  | 'ABUSIVE_CONTENT'
  | 'CATEGORY_NOT_AVAILABLE'
  | 'INCORRECT_CATEGORY'
  | 'INVALID_FORMAT'
  | 'NONE'
  | 'PROMOTIONAL'
  | 'SCAM'
  | 'TAG_CONTENT_MISMATCH';

export const TEMPLATE_REJECTED_REASONS: readonly TemplateRejectedReason[] = [
  'ABUSIVE_CONTENT',
  'CATEGORY_NOT_AVAILABLE',
  'INCORRECT_CATEGORY',
  'INVALID_FORMAT',
  'NONE',
  'PROMOTIONAL',
  'SCAM',
  'TAG_CONTENT_MISMATCH',
];

export type TemplateQualityScoreValue = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export const TEMPLATE_QUALITY_SCORES: readonly TemplateQualityScoreValue[] = [
  'GREEN',
  'YELLOW',
  'RED',
  'UNKNOWN',
];

/**
 * Whether the template's placeholders are `{{1}}` or `{{name}}`.
 *
 * Getting this wrong is not a validation error at send time — Meta will accept
 * positional parameters against a NAMED template and substitute nothing, so the
 * recipient sees a message with a blank where the code should be.
 */
export type TemplateParameterFormat = 'NAMED' | 'POSITIONAL';

export type TemplateComponentFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

export type TemplateComponentType =
  'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | 'CAROUSEL' | 'LIMITED_TIME_OFFER';

export type TemplateButtonType =
  'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'OTP' | 'COPY_CODE' | 'CATALOG' | 'MPM' | 'FLOW';

export type TemplateOtpButtonType = 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';

/** Example values Meta requires when a component has placeholders. */
export interface TemplateComponentExample {
  header_text?: string[];
  header_handle?: string[];
  body_text?: string[][];
  body_text_named_params?: { param_name: string; example: string }[];
}

export interface TemplateDefinitionButton {
  type: KnownOr<TemplateButtonType>;
  text?: string;
  url?: string;
  phone_number?: string;
  otp_type?: KnownOr<TemplateOtpButtonType>;
  autofill_text?: string;
  package_name?: string;
  signature_hash?: string;
  example?: string[];
  [extension: string]: unknown;
}

/** One component of a template definition, as stored and reviewed by Meta. */
export interface TemplateDefinitionComponent {
  type: KnownOr<TemplateComponentType>;
  format?: KnownOr<TemplateComponentFormat>;
  text?: string;
  buttons?: TemplateDefinitionButton[];
  example?: TemplateComponentExample;
  add_security_recommendation?: boolean;
  code_expiration_minutes?: number;
  /**
   * Meta adds component properties routinely (carousel cards, limited-time
   * offers). Unknown keys are preserved rather than dropped so a round-trip
   * through this type does not silently delete part of a template.
   */
  [extension: string]: unknown;
}

export interface TemplateQualityScore {
  score?: KnownOr<TemplateQualityScoreValue>;
  reason?: string;
  reasons?: string[];
  date?: number;
}

/** A message template as Meta returns it. */
export interface MessageTemplate {
  id: TemplateId;
  name: string;
  language: ProviderLocaleCode;
  status: KnownOr<TemplateStatus>;
  category: KnownOr<TemplateCategory>;
  sub_category?: string;
  previous_category?: KnownOr<TemplateCategory>;
  correct_category?: KnownOr<TemplateCategory>;
  parameter_format?: KnownOr<TemplateParameterFormat>;
  rejected_reason?: KnownOr<TemplateRejectedReason> | null;
  quality_score?: TemplateQualityScore;
  components?: TemplateDefinitionComponent[];
  message_send_ttl_seconds?: number;
  last_updated_time?: number;
  library_template_name?: string;
  [extension: string]: unknown;
}

/** `GET /{waba-id}/message_templates` result. */
export type MessageTemplatePage = GraphPage<MessageTemplate>;

/** Filters for listing templates. Arrays are JSON-encoded onto the query. */
export interface ListTemplatesQuery {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
  name?: string;
  name_or_content?: string;
  language?: ProviderLocaleCode[];
  status?: KnownOr<TemplateStatus>[];
  category?: KnownOr<TemplateCategory>[];
  quality_score?: KnownOr<TemplateQualityScoreValue>[];
}

/** `POST /{waba-id}/message_templates` body. */
export interface CreateTemplateRequest {
  name: string;
  language: ProviderLocaleCode;
  category: CreatableTemplateCategory;
  components: TemplateDefinitionComponent[];
  parameter_format?: TemplateParameterFormat;
  /** Lets Meta recategorize rather than reject an obviously miscategorized template. */
  allow_category_change?: boolean;
  message_send_ttl_seconds?: number;
}

/** `POST /{waba-id}/message_templates` response. */
export interface CreateTemplateResponse {
  id: TemplateId;
  status?: KnownOr<TemplateStatus>;
  category?: KnownOr<TemplateCategory>;
}

/**
 * `POST /{template-id}` body.
 *
 * Meta only permits editing a template in certain statuses, and `name` and
 * `language` are never editable — a different language is a different template.
 */
export interface UpdateTemplateRequest {
  category?: CreatableTemplateCategory;
  components?: TemplateDefinitionComponent[];
  message_send_ttl_seconds?: number;
}

/**
 * `DELETE /{waba-id}/message_templates` parameters.
 *
 * With `name` alone, Meta deletes **every language** of that template. Passing
 * `hsm_id` alongside it scopes the delete to one language, which is almost
 * always what a caller means.
 */
export type DeleteTemplateRequest =
  { name: string; hsm_id?: never } | { name: string; hsm_id: TemplateId };
