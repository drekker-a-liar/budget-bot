import type { ExpenseTransaction, TransactionStatus } from '@budget-bot/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { transactions } from '../schema';
import { isUuid, orUndefined, toIso } from './rows';

/**
 * Expenses. The table has two owners: the user owns what they typed, a bank
 * feed owns what it synced. Everything in this file except `upsertFromBank`
 * writes on the user's behalf; `upsertFromBank` is the only writer that has to
 * respect the split (ADR 0004).
 */

type TransactionRow = typeof transactions.$inferSelect;

export type NewTransaction = Omit<ExpenseTransaction, 'id' | 'createdAt' | 'updatedAt'>;
export type TransactionUpdate = Partial<NewTransaction>;

export interface TransactionFilter {
  projectId?: string;
  status?: TransactionStatus;
}

function toTransaction(row: TransactionRow): ExpenseTransaction {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    vendor: row.vendor,
    amountCents: row.amountCents as ExpenseTransaction['amountCents'],
    category: row.category,
    paymentMethod: row.paymentMethod,
    cardLast4: orUndefined(row.cardLast4),
    status: row.status,
    projectId: orUndefined(row.projectId),
    receiptNumber: orUndefined(row.receiptNumber),
    taxDeductible: row.taxDeductible,
    notes: orUndefined(row.notes),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Copied field by field: an update body arrives from a request. */
function toUpdate(input: TransactionUpdate) {
  return {
    ...(input.date !== undefined && { date: input.date }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.vendor !== undefined && { vendor: input.vendor }),
    ...(input.amountCents !== undefined && { amountCents: input.amountCents }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.paymentMethod !== undefined && { paymentMethod: input.paymentMethod }),
    ...(input.cardLast4 !== undefined && { cardLast4: input.cardLast4 ?? null }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.projectId !== undefined && { projectId: input.projectId ?? null }),
    ...(input.receiptNumber !== undefined && { receiptNumber: input.receiptNumber ?? null }),
    ...(input.taxDeductible !== undefined && { taxDeductible: input.taxDeductible }),
    ...(input.notes !== undefined && { notes: input.notes ?? null }),
  };
}

function toInsert(ownerId: string, input: NewTransaction) {
  return {
    ownerId,
    date: input.date,
    description: input.description,
    vendor: input.vendor,
    amountCents: input.amountCents,
    category: input.category,
    paymentMethod: input.paymentMethod,
    cardLast4: input.cardLast4 ?? null,
    status: input.status,
    projectId: input.projectId ?? null,
    receiptNumber: input.receiptNumber ?? null,
    taxDeductible: input.taxDeductible,
    notes: input.notes ?? null,
  };
}

export async function listTransactions(
  db: Database,
  ownerId: string,
  filter: TransactionFilter = {}
): Promise<ExpenseTransaction[]> {
  if (filter.projectId !== undefined && !isUuid(filter.projectId)) return [];
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ownerId, ownerId),
        // A row the provider removed after the user categorised it is kept as
        // a soft delete (ADR 0004) and must not show up as an expense.
        isNull(transactions.removedAt),
        filter.projectId === undefined
          ? undefined
          : eq(transactions.projectId, filter.projectId),
        filter.status === undefined ? undefined : eq(transactions.status, filter.status)
      )
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id));
  return rows.map(toTransaction);
}

export async function createTransaction(
  db: Database,
  ownerId: string,
  input: NewTransaction
): Promise<ExpenseTransaction> {
  const [row] = await db.insert(transactions).values(toInsert(ownerId, input)).returning();
  return toTransaction(row);
}

/**
 * Inserts a whole import in one statement, so a file either lands or does not.
 * The rows arrive already validated - `CsvRowSchema` at the boundary.
 */
export async function bulkCreateTransactions(
  db: Database,
  ownerId: string,
  items: NewTransaction[]
): Promise<ExpenseTransaction[]> {
  if (items.length === 0) return [];
  const rows = await db
    .insert(transactions)
    .values(items.map((item) => toInsert(ownerId, item)))
    .returning();
  return rows.map(toTransaction);
}

