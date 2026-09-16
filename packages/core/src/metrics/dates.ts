/**
 * Calendar-date helpers shared by the metrics that have to ask "what day is
 * it for the owner?". Every metric in this package is a pure function of the
 * instant it is handed, never the wall clock, so these take the instant and
 * the owner's IANA zone as arguments and do the one conversion in one place.
 */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `YYYY-MM-DD` for `instant` as the owner sees it. An instant is the same
 * everywhere; the calendar day it falls on depends on the zone, and
 * `toISOString().slice(0, 10)` would answer for UTC (CLAUDE.md, time zones).
 * `en-CA` renders `Intl.DateTimeFormat` as `YYYY-MM-DD` directly, so one
 * formatted string serves both a range check and a month bucket (its first 7
 * characters).
 */
export function localDateString(instant: Date, timeZone: string): string {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

/**
 * Whole calendar days from `from` to `to`, both `YYYY-MM-DD`; negative when
 * `to` is the earlier date. Both are parsed as UTC midnight on purpose: they
 * are already calendar dates in the owner's zone, so a zone-aware parse would
 * re-apply the offset, and a local-time parse would let a DST change turn 24
 * hours into 23 and the division below into 0.96 days.
 */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}
