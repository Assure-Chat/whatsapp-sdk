import { describe, expect, it } from 'vitest';
import { verifySubscriptionChallenge } from '../src/index.js';

const EXPECTED = 'a_configured_verify_token';

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe('verifySubscriptionChallenge', () => {
  it('echoes the challenge for a correct token', () => {
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'subscribe',
        'hub.verify_token': EXPECTED,
        'hub.challenge': '1158201444',
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toEqual({ ok: true, challenge: '1158201444' });
  });

  it('accepts a plain record as the query', () => {
    const result = verifySubscriptionChallenge({
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': EXPECTED,
        'hub.challenge': '42',
      },
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toEqual({ ok: true, challenge: '42' });
  });

  it('returns the challenge verbatim, including non-numeric values', () => {
    // Meta documents an int, but the endpoint must echo whatever arrives —
    // coercing to a number would break the handshake if that ever changes.
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'subscribe',
        'hub.verify_token': EXPECTED,
        'hub.challenge': 'abc-123',
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toEqual({ ok: true, challenge: 'abc-123' });
  });

  it('rejects an incorrect token', () => {
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '1',
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toMatchObject({ ok: false, reason: 'token_mismatch' });
  });

  it('rejects a token that is a prefix of the expected one', () => {
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'subscribe',
        'hub.verify_token': EXPECTED.slice(0, -1),
        'hub.challenge': '1',
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toMatchObject({ ok: false, reason: 'token_mismatch' });
  });

  it.each([
    ['hub.mode', { 'hub.verify_token': EXPECTED, 'hub.challenge': '1' }],
    ['hub.verify_token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
    ['hub.challenge', { 'hub.mode': 'subscribe', 'hub.verify_token': EXPECTED }],
  ])('rejects a request missing %s', (_name, query) => {
    const result = verifySubscriptionChallenge({
      query: params(query),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toMatchObject({ ok: false, reason: 'missing_parameters' });
  });

  it('rejects a duplicated parameter rather than picking one', () => {
    const query = new URLSearchParams();
    query.append('hub.mode', 'subscribe');
    query.append('hub.verify_token', 'wrong_token');
    // A second value smuggled past a reader that takes the first.
    query.append('hub.verify_token', EXPECTED);
    query.append('hub.challenge', '1');

    const result = verifySubscriptionChallenge({ query, expectedVerifyToken: EXPECTED });
    expect(result).toMatchObject({ ok: false, reason: 'duplicate_parameters' });
  });

  it('rejects a duplicated parameter supplied as an array in a record', () => {
    const result = verifySubscriptionChallenge({
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': ['wrong_token', EXPECTED],
        'hub.challenge': '1',
      },
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toMatchObject({ ok: false, reason: 'duplicate_parameters' });
  });

  it('rejects a mode other than subscribe', () => {
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': EXPECTED,
        'hub.challenge': '1',
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_mode' });
  });

  it.each([
    ['empty', ''],
    ['oversized', 'x'.repeat(513)],
  ])('rejects a %s challenge', (_name, challenge) => {
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'subscribe',
        'hub.verify_token': EXPECTED,
        'hub.challenge': challenge,
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(result).toMatchObject({ ok: false, reason: 'malformed_challenge' });
  });

  it('fails closed when no verify token is configured', () => {
    // Without this, an endpoint configured with an empty expected token would
    // match an empty supplied token and verify anything.
    const result = verifySubscriptionChallenge({
      query: params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }),
      expectedVerifyToken: '',
    });
    expect(result).toMatchObject({ ok: false, reason: 'token_mismatch' });
  });

  it('never returns or embeds the expected token', () => {
    const result = verifySubscriptionChallenge({
      query: params({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '1',
      }),
      expectedVerifyToken: EXPECTED,
    });
    expect(JSON.stringify(result)).not.toContain(EXPECTED);
  });
});