export async function updateTransaction(
  db: Database,
  ownerId: string,
  id: string,
  updates: TransactionUpdate
): Promise<ExpenseTransaction | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(transactions)
    .set({ ...toUpdate(updates), updatedAt: new Date() })
    .where(and(eq(transactions.ownerId, ownerId), eq(transactions.id, id)))
    .returning();
  return row ? toTransaction(row) : null;
}

export async function deleteTransaction(
  db: Database,
  ownerId: string,
  id: string
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(transactions)
    .where(and(eq(transactions.ownerId, ownerId), eq(transactions.id, id)))
    .returning({ id: transactions.id });
  return deleted.length > 0;
}

/**
 * One transaction as a bank feed sends it. It is a `NewTransaction` plus the
 * identity and provenance columns, because the fields a feed cannot supply -
 * the category, the vendor name, whether it is deductible - still have to be
 * decided by the caller before the row is created.
 */
export type BankTransactionRow = NewTransaction & {
  provider: string;
  bankAccountId: string;
  externalId: string;
  postedAt?: Date | null;
  authorizedDate?: string | null;
  pending?: boolean;
  pendingTransactionId?: string | null;
  rawDescriptor?: string | null;
  merchantName?: string | null;
  categoryHintPrimary?: string | null;
  categoryHintDetailed?: string | null;
};

/**
 * Applies a page of synced transactions.
 *
 * The merge rule (ADR 0004) is the whole point of this function: a row the
 * feed has sent before is updated *only* in the columns the provider owns. The
 * user's `projectId`, `status`, `notes`, `receiptNumber`, `category`,
 * `taxDeductible`, `vendor` and the description they read every day are left
 * exactly as they are - re-syncing must never undo an afternoon of filing.
 *
 * Rows the user typed have no `external_id`, so the partial unique index this
 * conflicts on simply does not see them.
 */
export async function upsertFromBank(
  db: Database,
  ownerId: string,
  rows: BankTransactionRow[]
): Promise<ExpenseTransaction[]> {
  if (rows.length === 0) return [];

  // Postgres refuses to update the same row twice in one statement, and a
  // sync page can legitimately carry a transaction twice; the last version it
  // sends is the current one.
  const byIdentity = new Map<string, BankTransactionRow>();
  for (const row of rows) {
    byIdentity.set(`${row.provider} ${row.bankAccountId} ${row.externalId}`, row);
  }

  const upserted = await db
    .insert(transactions)
    .values(
      [...byIdentity.values()].map((row) => ({
        ...toInsert(ownerId, row),
        source: 'plaid' as const,
        provider: row.provider,
        bankAccountId: row.bankAccountId,
        externalId: row.externalId,
        postedAt: row.postedAt ?? null,
        authorizedDate: row.authorizedDate ?? null,
        pending: row.pending ?? false,
        pendingTransactionId: row.pendingTransactionId ?? null,
        rawDescriptor: row.rawDescriptor ?? null,
        merchantName: row.merchantName ?? null,
        categoryHintPrimary: row.categoryHintPrimary ?? null,
        categoryHintDetailed: row.categoryHintDetailed ?? null,
      }))
    )
    .onConflictDoUpdate({
      target: [transactions.provider, transactions.bankAccountId, transactions.externalId],
      // The index is partial, so the conflict target has to repeat its
      // predicate for Postgres to recognise which index is meant.
      targetWhere: sql`"external_id" IS NOT NULL`,
      set: {
        amountCents: sql`excluded.amount_cents`,
        date: sql`excluded.date`,
        postedAt: sql`excluded.posted_at`,
        authorizedDate: sql`excluded.authorized_date`,
        pending: sql`excluded.pending`,
        pendingTransactionId: sql`excluded.pending_transaction_id`,
        rawDescriptor: sql`excluded.raw_descriptor`,
        merchantName: sql`excluded.merchant_name`,
        categoryHintPrimary: sql`excluded.category_hint_primary`,
        categoryHintDetailed: sql`excluded.category_hint_detailed`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return upserted.map(toTransaction);
}
