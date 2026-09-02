import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCalendarDays, localCalendarDate } from '@/lib/localDate';

/**
 * A form's default date is the day on the clock the person can see, not the
 * UTC day (CLAUDE.md: `toISOString()` for a calendar date is a bug). Without
 * this, a receipt entered late in the evening west of Greenwich is filed under
 * tomorrow, and at month end it moves into next month's margin.
 */

afterEach(() => vi.useRealTimers());

describe('localCalendarDate', () => {
  // 03:30 UTC on 1 March is still the evening of 28 February in Los Angeles,
  // and already 1 March in Auckland - the two readings that bracket the bug.
  const instant = new Date('2026-03-01T03:30:00.000Z');

  it('reads the day in the zone it was given, not the UTC day', () => {
    expect(localCalendarDate(instant, 'America/Los_Angeles')).toBe('2026-02-28');
    expect(localCalendarDate(instant, 'Pacific/Auckland')).toBe('2026-03-01');
    expect(localCalendarDate(instant, 'UTC')).toBe('2026-03-01');
  });

  it('disagrees with toISOString exactly where toISOString is wrong', () => {
    expect(localCalendarDate(instant, 'America/Los_Angeles')).not.toBe(
      instant.toISOString().slice(0, 10)
    );
  });

  it('defaults to now, in the zone this process runs in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);

    const expected = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    expect(localCalendarDate()).toBe(expected);
    expect(localCalendarDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addCalendarDays', () => {
  it('moves by whole calendar days, across a month end', () => {
    expect(addCalendarDays('2026-08-20', 14)).toBe('2026-09-03');
    expect(addCalendarDays('2026-12-25', 14)).toBe('2027-01-08');
  });

  it('is unmoved by a daylight-saving change inside the span', () => {
    // 8 March 2026 is when US clocks go forward; fourteen days from the 1st
    // is the 15th whatever the hours in between added up to.
    expect(addCalendarDays('2026-03-01', 14)).toBe('2026-03-15');
  });
});
