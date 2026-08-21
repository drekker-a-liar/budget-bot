import { addCents, percent, type Cents, type ExpenseCategory, type TransactionStatus } from '@budget-bot/core';

/**
 * Where the money went, split by category.
 *
 * Rows the user filed as `ignored` are left out of both the totals and the
 * denominator, for the same reason the weekly cash flow leaves them out: a
 * card payment or a refund is money moving, not money spent, and counting it
 * would make the denominator smaller than the categories it is dividing.
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
  const spent = rows.filter((row) => row.status !== 'ignored');
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
