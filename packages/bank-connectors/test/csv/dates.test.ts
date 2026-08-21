import { describe, expect, it } from 'vitest';
import { normalizeCsvDate } from '../../src/csv/dates';

/**
 * The date a bank wrote, in ISO or not at all.
 *
 * `CsvRowSchema` wants `YYYY-MM-DD`, and every US bank export seen so far
 * writes `MM/DD/YYYY`, so before this every row of a real Chase or Capital One
 * statement came back as an error. Normalising happens here rather than in the
 * schema because the provider is the import boundary and already owns this
 * kind of translation.
 *
 * **US ordering is assumed.** `03/04/2026` is the 4th of March. There is no
 * way to tell it from the 3rd of April by looking at it, and a guess that is
 * wrong files a transaction in the wrong month silently, so `DD/MM/YYYY` is
 * not supported at all rather than supported by coin flip.
 */

describe('normalizeCsvDate', () => {
  it.each([
    ['ISO, which passes through untouched', '2026-08-18', '2026-08-18'],
    ['US slashes', '08/18/2026', '2026-08-18'],
    ['US slashes without leading zeros', '8/1/2026', '2026-08-01'],
    ['US dashes', '08-18-2026', '2026-08-18'],
    ['ISO with slashes', '2026/08/18', '2026-08-18'],
    ['surrounding space', '  08/18/2026  ', '2026-08-18'],
  ])('reads %s', (_label, raw, expected) => {
    expect(normalizeCsvDate(raw)).toBe(expected);
  });

  it.each([
    ['an empty cell', ''],
    ['only spaces', '   '],
    ['a two-digit year, which is ambiguous about the century', '08/18/26'],
    ['a month name', '18-Aug-2026'],
    ['a timestamp', '2026-08-18T00:00:00Z'],
    ['a day-first date, which is not supported on purpose', '18/08/2026'],
    ['something that is not a date at all', 'N/A'],
    ['trailing text', '08/18/2026 posted'],
  ])('refuses %s', (_label, raw) => {
    expect(normalizeCsvDate(raw)).toBeNull();
  });

  it.each([
    ['a day the month does not have', '02/30/2026'],
    ['the 29th of a February that is not a leap year', '02/29/2026'],
    ['a 13th month', '13/01/2026'],
    ['a zero month', '00/18/2026'],
    ['a zero day', '08/00/2026'],
    ['an ISO date that is equally impossible', '2026-02-30'],
  ])('refuses %s rather than rolling it into the next month', (_label, raw) => {
    expect(normalizeCsvDate(raw)).toBeNull();
  });

  it('accepts the 29th of February in a leap year', () => {
    expect(normalizeCsvDate('02/29/2028')).toBe('2028-02-29');
  });
});
