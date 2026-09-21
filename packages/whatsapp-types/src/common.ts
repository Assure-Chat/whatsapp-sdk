import type { GraphApiVersion, PagingCursor, PhoneNumberId, WabaId } from './brands.js';

/**
 * A documented value, without closing the union forever.
 *
 * Meta adds enum members without a version bump — `played` appeared on message
 * statuses, `marketing_lite` on pricing categories. A closed union would make
 * every such addition a type error in the consumer and, worse, a runtime
 * rejection in a webhook handler that had exhaustively switched on it. The
 * `(string & {})` arm keeps editor completion for the known values while
 * letting an unknown one through as a plain string.
 *
 * Pair it with {@link isKnown} at the boundary, and with an explicit `default`
 * branch in every switch.
 */
export type KnownOr<T extends string> = T | (string & {});

/**
 * Narrow a {@link KnownOr} value to its documented members.
 *
 * ```ts
 * if (isKnown(status.status, MESSAGE_STATUSES)) {
 *   // status.status is MessageDeliveryStatus here
 * }
 * ```
 */
export function isKnown<T extends string>(value: KnownOr<T>, known: readonly T[]): value is T {
  return (known as readonly string[]).includes(value);
}

/**
 * A provider value that is not in the documented set.
 *
 * Returned by normalization rather than thrown, so an unrecognized status or
 * event kind stays observable — and countable — instead of becoming a 500 on
 * the webhook endpoint.
 */
export interface UnknownProviderValue {
  readonly kind: 'unknown-provider-value';
  /** Where the value appeared, e.g. `statuses[0].status`. */
  readonly path: string;
  /** The raw value, as received. Never a destination or message body. */
  readonly value: string;
}

/** Graph's cursor pair. Both sides are absent on a single-page result. */
export interface GraphCursors {
  before?: PagingCursor;
  after?: PagingCursor;
}

/**
 * Graph's paging envelope.
 *
 * `next`/`previous` are absolute URLs that already carry the access token as a
 * query parameter when Graph generates them. This package never follows them
 * verbatim for that reason — see the `nextPage` handling in
 * `@assure-ai/whatsapp-api`, which re-derives the request from the cursor and
 * an Authorization header instead.
 */
export interface GraphPaging {
  cursors?: GraphCursors;
  next?: string;
  previous?: string;
}

/** A cursor-paginated Graph collection. */
export interface GraphPage<T> {
  data: T[];
  paging?: GraphPaging;
}

/** Graph's `{ "success": true }` acknowledgement. */
export interface GraphSuccessResponse {
  success: boolean;
}

/**
 * Meta's error envelope, as returned inside `{ "error": ... }`.
 *
 * `error_subcode` is documented as deprecated and omitted from v16.0 onward,
 * but older WABAs and some edges still emit it, so it stays optional rather
 * than being dropped.
 */
export interface GraphErrorDetail {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_data?: {
    messaging_product?: string;
    details?: string;
  };
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
  fbtrace_id?: string;
}

/** The top-level shape of a Graph failure body. */
export interface GraphErrorResponse {
  error: GraphErrorDetail;
}

/**
 * Connection metadata that is safe to serialize, log, and store.
 *
 * Deliberately has no `accessToken`, no `appSecret`, and no `verifyToken`
 * property — not an optional one, not a redacted one. A type that cannot
 * express a secret cannot leak one through `JSON.stringify`, and there is no
 * "just this once" path for a caller to add one.
 */
export interface WhatsAppConnectionMetadata {
  /** The Graph API version this connection is pinned to. */
  graphApiVersion: GraphApiVersion;
  /** Graph host in use, e.g. `https://graph.facebook.com`. */
  baseUrl: string;
  /** WABA this connection acts on, when the caller scoped it to one. */
  wabaId?: WabaId;
  /** Business phone number this connection sends from, when scoped. */
  phoneNumberId?: PhoneNumberId;
}

/**
 * Meta's `messaging_product` discriminator. Always `"whatsapp"` here, and
 * required on every Cloud API request body that has one.
 */
export type MessagingProduct = 'whatsapp';
