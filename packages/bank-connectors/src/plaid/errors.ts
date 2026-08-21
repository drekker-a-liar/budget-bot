/**
 * Plaid failures, as four things a caller can actually do something about.
 *
 * Plaid answers every failure with the same envelope - an HTTP status and a
 * body carrying `error_type`, `error_code`, `error_message` and `request_id` -
 * and the SDK hands it over as an axios error. That is one type for four
 * unrelated situations, and a sync service has to tell them apart to know
 * whether to wait, to retry from where it was, to ask the user for help, or to
 * stop. So the envelope is read once, here, and what comes out is a class:
 *
 * - `PlaidRateLimited` - wait `retryAfterSeconds` and try the same call again.
 * - `PlaidMutationDuringPagination` - the data moved mid-pagination; start
 *   again from the last cursor that was committed (ADR 0004).
 * - `PlaidItemError` - the connection itself needs the user, e.g.
 *   `ITEM_LOGIN_REQUIRED`. Record it and surface it; re-auth is Phase 3.
 * - `PlaidRequestError` - everything else, including failures that never
 *   reached Plaid at all.
 *
 * ## Nothing of the request survives
 *
 * The access token is in the *request* body, which axios attaches to the error
 * it throws as `error.config.data`. None of that is carried across: no
 * `cause`, no stashed original, no interpolation of anything but
 * `error_code` and `error_message` into the message. A typed provider error is
 * what callers log (spec §9), so if the token were reachable from one it would
 * be one `console.error` away from a log file. `request_id` is carried instead,
 * which is the field support actually asks for.
 */

/** Plaid's error body, as much of it as the mapping reads. */
interface PlaidErrorBody {
  error_type?: string;
  error_code: string;
  error_message?: string;
  request_id?: string;
}

const RATE_LIMIT_CODE = 'RATE_LIMIT_EXCEEDED';
const MUTATION_CODE = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';
const ITEM_ERROR_TYPE = 'ITEM_ERROR';
const UNKNOWN_CODE = 'UNKNOWN';

/** Plaid asks for a minute when it does not say how long to wait. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export class PlaidRateLimited extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'PlaidRateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PlaidMutationDuringPagination extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaidMutationDuringPagination';
  }
}

export class PlaidItemError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlaidItemError';
    this.code = code;
  }
}

export class PlaidRequestError extends Error {
  readonly code: string;
  readonly requestId?: string;

  constructor(code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'PlaidRequestError';
    this.code = code;
    this.requestId = requestId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlaidErrorBody(value: unknown): value is PlaidErrorBody {
  return isRecord(value) && typeof value.error_code === 'string';
}

/**
 * Headers as they arrive, which is not one shape.
 *
 * Axios normalises response header names to lower case, but the mapper also
 * sees plain objects from fixtures and from anything else that fills in this
 * envelope, so the lookup is case-insensitive rather than trusting either.
 */
function headerValue(headers: unknown, name: string): string | undefined {
  if (!isRecord(headers)) return undefined;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return undefined;
}

/**
 * `Retry-After` in seconds, rounded up so the wait is never short.
 *
 * The header may also be an HTTP-date. That form is not parsed: it would need
 * a clock to turn into a duration, and getting it wrong in the optimistic
 * direction means hammering an endpoint that is already refusing. A minute is
 * the safe answer to anything this cannot read.
 */
function retryAfterSeconds(headers: unknown): number {
  const raw = headerValue(headers, 'retry-after');
  if (raw === undefined) return DEFAULT_RETRY_AFTER_SECONDS;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.ceil(seconds);
}

/** Built from the Plaid error code and message, and from nothing else. */
function describe(body: PlaidErrorBody | undefined): string {
  if (body === undefined) return 'The Plaid request failed without a Plaid error body.';
  return body.error_message === undefined
    ? body.error_code
    : `${body.error_code}: ${body.error_message}`;
}

/**
 * Whatever the SDK threw, as one of the four provider errors.
 *
 * A failure that never reached Plaid - a dropped socket, a proxy's HTML error
 * page, a rejection that is not an `Error` at all - is not special-cased into
 * something else; it comes out as `PlaidRequestError('UNKNOWN')`, so callers
 * have exactly four cases to handle and no fifth escape route.
 */
export function toPlaidError(cause: unknown): Error {
  const response = isRecord(cause) && isRecord(cause.response) ? cause.response : undefined;
  const data: unknown = response?.data;
  const body = isPlaidErrorBody(data) ? data : undefined;
  const message = describe(body);
  const code = body?.error_code ?? UNKNOWN_CODE;

  // A 429 is a rate limit even when the body is unreadable, which is exactly
  // when it comes from a gateway in front of Plaid rather than from Plaid.
  // `RATE_LIMIT_EXCEEDED` is Plaid's `error_type`; the `error_code` beside it
  // names the endpoint that was throttled (`TRANSACTIONS_LIMIT`, ...), and
  // both are checked so neither spelling of the envelope slips through.
  if (
    response?.status === 429 ||
    body?.error_type === RATE_LIMIT_CODE ||
    code === RATE_LIMIT_CODE
  ) {
    return new PlaidRateLimited(message, retryAfterSeconds(response?.headers));
  }
  if (code === MUTATION_CODE) return new PlaidMutationDuringPagination(message);
  if (body?.error_type === ITEM_ERROR_TYPE) return new PlaidItemError(code, message);
  return new PlaidRequestError(code, message, body?.request_id);
}
