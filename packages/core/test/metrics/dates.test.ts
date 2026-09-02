import { describe, expect, it } from 'vitest';
import { daysBetween, localDateString } from '../../src/metrics/dates';

/**
 * The two calendar questions every date-aware metric asks. Without these, a
 * regression to `toISOString().slice(0, 10)` (UTC's day, not the owner's) or
 * to a local-time `new Date('YYYY-MM-DD')` (DST turns a day into 23 hours)
 * would only show up as an invoice going overdue an evening early or late.
 */
describe('localDateString', () => {
  // 03:00Z on the 20th is still the evening of the 19th on the US west coast.
  const instant = new Date('2026-08-20T03:00:00.000Z');

  it('answers with the calendar day in the owner zone, not UTC', () => {
    expect(localDateString(instant, 'UTC')).toBe('2026-08-20');
    expect(localDateString(instant, 'America/Los_Angeles')).toBe('2026-08-19');
  });

  it('runs ahead of UTC for a zone east of it', () => {
    // 20:00Z on the 19th is already 08:00 on the 20th in Auckland.
    expect(localDateString(new Date('2026-08-19T20:00:00.000Z'), 'Pacific/Auckland')).toBe(
      '2026-08-20'
    );
  });

  it('renders YYYY-MM-DD, zero-padded, so it sorts and slices as a date', () => {
    expect(localDateString(new Date('2026-01-05T12:00:00.000Z'), 'UTC')).toBe('2026-01-05');
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days, forward', () => {
    expect(daysBetween('2026-08-19', '2026-08-20')).toBe(1);
    expect(daysBetween('2026-07-21', '2026-08-20')).toBe(30);
  });

  it('is zero on the same day and negative when `to` is earlier', () => {
    expect(daysBetween('2026-08-20', '2026-08-20')).toBe(0);
    expect(daysBetween('2026-08-20', '2026-08-19')).toBe(-1);
  });

  it('is not thrown off by a daylight-saving change between the two dates', () => {
    // US clocks go forward on 2026-03-08. A local-time parse would make this
    // 47 hours and the division 1.96, which floors to 1.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});
