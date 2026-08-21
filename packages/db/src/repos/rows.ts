/**
 * The three conversions every repository repeats when it turns a database row
 * into a domain value. The domain (`@budget-bot/core`) speaks ISO strings and
 * optional properties; Postgres speaks `Date` and `null`.
 */

/** Timestamps cross the boundary as ISO strings, the shape the domain uses. */
export const toIso = (value: Date): string => value.toISOString();

/** A nullable timestamp crosses the boundary as an ISO string, or stays null. */
export const toIsoOrNull = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/** `null` is how Postgres spells absent; the domain types spell it `undefined`. */
export const orUndefined = <T>(value: T | null): T | undefined => value ?? undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres raises a type error rather than returning no rows when a `uuid`
 * column is compared with something that is not a uuid - a stale bookmark from
 * the JSON store's `proj-1` ids, say. Every lookup by id checks first so that
 * "no such row" stays a 404 instead of becoming a 500.
 */
export const isUuid = (value: string): boolean => UUID.test(value);
