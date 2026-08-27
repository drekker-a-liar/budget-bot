import type { Cents } from '../money';
import { addCents, multiplyCents, percent, subtractCents } from '../money';
import type { ExpenseTransaction, Invoice, LaborEntry, SeverityLevel } from '../types';
import { getGrossMarginSeverity } from './thresholds';

export interface MonthlyMarginRange {
  /** Inclusive, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive, `YYYY-MM-DD`. */
  end: string;
}

export interface MonthlyMarginCogs {
  materials: Cents;
  labor: Cents;
  subcontractor: Cents;
  otherDirect: Cents;
  total: Cents;
}

export interface MonthlyMarginCounts {
  invoices: number;
  transactions: number;
  laborEntries: number;
}

export interface MonthlyMargin {
  /** `YYYY-MM`. */
  month: string;
  revenueCents: Cents;
  cogs: MonthlyMarginCogs;
  marginCents: Cents;
  /** Null when revenue is zero - never a fabricated number (ADR: Phase 1 realization fix). */
  marginPct: number | null;
  severity: SeverityLevel | 'none';
  counts: MonthlyMarginCounts;
}

export interface CalculateMonthlyMarginsInput {
  invoices: Invoice[];
  transactions: ExpenseTransaction[];
  laborEntries: LaborEntry[];
  range: MonthlyMarginRange;
  timeZone: string;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `postedAt` is an instant; the month (and day, for range checks) it falls on
 * depends on the owner's time zone. `en-CA` renders `Intl.DateTimeFormat` as
 * `YYYY-MM-DD` directly, so one formatted string serves both the range check
 * and the month bucket (its first 7 characters) below.
 */
function localDateString(instant: Date, timeZone: string): string {
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

/** Cash-basis cost date (spec §2): the bank's posted date, or the entered date. */
function transactionBucketDate(transaction: ExpenseTransaction, timeZone: string): string {
  return transaction.postedAt
    ? localDateString(new Date(transaction.postedAt), timeZone)
    : transaction.date;
}

function inRange(date: string, range: MonthlyMarginRange): boolean {
  return date >= range.start && date <= range.end;
}

/** Every calendar month `range.start` through `range.end` touches, as `YYYY-MM`. */
function monthsInRange(range: MonthlyMarginRange): string[] {
  const [startYear, startMonth] = range.start.split('-').map(Number);
  const [endYear, endMonth] = range.end.split('-').map(Number);

  const months: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Monthly gross margin, cash basis (ADR 0006). Revenue is paid invoices by
 * `paidDate`; cost of goods sold is non-ignored, non-pending, non-overhead
 * transactions by `postedAt ?? date`, plus labor entries by their date. Pure:
 * the range and time zone are inputs, never the wall clock.
 */
export function calculateMonthlyMargins({
  invoices,
  transactions,
  laborEntries,
  range,
  timeZone,
}: CalculateMonthlyMarginsInput): MonthlyMargin[] {
  const months = monthsInRange(range);

  const paidInvoices = invoices
    .filter((invoice): invoice is Invoice & { paidDate: string } =>
      invoice.status === 'paid' && !!invoice.paidDate
    )
    .filter((invoice) => inRange(invoice.paidDate, range));

  // Overhead is out of scope entirely (spec §2): it is neither a cogs bucket
  // nor counted as a contributing transaction, unlike project.ts's
  // otherDirectCosts which keeps every non-materials/non-subcontractor row.
  const costTransactions = transactions
    .filter((t) => t.status !== 'ignored' && !t.pending && t.category !== 'overhead')
    .map((transaction) => ({
      transaction,
      bucketDate: transactionBucketDate(transaction, timeZone),
    }))
    .filter(({ bucketDate }) => inRange(bucketDate, range));

  const rangeLabor = laborEntries.filter((entry) => inRange(entry.date, range));

  return months.map((month) => {
    const monthInvoices = paidInvoices.filter((invoice) => invoice.paidDate.slice(0, 7) === month);
    const monthCostTransactions = costTransactions.filter(
      ({ bucketDate }) => bucketDate.slice(0, 7) === month
    );
    const monthLabor = rangeLabor.filter((entry) => entry.date.slice(0, 7) === month);

    const revenueCents = addCents(...monthInvoices.map((invoice) => invoice.amountCents));

    const materials = addCents(
      ...monthCostTransactions
        .filter(({ transaction }) => transaction.category === 'materials')
        .map(({ transaction }) => transaction.amountCents)
    );
    const subcontractor = addCents(
      ...monthCostTransactions
        .filter(({ transaction }) => transaction.category === 'subcontractor')
        .map(({ transaction }) => transaction.amountCents)
    );
    const otherDirect = addCents(
      ...monthCostTransactions
        .filter(
          ({ transaction }) =>
            transaction.category !== 'materials' && transaction.category !== 'subcontractor'
        )
        .map(({ transaction }) => transaction.amountCents)
    );
    const labor = addCents(
      ...monthLabor.map((entry) => multiplyCents(entry.hourlyRateCents, entry.hours))
    );
    const total = addCents(materials, labor, subcontractor, otherDirect);

    const marginCents = subtractCents(revenueCents, total);
    const marginPct = percent(marginCents, revenueCents);
    const severity: SeverityLevel | 'none' =
      marginPct === null ? 'none' : getGrossMarginSeverity(marginPct);

    return {
      month,
      revenueCents,
      cogs: { materials, labor, subcontractor, otherDirect, total },
      marginCents,
      marginPct,
      severity,
      counts: {
        invoices: monthInvoices.length,
        transactions: monthCostTransactions.length,
        laborEntries: monthLabor.length,
      },
    };
  });
}
