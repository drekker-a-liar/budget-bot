import type { ExpenseTransaction, Invoice, LaborEntry, Project } from '@budget-bot/core';
import { SEED_INVOICES, SEED_LABOR, SEED_PROJECTS, SEED_TRANSACTIONS } from './fixtures';

/**
 * The fixtures are authored against one fixed month and, left alone, would
 * age out of the trailing 13-month margin window about a year later — an
 * evergreen demo needs its "couple of months of business" to end near
 * whenever the seed runs. Every date is therefore shifted forward by whole
 * calendar months at seed time.
 *
 * Whole months, not days: every intra-month ordering the fixtures were
 * authored with survives the move. The one edge is a day the target month
 * does not have, which clamps to that month's last day (Jul 31 → Jun 30).
 */

/** The month the fixture dates are authored against, in their own Pacific zone. */
export const FIXTURE_ANCHOR_MONTH = '2026-08';

/** Whole calendar months from the anchor to `now`, as observed in `timeZone`. */
export function monthsSinceAnchor(now: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  const [nowYear, nowMonth] = formatted.split('-').map(Number);
  const [anchorYear, anchorMonth] = FIXTURE_ANCHOR_MONTH.split('-').map(Number);
  return (nowYear - anchorYear) * 12 + (nowMonth - anchorMonth);
}

/**
 * Shifts the date part of a `YYYY-MM-DD` or ISO-timestamp string by whole
 * months, clamping the day to the target month's length. Anything after the
 * first ten characters (a timestamp's time) is kept verbatim.
 */
export function shiftDate(value: string, deltaMonths: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const monthIndex = year * 12 + (month - 1) + deltaMonths;
  const shiftedYear = Math.floor(monthIndex / 12);
  const shiftedMonth = (monthIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(shiftedYear, shiftedMonth, 0)).getUTCDate();
  const shiftedDay = Math.min(day, lastDay);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shiftedYear}-${pad(shiftedMonth)}-${pad(shiftedDay)}${value.slice(10)}`;
}

type Nullish<T> = T | null | undefined;

export interface ShiftedSeedFixtures {
  projects: Project[];
  transactions: ExpenseTransaction[];
  laborEntries: LaborEntry[];
  invoices: Invoice[];
}

/** The seed fixtures with every dated field moved by `deltaMonths`. */
export function shiftedSeedFixtures(deltaMonths: number): ShiftedSeedFixtures {
  if (deltaMonths === 0) {
    return {
      projects: SEED_PROJECTS,
      transactions: SEED_TRANSACTIONS,
      laborEntries: SEED_LABOR,
      invoices: SEED_INVOICES,
    };
  }

  const shift = (value: string) => shiftDate(value, deltaMonths);
  const maybe = <T extends Nullish<string>>(value: T): T =>
    (value == null ? value : (shift(value) as T));

  return {
    projects: SEED_PROJECTS.map((project) => ({
      ...project,
      startDate: shift(project.startDate),
      deadlineDate: maybe(project.deadlineDate),
      completedDate: maybe(project.completedDate),
      createdAt: shift(project.createdAt),
      updatedAt: maybe(project.updatedAt),
    })),
    transactions: SEED_TRANSACTIONS.map((transaction) => ({
      ...transaction,
      date: shift(transaction.date),
      postedAt: maybe(transaction.postedAt),
      removedAt: maybe(transaction.removedAt),
      userEditedAt: maybe(transaction.userEditedAt),
      createdAt: shift(transaction.createdAt),
      updatedAt: maybe(transaction.updatedAt),
    })),
    laborEntries: SEED_LABOR.map((entry) => ({
      ...entry,
      date: shift(entry.date),
      createdAt: shift(entry.createdAt),
      updatedAt: maybe(entry.updatedAt),
    })),
    invoices: SEED_INVOICES.map((invoice) => ({
      ...invoice,
      dateIssued: shift(invoice.dateIssued),
      dueDate: shift(invoice.dueDate),
      paidDate: maybe(invoice.paidDate),
      createdAt: shift(invoice.createdAt),
      updatedAt: maybe(invoice.updatedAt),
    })),
  };
}
