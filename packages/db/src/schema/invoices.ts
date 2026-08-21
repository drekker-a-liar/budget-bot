import { date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { cents, createdAt, ownerId, updatedAt } from './columns';
import { invoiceStatus } from './enums';
import { projects } from './projects';

/**
 * Money owed and money received. Margin is cash basis (ADR 0006), so revenue
 * is read from paid invoices by `paid_date` - hence the index on it.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    amountCents: cents('amount_cents').notNull(),
    depositAmountCents: cents('deposit_amount_cents').notNull(),
    dateIssued: date('date_issued', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: invoiceStatus('status').notNull(),
    paidDate: date('paid_date', { mode: 'string' }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('invoices_owner_paid_date_idx').on(table.ownerId, table.paidDate),
    index('invoices_owner_status_idx').on(table.ownerId, table.status),
    index('invoices_owner_project_idx').on(table.ownerId, table.projectId),
  ]
);
