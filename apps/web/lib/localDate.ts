/**
 * The calendar day a person is looking at, as `YYYY-MM-DD`.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, and a contractor
 * logging a receipt at nine in the evening in Denver is already on tomorrow's
 * date by that reading - so the expense lands in the wrong day and, at the turn
 * of a month, in the wrong month's margin. `Intl.DateTimeFormat` reads the
 * same instant in a named zone instead, and `en-CA` is the locale whose
 * numeric date happens to be ISO-ordered, so no string surgery is needed.
 *
 * With no `timeZone` the browser's own zone is used, which is what a form
 * default in a client component should follow: it is the day on the clock the
 * person can see. Server code that needs the *owner's* day passes their stored
 * `settings.timeZone` (see `queries/margin.ts`), never the server's clock.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      ...(timeZone ? { timeZone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** `instant` (now, by default) as the calendar day in `timeZone` or the local zone. */
export function localCalendarDate(instant: Date = new Date(), timeZone?: string): string {
  return formatterFor(timeZone).format(instant);
}

/**
 * `date` (`YYYY-MM-DD`) moved by `days` calendar days.
 *
 * The arithmetic is done on the date's fields in UTC rather than by adding
 * `days * 86_400_000` to a timestamp: the second gives a different answer when
 * a daylight-saving change falls inside the span and the instant sits close to
 * midnight, and an invoice due date is a calendar promise, not a number of
 * hours.
 */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return localCalendarDate(new Date(Date.UTC(year, month - 1, day + days)), 'UTC');
}
