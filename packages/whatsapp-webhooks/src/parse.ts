import type {
  WabaId,
  WebhookChange,
  WebhookEntry,
  WebhookPayload,
} from '@assure-ai/whatsapp-types';
import { toRawBytes } from './bytes.js';

/**
 * Parsing and structural validation of a verified webhook body.
 *
 * Everything here assumes `verifyWebhookSignature` has already returned `ok`.
 * Parsing an unverified body means acting on attacker-chosen structure, so the
 * API is shaped to make the wrong order awkward: `parseWebhookPayload` takes
 * bytes, and the documented example never reaches it without a signature check
 * above it.
 *
 * Validation is structural, not exhaustive. The envelope — `object`, `entry`,
 * `changes`, `field`, `value` — is checked because normalization indexes into
 * it. Individual `value` fields are not, because Meta adds them without notice
 * and a strict check would start rejecting real traffic on a Tuesday.
 */

export type WebhookParseFailureReason =
  | 'body_too_large'
  | 'empty_body'
  | 'malformed_json'
  | 'not_an_object'
  | 'unexpected_object'
  | 'missing_entry'
  | 'no_valid_changes';

export type WebhookParseResult =
  | { ok: true; payload: WebhookPayload }
  | { ok: false; reason: WebhookParseFailureReason; message: string };

export interface ParseWebhookOptions {
  /**
   * Reject bodies over this size before parsing. Defaults to 1 MiB, comfortably
   * above Meta's documented 1000-update batch. Set `0` to disable.
   */
  maxBodyBytes?: number;
  /**
   * Cap on `entry` array length. Meta batches up to 1000 updates; the default
   * matches that. A batch beyond it is a signal worth surfacing, not silently
   * truncating.
   */
  maxEntries?: number;
  /** Cap on `changes` per entry. */
  maxChangesPerEntry?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_CHANGES = 1000;

/**
 * Keys that must never be copied off an untrusted object.
 *
 * Meta does not send these, but a forged body that survived signature checking
 * (an attacker who holds the app secret, or a mis-wired test harness) could.
 * Assigning `__proto__` from a parsed payload onto an object is the classic
 * prototype-pollution step, so provider objects are never spread or merged —
 * and where one is walked, this list is consulted.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True when `value` is a plain object safe to index into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively assert that no object in the payload carries a dangerous key.
 *
 * Bounded by depth so a deeply nested body cannot exhaust the stack. Meta's
 * payloads are at most about six levels deep; anything past the limit is
 * treated as suspicious rather than walked further.
 */
function hasForbiddenKeys(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeys(item, depth + 1));
  }
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeys(value[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Parse a verified body into a typed payload.
 *
 * Accepts bytes or a string. A parsed object is not accepted, because a caller
 * holding one has already lost the ability to have verified it.
 */
export function parseWebhookPayload(
  rawBody: Uint8Array | ArrayBuffer | string,
  options: ParseWebhookOptions = {},
): WebhookParseResult {
  const bytes = toRawBytes(rawBody);
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (limit > 0 && bytes.length > limit) {
    return {
      ok: false,
      reason: 'body_too_large',
      message: `Body of ${bytes.length} bytes exceeds the ${limit}-byte limit`,
    };
  }
  if (bytes.length === 0) {
    return { ok: false, reason: 'empty_body', message: 'The delivery had an empty body' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // The parser's own message can quote body content; it is not repeated.
    return { ok: false, reason: 'malformed_json', message: 'The delivery body is not valid JSON' };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      reason: 'not_an_object',
      message: 'Expected a JSON object at the top level',
    };
  }

  if (hasForbiddenKeys(parsed)) {
    return {
      ok: false,
      reason: 'not_an_object',
      message: 'The payload contains a prototype-polluting key',
    };
  }

  const object = parsed['object'];
  if (typeof object !== 'string') {
    return {
      ok: false,
      reason: 'unexpected_object',
      message: 'The payload has no string `object` property',
    };
  }
  if (object !== 'whatsapp_business_account') {
    // Another Meta product's webhook pointed at this endpoint. Refusing is
    // safer than normalizing something whose schema was never reviewed here.
    return {
      ok: false,
      reason: 'unexpected_object',
      message: `Expected object "whatsapp_business_account", got "${object}"`,
    };
  }

  const rawEntries = parsed['entry'];
  if (!Array.isArray(rawEntries)) {
    return {
      ok: false,
      reason: 'missing_entry',
      message: 'The payload has no `entry` array',
    };
  }

  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (rawEntries.length > maxEntries) {
    return {
      ok: false,
      reason: 'body_too_large',
      message: `Batch of ${rawEntries.length} entries exceeds the ${maxEntries}-entry limit`,
    };
  }

  const maxChanges = options.maxChangesPerEntry ?? DEFAULT_MAX_CHANGES;
  const entries: WebhookEntry[] = [];

  for (const rawEntry of rawEntries) {
    if (!isPlainObject(rawEntry)) continue;
    const id = rawEntry['id'];
    if (typeof id !== 'string' || id === '') continue;

    const rawChanges = rawEntry['changes'];
    if (!Array.isArray(rawChanges) || rawChanges.length > maxChanges) continue;

    const changes: WebhookChange[] = [];
    for (const rawChange of rawChanges) {
      if (!isPlainObject(rawChange)) continue;
      const field = rawChange['field'];
      if (typeof field !== 'string' || field === '') continue;
      if (!('value' in rawChange)) continue;
      changes.push({ field, value: rawChange['value'] } as WebhookChange);
    }
    if (changes.length === 0) continue;

    const entry: WebhookEntry = { id: id as WabaId, changes };
    const time = rawEntry['time'];
    if (typeof time === 'number' && Number.isFinite(time)) entry.time = time;
    entries.push(entry);
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'no_valid_changes',
      message: 'No entry carried a usable `changes` array',
    };
  }

  return {
    ok: true,
    payload: { object: 'whatsapp_business_account', entry: entries },
  };
}
