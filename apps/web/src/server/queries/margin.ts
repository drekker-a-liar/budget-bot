import 'server-only';
import { cache } from 'react';
import { calculateMonthlyMargins, type MonthlyMargin } from '@budget-bot/core';
import { getDb, invoicesRepo, laborRepo, ownersRepo, transactionsRepo } from '@budget-bot/db';

/**
 * What the `/margin` page reads: the trailing 12 full months plus the current
 * month to date, cash basis (ADR 0006).
 */
export interface MonthlyMarginsPageData {
  months: MonthlyMargin[];
  timeZone: string;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `YYYY-MM-DD` for `instant` in `timeZone` - the same reading
 * `calculateMonthlyMargins` (`packages/core/src/metrics/monthly.ts`) takes of
 * its own inputs, kept here rather than shared: this is the one place that
 * gets to call `new Date()`, and that function never does.
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

/** The first of the month, `monthsBack` months before the month `today` (`YYYY-MM-DD`) falls in. */
function startOfTrailingWindow(today: string, monthsBack: number): string {
  const [year, month] = today.split('-').map(Number);
  const total = year * 12 + (month - 1) - monthsBack;
  const startYear = Math.floor(total / 12);
  const startMonth = (total % 12) + 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}

/**
 * `now` and the owner's time zone are read once, here, at the query edge -
 * `calculateMonthlyMargins` stays a pure function of the range and zone it is
 * given, never the wall clock (spec §2). The repos it reads from are
 * range-scoped (spec §3) rather than the owner's full history, the way the
 * neighbouring queries in this file read everything: a margin only ever
 * needs the trailing window, so there is no reason to fetch what falls
 * outside it.
 */
export const getMonthlyMargins = cache(
  async (ownerId: string): Promise<MonthlyMarginsPageData> => {
    const db = getDb();
    const timeZone = await ownersRepo.getTimeZone(db, ownerId);
    const end = localDateString(new Date(), timeZone);
    const start = startOfTrailingWindow(end, 12);
    const range = { start, end };

    const [invoices, transactions, laborEntries] = await Promise.all([
      invoicesRepo.listPaidInvoicesInRange(db, ownerId, range),
      transactionsRepo.listTransactionsInRange(db, ownerId, range),
      laborRepo.listLaborEntriesInRange(db, ownerId, range),
    ]);

    return {
      months: calculateMonthlyMargins({ invoices, transactions, laborEntries, range, timeZone }),
      timeZone,
    };
  }
);
