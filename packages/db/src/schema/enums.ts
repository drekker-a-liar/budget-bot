import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enum types are database-global objects rather than table columns,
 * and `transaction_source` is shared by two tables, so they are declared
 * together here instead of inside whichever aggregate happened to need one
 * first. Values mirror the zod enums in `@budget-bot/core` exactly - the
 * schemas there are the definition, these are the storage of it.
 */

export const projectStatus = pgEnum('project_status', [
  'estimating',
  'in_progress',
  'completed',
  'on_hold',
]);

export const pricingType = pgEnum('pricing_type', ['fixed', 'time_and_materials']);

export const expenseCategory = pgEnum('expense_category', [
  'materials',
  'tools',
  'subcontractor',
  'mileage_fuel',
  'permits_fees',
  'overhead',
]);

export const paymentMethod = pgEnum('payment_method', ['card', 'cash', 'check', 'transfer']);

export const transactionStatus = pgEnum('transaction_status', [
  'matched',
  'unassigned',
  'ignored',
]);

export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'overdue']);

/** Where a row entered the system: typed in, imported from a file, or synced. */
export const transactionSource = pgEnum('transaction_source', ['manual', 'csv', 'plaid']);
