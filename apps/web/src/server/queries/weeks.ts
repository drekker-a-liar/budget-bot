import {
  addCents,
  subtractCents,
  type Cents,
  type InvoiceStatus,
  type TransactionStatus,
  type WeeklyCashFlow,
} from '@budget-bot/core';

/**
 * The last few weeks of cash, on a cash basis (ADR 0006).
 *
 * This lives in the application rather than in `@budget-bot/core` on purpose.
 * The monthly gross margin function is sub-project 4's, and it is where the
 * calendar questions get settled properly - the user's time zone, month
 * boundaries, what a "period" is. Putting a second, weekly answer to those
 * questions in core now would mean two calendars to reconcile later. So: a
 * small tested helper here, lifted into core when there is one calendar for it
 * to join.
 *
 * Weeks are ISO weeks in UTC, Monday to Sunday. `now` is a parameter, never
 * `new Date()`, so this is a function of its input and a test can pin a
 * boundary.
 *
 * No `parseMoney` here: everything arriving is already `Cents`.
 */

/** What this needs of an expense, and nothing more. */
export interface CashOutflowRow {
  date: string;
  /**
   * When the bank says it posted. A Saturday swipe that posts on Monday
   * belongs to the week the money left. The repository does not surface this
   * column yet, so it is optional - the rule is written down so that when it
   * does, nothing has to move.
   */
  postedAt?: string | Date | null;
  amountCents: Cents;
  status: TransactionStatus;
}

/** What this needs of an invoice. */
export interface CashInflowRow {
  status: InvoiceStatus;
  paidDate?: string;
  amountCents: Cents;
}

export interface CashFlowInputs {
  transactions: CashOutflowRow[];
  invoices: CashInflowRow[];
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_WEEKS = 4;

/** Whole days since the epoch, in UTC. */
function dayNumberOf(value: string | Date): number | null {
  const ms =
    value instanceof Date
      ? Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
      : Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / MS_PER_DAY);
}

/**
 * The Monday of the week a day falls in. Day 0 of the epoch was a Thursday,
 * which is three days into a Monday-first week - hence the `+ 3`.
 */
function mondayOf(dayNumber: number): number {
  return dayNumber - ((dayNumber + 3) % 7);
}

function isoDateOf(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

export function calculateWeeklyCashFlow(
  { transactions, invoices }: CashFlowInputs,
  now: Date,
  weekCount: number = DEFAULT_WEEKS
): WeeklyCashFlow[] {
  const lastMonday = mondayOf(dayNumberOf(now) as number);
  const firstMonday = lastMonday - (weekCount - 1) * 7;

  const inflows = new Array<number>(weekCount).fill(0);
  const outflows = new Array<number>(weekCount).fill(0);

  /** Which bucket a day belongs to, or -1 when it is outside the window. */
  const bucketOf = (day: number | null): number => {
    if (day === null) return -1;
    const index = Math.floor((mondayOf(day) - firstMonday) / 7);
    return index >= 0 && index < weekCount ? index : -1;
  };

  for (const row of transactions) {
    // An ignored row is a refund or a card payment: real, but counting it as
    // spend would double-count the purchases it settles (spec §8). A negative
    // row the user did file against a job is still money coming back, not
    // going out - the same rule `spendByCategory` and the business summary
    // apply, so the KPI and this waterfall describe the same week.
    if (row.status === 'ignored' || row.amountCents <= 0) continue;
    const bucket = bucketOf(dayNumberOf(row.postedAt ?? row.date));
    if (bucket >= 0) outflows[bucket] += row.amountCents;
  }

  for (const invoice of invoices) {
    // Cash basis: an invoice is revenue on the day it was paid, and an unpaid
    // one is not revenue at all.
    if (invoice.status !== 'paid' || !invoice.paidDate) continue;
    const bucket = bucketOf(dayNumberOf(invoice.paidDate));
    if (bucket >= 0) inflows[bucket] += invoice.amountCents;
  }

  return Array.from({ length: weekCount }, (_unused, index) => {
    const inflowCents = addCents(inflows[index] as Cents);
    const outflowCents = addCents(outflows[index] as Cents);
    return {
      weekStart: isoDateOf(firstMonday + index * 7),
      inflowCents,
      outflowCents,
      netCents: subtractCents(inflowCents, outflowCents),
    };
  });
}
