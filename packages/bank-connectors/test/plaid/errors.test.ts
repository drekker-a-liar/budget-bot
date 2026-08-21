import { describe, expect, it } from 'vitest';
import {
  PlaidItemError,
  PlaidMutationDuringPagination,
  PlaidRateLimited,
  PlaidRequestError,
  toPlaidError,
} from '../../src/plaid/errors';
import errorItemLoginRequired from '../fixtures/plaid/error-item-login-required.json';
import errorMutation from '../fixtures/plaid/error-mutation.json';
import errorRateLimit from '../fixtures/plaid/error-rate-limit.json';

/**
 * The mapper on its own, at the edges the provider tests do not reach.
 *
 * Everything Plaid can fail with has to come out as one of four classes,
 * because the sync service's next move is decided by which one it caught:
 * back off (`PlaidRateLimited`), restart from the last committed cursor
 * (`PlaidMutationDuringPagination`), mark the connection as needing the user
 * (`PlaidItemError`), or stop (`PlaidRequestError`). A failure that does not
 * look like a Plaid response at all - a dropped socket, a proxy's HTML error
 * page - still has to land somewhere, so it lands on `PlaidRequestError` with
 * code `UNKNOWN` rather than escaping as a raw axios error.
 */

function response(body: unknown, status = 400, headers: Record<string, string> = {}): unknown {
  return { isAxiosError: true, response: { status, headers, data: body } };
}

describe('toPlaidError', () => {
  it('reads the retry hint out of the Retry-After header', () => {
    const error = toPlaidError({ isAxiosError: true, response: errorRateLimit });

    expect(error).toBeInstanceOf(PlaidRateLimited);
    expect((error as PlaidRateLimited).retryAfterSeconds).toBe(12);
  });

  it.each([
    ['a header in the casing axios normalises to', { 'retry-after': '30' }, 30],
    ['a header in the casing the RFC spells it', { 'Retry-After': '45' }, 45],
    ['a fractional hint, rounded up so the wait is never short', { 'retry-after': '2.4' }, 3],
  ])('reads %s', (_label, headers, expected) => {
    const error = toPlaidError(response(errorRateLimit.data, 429, headers));

    expect((error as PlaidRateLimited).retryAfterSeconds).toBe(expected);
  });

  it.each([
    ['no header at all', {}],
    ['an HTTP-date, which this does not parse', { 'retry-after': 'Fri, 21 Aug 2026 10:00:00 GMT' }],
    ['nonsense', { 'retry-after': '' }],
    ['a negative wait', { 'retry-after': '-5' }],
  ])('falls back to a minute given %s', (_label, headers) => {
    const error = toPlaidError(response(errorRateLimit.data, 429, headers));

    expect((error as PlaidRateLimited).retryAfterSeconds).toBe(60);
  });

  it('treats a 429 with no Plaid body as a rate limit anyway', () => {
    const error = toPlaidError(response('<html>Too Many Requests</html>', 429));

    expect(error).toBeInstanceOf(PlaidRateLimited);
    expect((error as PlaidRateLimited).retryAfterSeconds).toBe(60);
  });

  it('maps a mutation during pagination, whatever the status was', () => {
    expect(toPlaidError(response(errorMutation.data))).toBeInstanceOf(
      PlaidMutationDuringPagination
    );
  });

  it('maps any ITEM_ERROR, not only the one code the UI knows about', () => {
    const error = toPlaidError(
      response({
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_NOT_SUPPORTED',
        error_message: 'this item is not supported',
        display_message: null,
        request_id: 'req-1',
      })
    );

    expect(error).toBeInstanceOf(PlaidItemError);
    expect((error as PlaidItemError).code).toBe('ITEM_NOT_SUPPORTED');
  });

  it.each([
    ['a dropped socket', new Error('socket hang up')],
    ['a rejection that is not an error', 'nope'],
    ['nothing at all', undefined],
    ['a response with no body', { isAxiosError: true, response: { status: 502 } }],
  ])('maps %s to an unknown request failure', (_label, cause) => {
    const error = toPlaidError(cause);

    expect(error).toBeInstanceOf(PlaidRequestError);
    expect((error as PlaidRequestError).code).toBe('UNKNOWN');
    expect((error as PlaidRequestError).requestId).toBeUndefined();
  });

  it('builds the message from the Plaid error code and message only', () => {
    const error = toPlaidError(response(errorItemLoginRequired.data));

    expect(error.message).toContain('ITEM_LOGIN_REQUIRED');
    expect(error.message).toContain(errorItemLoginRequired.data.error_message);
  });

  it.each([
    ['PlaidRateLimited', () => toPlaidError(response(errorRateLimit.data, 429))],
    ['PlaidMutationDuringPagination', () => toPlaidError(response(errorMutation.data))],
    ['PlaidItemError', () => toPlaidError(response(errorItemLoginRequired.data))],
    ['PlaidRequestError', () => toPlaidError(new Error('socket hang up'))],
  ])('%s names itself, so a log line says which one it was', (name, build) => {
    expect(build().name).toBe(name);
  });

  /**
   * The request axios was making is on `error.config`, and its body is the
   * one place an access token appears. Nothing from there may survive the
   * mapping - not on the message, not as a `cause`, not as a stashed field -
   * because a typed provider error is the thing callers log (spec §9).
   */
  it('keeps nothing of the request axios was making', () => {
    const error = toPlaidError({
      isAxiosError: true,
      response: { status: 400, headers: {}, data: errorItemLoginRequired.data },
      config: {
        url: 'https://sandbox.plaid.com/transactions/sync',
        data: JSON.stringify({ access_token: 'access-sandbox-SECRET' }),
      },
    });

    expect(error.message).not.toContain('SECRET');
    expect(JSON.stringify(error)).not.toContain('SECRET');
    expect(error.cause).toBeUndefined();
  });

  /**
   * Defence in depth, for the one field the mapper does copy.
   *
   * `error_message` is free text from Plaid, and the message built out of it
   * is the thing callers log. Plaid does not put access tokens in it today -
   * but "does not today" is a property of somebody else's system, and the
   * cost of being wrong about it is a credential in a log file (spec §9). So
   * anything token-shaped is struck out on the way through, whichever
   * environment minted it.
   */
  it.each(['sandbox', 'development', 'production'])(
    'redacts an access-%s token that arrived in the error message',
    (environment) => {
      const token = `access-${environment}-9f3a1c2e-not-a-real-token`;
      const error = toPlaidError(
        response({
          error_type: 'INVALID_INPUT',
          error_code: 'INVALID_ACCESS_TOKEN',
          error_message: `provided access token ${token} is not valid`,
          request_id: 'req-redact-1',
        })
      );

      expect(error.message).not.toContain(token);
      expect(error.message).not.toContain('9f3a1c2e');
      expect(error.message).toContain('access-[redacted]');
      // The rest of the message survives: the point is a redaction, not a
      // blanket refusal to say what went wrong.
      expect(error.message).toContain('INVALID_ACCESS_TOKEN');
    }
  );

  it('leaves a message with nothing token-shaped in it exactly as it was', () => {
    const error = toPlaidError(
      response({
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_message: 'the login details of this item have changed',
      })
    );

    expect(error.message).toBe(
      'ITEM_LOGIN_REQUIRED: the login details of this item have changed'
    );
  });
});
