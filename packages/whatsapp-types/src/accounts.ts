import type { MetaAppId, PhoneNumberId, WabaId } from './brands.js';
import type { GraphPage, KnownOr, MessagingProduct } from './common.js';

/**
 * WABA, business phone number, and webhook-subscription contracts — the
 * provider facts Assure needs to decide whether a connection is *technically*
 * able to send.
 *
 * None of these types carry an Assure judgement. `status: "CONNECTED"` and
 * `quality_rating: "GREEN"` are things Meta says about a phone number; whether
 * the tenant owning it is entitled to send, in production, on Assure's plan, is
 * a decision the application makes elsewhere with this as one input.
 */

/** Connection status of a business phone number. */
export type PhoneNumberStatus =
  | 'BANNED'
  | 'CONNECTED'
  | 'DELETED'
  | 'DISCONNECTED'
  | 'FLAGGED'
  | 'MIGRATED'
  | 'PENDING'
  | 'RATE_LIMITED'
  | 'RESTRICTED';

export const PHONE_NUMBER_STATUSES: readonly PhoneNumberStatus[] = [
  'BANNED',
  'CONNECTED',
  'DELETED',
  'DISCONNECTED',
  'FLAGGED',
  'MIGRATED',
  'PENDING',
  'RATE_LIMITED',
  'RESTRICTED',
];

export type PhoneNumberQualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export const PHONE_NUMBER_QUALITY_RATINGS: readonly PhoneNumberQualityRating[] = [
  'GREEN',
  'YELLOW',
  'RED',
  'UNKNOWN',
];

export type CodeVerificationStatus = 'EXPIRED' | 'NOT_VERIFIED' | 'VERIFIED';

export type UnifiedCertStatus =
  | 'APPROVED'
  | 'NAME_PENDING_REVIEW'
  | 'NAME_NOT_APPROVED'
  | 'ACCOUNT_REVIEW_NOT_STARTED'
  | 'LIMITED_ACCESS';

export type PhoneNumberAccountMode = 'LIVE' | 'SANDBOX';

export type PhoneNumberHostPlatform = 'CLOUD_API' | 'ON_PREMISE' | 'NOT_APPLICABLE';

/**
 * Messaging limit tier.
 *
 * Meta's phone-number node documents `TIER_1K` while the
 * `phone_number_quality_update` webhook documents `TIER_250` and `TIER_2K` for
 * the same concept. Both sets are listed; neither is authoritative for the
 * other, which is exactly why this is a {@link KnownOr} at every use site.
 */
export type MessagingLimitTier =
  | 'TIER_50'
  | 'TIER_250'
  | 'TIER_1K'
  | 'TIER_2K'
  | 'TIER_10K'
  | 'TIER_100K'
  | 'TIER_UNLIMITED'
  | 'TIER_NOT_SET';

export const MESSAGING_LIMIT_TIERS: readonly MessagingLimitTier[] = [
  'TIER_50',
  'TIER_250',
  'TIER_1K',
  'TIER_2K',
  'TIER_10K',
  'TIER_100K',
  'TIER_UNLIMITED',
  'TIER_NOT_SET',
];

/** A business phone number node. */
export interface BusinessPhoneNumber {
  id: PhoneNumberId;
  /** Human-readable, as shown in WhatsApp. Often spaced — not E.164. */
  display_phone_number: string;
  verified_name?: string;
  status: KnownOr<PhoneNumberStatus>;
  quality_rating?: KnownOr<PhoneNumberQualityRating>;
  country_code?: string;
  country_dial_code?: string;
  code_verification_status?: KnownOr<CodeVerificationStatus>;
  unified_cert_status?: KnownOr<UnifiedCertStatus>;
  account_mode?: KnownOr<PhoneNumberAccountMode>;
  host_platform?: KnownOr<PhoneNumberHostPlatform>;
  messaging_limit_tier?: KnownOr<MessagingLimitTier>;
  is_official_business_account?: boolean;
  [extension: string]: unknown;
}

export type BusinessPhoneNumberPage = GraphPage<BusinessPhoneNumber>;

/** Fields the phone-number edge documents for `?fields=`. */
export const PHONE_NUMBER_FIELDS = [
  'id',
  'display_phone_number',
  'verified_name',
  'status',
  'quality_rating',
  'country_code',
  'country_dial_code',
  'code_verification_status',
  'unified_cert_status',
  'account_mode',
  'host_platform',
  'messaging_limit_tier',
  'is_official_business_account',
] as const;

export interface ListPhoneNumbersQuery {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
  sort?: KnownOr<
    | 'creation_time.asc'
    | 'creation_time.desc'
    | 'last_onboarded_time.asc'
    | 'last_onboarded_time.desc'
  >;
}

/** A WhatsApp Business Account node, at the depth Assure reads it. */
export interface WhatsAppBusinessAccount {
  id: WabaId;
  name?: string;
  currency?: string;
  timezone_id?: string;
  message_template_namespace?: string;
  account_review_status?: string;
  [extension: string]: unknown;
}

export type WhatsAppBusinessAccountPage = GraphPage<WhatsAppBusinessAccount>;

/** An app subscribed to a WABA's webhooks. */
export interface SubscribedApp {
  whatsapp_business_api_data: {
    id: MetaAppId;
    name: string;
    link?: string;
  };
  /** Set when this subscription overrides the app's default callback URL. */
  override_callback_uri?: string;
}

export interface SubscribedAppsResponse {
  data: SubscribedApp[];
}

/**
 * `POST /{waba-id}/subscribed_apps` body.
 *
 * Both fields are optional; sending neither subscribes the calling app to the
 * WABA using the app's dashboard-configured callback URL and verify token.
 * When an override callback URI is supplied, a verify token must be too —
 * Meta runs the GET challenge against the override before accepting it.
 */
export interface SubscribeAppRequest {
  override_callback_uri?: string;
  verify_token?: string;
}

export interface SubscribeAppResponse {
  success: boolean;
  data?: SubscribedApp[];
}

/**
 * `POST /{phone-number-id}/register` body.
 *
 * The PIN is the number's two-step verification PIN. It is a credential: it is
 * typed here because the endpoint requires it, but it must never be logged,
 * stored by these packages, or included in an error.
 */
export interface RegisterPhoneNumberRequest {
  messaging_product: MessagingProduct;
  pin: string;
  /** Deprecated from v21.0 onward; typed for callers still pinned below it. */
  data_localization_region?: string;
}

export interface RegisterPhoneNumberResponse {
  success: boolean;
}
