import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bankAccounts } from './bank';
import { cents, createdAt, ownerId, updatedAt } from './columns';
import {
  expenseCategory,
  paymentMethod,
  transactionSource,
  transactionStatus,
} from './enums';
import { importBatches } from './importBatches';
import { projects } from './projects';

/**
 * An expense. The first block of columns is what the user owns - what they
 * typed or corrected - and the second is what a bank feed owns. The sync
 * merge rule (ADR 0004) is written against exactly that split: provider
 * columns are always overwritten, user columns never are.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerId(),

    date: date('date', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    vendor: text('vendor').notNull().default(''),
    /** Positive is money out (ADR 0004). Refunds and payments are negative. */
    amountCents: cents('amount_cents').notNull(),
    category: expenseCategory('category').notNull(),
    paymentMethod: paymentMethod('payment_method').notNull(),
    cardLast4: text('card_last4'),
    status: transactionStatus('status').notNull(),
    projectId: uuid('project_id'),
    receiptNumber: text('receipt_number'),
    taxDeductible: boolean('tax_deductible').notNull().default(false),
    notes: text('notes'),

    source: transactionSource('source').notNull().default('manual'),
    provider: text('provider'),
    /** The provider's id for this transaction. Null for rows the user typed. */
    externalId: text('external_id'),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
      onDelete: 'set null',
    }),
    pending: boolean('pending').notNull().default(false),
    /** Set on a posted row that supersedes a pending one, so it can inherit it. */
    pendingTransactionId: text('pending_transaction_id'),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    authorizedDate: date('authorized_date', { mode: 'string' }),
    /** The bank's original text, kept verbatim next to the cleaned description. */
    rawDescriptor: text('raw_descriptor'),
    merchantName: text('merchant_name'),
    categoryHintPrimary: text('category_hint_primary'),
    categoryHintDetailed: text('category_hint_detailed'),
    /**
     * When the user last corrected a categorisation. Once set, sync stops
     * overwriting `category`, `taxDeductible` and `vendor` too.
     */
    userEditedAt: timestamp('user_edited_at', { withTimezone: true, mode: 'date' }),
    /** Soft delete: a categorised row the provider removed is never silently lost. */
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * Composite, so the project has to belong to the same owner as the
     * expense. Unlike invoices and hours, a transaction outlives its project:
     * the payment really happened, so deleting the job unfiles the expense
     * rather than destroying the record of it.
     *
     * The generated `ON DELETE set null` is hand-edited in the migration to
     * `SET NULL ("project_id")`. Without the column list Postgres nulls every
     * column in the key, `owner_id` included, and the delete fails against its
     * NOT NULL. drizzle-kit cannot express the list; a test asserts the
     * committed SQL still carries it.
     */
    foreignKey({
      name: 'transactions_project_id_owner_id_fk',
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete('set null'),
    /**
     * The deduplication key sync upserts on (spec §5). It has to be partial:
     * every manually entered row has a null `external_id`, and a plain unique
     * index would let exactly one of them exist per owner.
     */
    uniqueIndex('transactions_provider_account_external_key')
      .on(table.provider, table.bankAccountId, table.externalId)
      .where(sql`"external_id" IS NOT NULL`),
    index('transactions_owner_date_idx').on(table.ownerId, table.date),
    index('transactions_owner_project_idx').on(table.ownerId, table.projectId),
    /** The inbox reads only unassigned rows, so only those are worth indexing. */
    index('transactions_owner_unassigned_idx')
      .on(table.ownerId)
      .where(sql`"status" = 'unassigned'`),
  ]
);
