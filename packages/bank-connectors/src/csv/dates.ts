/**
 * The date a bank wrote, turned into the one the domain speaks.
 *
 * `CsvRowSchema.date` wants `YYYY-MM-DD` (ADR 0007's sibling rule: the domain
 * speaks ISO strings), and US bank exports - Chase, Capital One, and by every
 * indication a credit union's - write `MM/DD/YYYY`. Without this, a
 * self-hoster's first upload came back with every row rejected and the reason
 * "Expected a YYYY-MM-DD date", which is true and useless.
 *
 * This runs in the provider rather than in the schema because the provider is
 * the import boundary and already does this kind of translation: `parseMoney`
 * for the amount, the header alias table for the columns.
 *
 * ## US ordering is assumed, and ambiguity is refused
 *
 * `03/04/2026` is read as the 4th of March. Nothing in a file says which
 * ordering a bank used, and a wrong guess files a transaction in the wrong
 * month without saying so - a silent error in the one number this product is
 * about. So `DD/MM/YYYY` is not supported: `18/08/2026` is rejected rather
 * than read as either date.
 *
 * The calendar is checked too, in every form including ISO. `02/30/2026` is
 * not a date, and `new Date('2026-02-30')` rolls it into the 2nd of March,
 * which is a date the statement does not contain.
 */

/** Said in error messages, so the user is told what would have worked. */
export const ACCEPTED_DATE_FORMATS = 'YYYY-MM-DD or MM/DD/YYYY';

/** `M/D/YYYY`, `MM/DD/YYYY`, `MM-DD-YYYY`: month first, four-digit year. */
const US_ORDER = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
/** `YYYY-MM-DD` and `YYYY/MM/DD`: year first, which is never ambiguous. */
const ISO_ORDER = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Whether these three numbers are a day that exists. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one, in local time, which
  // is all that is being asked here - no instant is being constructed.
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  return day <= lastDayOfMonth;
}

/**
 * `raw` as `YYYY-MM-DD`, or null when it is not a date this importer will
 * guess at. A two-digit year is refused along with everything else: `08/18/26`
 * has a century somebody would have to assume.
 */
export function normalizeCsvDate(raw: string): string | null {
  const text = raw.trim();

  const iso = ISO_ORDER.exec(text);
  const us = iso ? null : US_ORDER.exec(text);
  if (!iso && !us) return null;

  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(us![3]), Number(us![1]), Number(us![2])];

  if (!isRealDate(year, month, day)) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}
