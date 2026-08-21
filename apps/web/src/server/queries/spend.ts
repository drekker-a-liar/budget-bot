import { addCents, percent, type Cents, type ExpenseCategory, type TransactionStatus } from '@budget-bot/core';

/**
 * Where the money went, split by category.
 *
 * Only money that actually went out is counted, in the totals and in the
 * denominator alike. That means two exclusions, not one: rows the user filed
 * as `ignored`, and any row with a negative amount. `ignored` is the default
 * a refund arrives with, not a guarantee it keeps - the user can file one
 * against a job - and a negative left in the denominator makes it smaller
 * than the categories it is meant to divide, which is how this page came to
 * report "Materials & Lumber 135%".
 */

export interface CategorySpend {
  amountCents: Cents;
  /** Share of the total, one decimal place. Zero when nothing was spent. */
  pct: number;
}

export interface SpendBreakdown {
  totalCents: Cents;
  byCategory: Record<ExpenseCategory, CategorySpend>;
}

export interface SpendRow {
  category: ExpenseCategory;
  amountCents: Cents;
  status: TransactionStatus;
}

const CATEGORIES: ExpenseCategory[] = [
  'materials',
  'tools',
  'subcontractor',
  'mileage_fuel',
  'permits_fees',
  'overhead',
];

export function spendByCategory(rows: SpendRow[]): SpendBreakdown {
  const spent = rows.filter((row) => row.status !== 'ignored' && row.amountCents > 0);
  const totalCents = addCents(...spent.map((row) => row.amountCents));

  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => {
      const amountCents = addCents(
        ...spent.filter((row) => row.category === category).map((row) => row.amountCents)
      );
      return [category, { amountCents, pct: percent(amountCents, totalCents) ?? 0 }];
    })
  ) as Record<ExpenseCategory, CategorySpend>;

  return { totalCents, byCategory };
}
