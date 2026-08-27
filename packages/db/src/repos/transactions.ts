import type { ExpenseTransaction, MonthlyMarginRange } from '@budget-bot/core';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Database, Executor } from '../client';
import { transactions } from '../schema';
import { rejectingForeignProject } from './errors';
import { isUuid, orUndefined, toIso, toIsoOrNull } from './rows';

/**
 * Expenses. The table has two owners: the user owns what they typed, a bank
 * feed owns what it synced. Everything in this file except `upsertFromBank`
 * writes on the user's behalf; `upsertFromBank` is the only writer that has to
 * respect the split (ADR 0004).
 */

type TransactionRow = typeof transactions.$inferSelect;

/**
 * What a form (or a bulk create) supplies. The bank columns are left out
 * rather than made optional: a form never sends them, and leaving them out of
 * `toInsert` lets Postgres apply their defaults (`source: 'manual'`,
 * `pending: false`, the rest null) itself. `BankTransactionRow` below adds
 * back the ones a feed actually owns.
 */
export type NewTransaction = Omit<
  ExpenseTransaction,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'postedAt'
  | 'pending'
  | 'source'
  | 'provider'
  | 'externalId'
  | 'bankAccountId'
  | 'removedAt'
  | 'userEditedAt'
>;

export type TransactionUpdate = Partial<Omit<NewTransaction, 'projectId'>> & {
  /**
   * `null` unfiles the row; leaving the key out leaves its filing alone. The
   * two are different requests and the type has to be able to say which - a
   * row that reads `unassigned` while still pointing at a job is counted
   * twice, once in the inbox and once against that job's margin.
   */
  projectId?: string | null;
  /**
   * When the user last corrected this row, ISO 8601. Every write made on a
   * person's behalf stamps it, because it is what the merge rule reads to
   * decide whether a re-sync may touch `category`, `taxDeductible` and
   * `vendor` (ADR 0004). A repository cannot infer it - a bank feed writes
   * through here too - so the caller says so explicitly.
   */
  userEditedAt?: string | null;
};

export interface TransactionFilter {
  projectId?: string;
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
    postedAt: toIsoOrNull(row.postedAt),
    pending: row.pending,
    source: row.source,
    provider: row.provider,
    externalId: row.externalId,
    bankAccountId: row.bankAccountId,
    removedAt: toIsoOrNull(row.removedAt),
    userEditedAt: toIsoOrNull(row.userEditedAt),
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
    ...(input.userEditedAt !== undefined && {
      userEditedAt: input.userEditedAt ? new Date(input.userEditedAt) : null,
    }),
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
          : eq(transactions.projectId, filter.projectId)
      )
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id));
  return rows.map(toTransaction);
}

/**
 * Candidate cost rows for a cash-basis window (spec §2): non-ignored,
 * non-pending, non-removed transactions whose bucket date - `postedAt ?? date`
 * in the owner's time zone - could fall in `range`, for the margin query
 * (spec §3).
 *
 * `date` is a plain calendar string, compared directly against `range` the
 * same way `calculateMonthlyMargins`'s `inRange` does - no zone conversion to
 * get wrong. `postedAt` is an instant, so instead of repeating that function's
 * `Intl` bucketing here (the zone math core exists to own), its side of the
 * `OR` pads `range` by a day on each end: enough to cover every IANA offset
 * (UTC-12 to UTC+14) no matter which one the owner is in. This only has to
 * bound what reaches core - core applies the exact cut.
 */
export async function listTransactionsInRange(
  db: Database,
  ownerId: string,
  range: MonthlyMarginRange
): Promise<ExpenseTransaction[]> {
  const postedAtFrom = new Date(`${range.start}T00:00:00.000Z`);
  postedAtFrom.setUTCDate(postedAtFrom.getUTCDate() - 1);
  const postedAtTo = new Date(`${range.end}T23:59:59.999Z`);
  postedAtTo.setUTCDate(postedAtTo.getUTCDate() + 1);

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ownerId, ownerId),
        isNull(transactions.removedAt),
        ne(transactions.status, 'ignored'),
        eq(transactions.pending, false),
        or(
          and(
            isNull(transactions.postedAt),
            gte(transactions.date, range.start),
            lte(transactions.date, range.end)
          ),
          and(
            isNotNull(transactions.postedAt),
            gte(transactions.postedAt, postedAtFrom),
            lte(transactions.postedAt, postedAtTo)
          )
        )
      )
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id));
  return rows.map(toTransaction);
}

export async function getTransaction(
  db: Database,
  ownerId: string,
  id: string
): Promise<ExpenseTransaction | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.ownerId, ownerId), eq(transactions.id, id)))
    .limit(1);
  return row && toTransaction(row);
}

export async function createTransaction(
  db: Database,
  ownerId: string,
  input: NewTransaction
): Promise<ExpenseTransaction> {
  const [row] = await rejectingForeignProject(input.projectId, () =>
    db.insert(transactions).values(toInsert(ownerId, input)).returning()
  );
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
  // No project id in the message: any row in the batch could be the one that
  // trips the constraint, and naming the wrong one would be worse than naming
  // none. The whole insert is one statement, so nothing lands either way.
  const rows = await rejectingForeignProject(undefined, () =>
    db
      .insert(transactions)
      .values(items.map((item) => toInsert(ownerId, item)))
      .returning()
  );
  return rows.map(toTransaction);
}

/** A row that arrived in a file rather than being typed. */
export type ImportedTransaction = NewTransaction & {
  /** The provider's identity for the row, so a future sync can recognise it. */
  externalId: string;
  /** The bank's own text, kept verbatim beside the cleaned description. */
  rawDescriptor?: string | null;
  /** Still authorizing: the amount and the date can both still change. */
  pending?: boolean;
};

export interface ImportProvenance {
  source: 'csv' | 'plaid';
  provider: string;
  importBatchId: string;
}

/**
 * Inserts everything one import brought in, in one statement, so a file either
 * lands or does not.
 *
 * `bank_account_id` stays null: a file is not a linked account, and there is
 * nothing yet to point at. That leaves `transactions_owner_csv_external_key`
 * (spec §7) as the dedupe index for a CSV row rather than the sync one, which
 * never conflicts when `bank_account_id` is null - Postgres counts null as
 * distinct from null. A row that collides with one already on that index is
 * silently dropped from the return value rather than erroring, so a caller
 * re-importing the same statement can count the difference between what it
 * sent and what came back as skipped. The `where` predicate is the index's
 * own, pinned in `test/migrations.test.ts`; it is inert for a non-`'csv'`
 * provenance, since such a row is not covered by the index at all.
 */
export async function bulkCreateImported(
  db: Executor,
  ownerId: string,
  items: ImportedTransaction[],
  provenance: ImportProvenance
): Promise<ExpenseTransaction[]> {
  if (items.length === 0) return [];
  const rows = await rejectingForeignProject(undefined, () =>
    db
      .insert(transactions)
      .values(
        items.map((item) => ({
          ...toInsert(ownerId, item),
          source: provenance.source,
          provider: provenance.provider,
          externalId: item.externalId,
          rawDescriptor: item.rawDescriptor ?? null,
          pending: item.pending ?? false,
          importBatchId: provenance.importBatchId,
        }))
      )
      .onConflictDoNothing({
        target: [transactions.ownerId, transactions.externalId],
        where: sql`"provider" = 'csv' AND "external_id" IS NOT NULL`,
      })
      .returning()
  );
  return rows.map(toTransaction);
}

export async function updateTransaction(
  db: Database,
  ownerId: string,
  id: string,
  updates: TransactionUpdate
): Promise<ExpenseTransaction | null> {
  if (!isUuid(id)) return null;
  const [row] = await rejectingForeignProject(updates.projectId ?? undefined, () =>
    db
      .update(transactions)
      .set({ ...toUpdate(updates), updatedAt: new Date() })
      .where(and(eq(transactions.ownerId, ownerId), eq(transactions.id, id)))
      .returning()
  );
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

/** Every transaction the owner has, gone at once (spec §6, delete-all). */
export async function deleteAllTransactions(db: Executor, ownerId: string): Promise<number> {
  const deleted = await db
    .delete(transactions)
    .where(eq(transactions.ownerId, ownerId))
    .returning({ id: transactions.id });
  return deleted.length;
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
 * `PROVIDER_OWNED`: the columns a bank feed owns (ADR 0004, and the plan's
 * Global Constraints).
 *
 * Everything not on this list belongs to the user: `project_id`, `status`,
 * `notes`, `receipt_number`, the `description` they read every day, and -
 * because there is no way to tell a categorisation someone accepted from one
 * they never looked at - `category`, `tax_deductible` and `vendor` as well.
 * The last three are decided when the row is inserted (`categorizeVendor`
 * runs on insert only, spec §5) and never revisited by a sync, so
 * `user_edited_at` does not have to be consulted: the columns are simply not
 * in either set clause.
 *
 * The list is a type, not a comment. Both builders below are keyed by it, so
 * adding a name here fails to compile until the upsert *and* the plain update
 * have each been taught about it - which is the only way two set clauses stay
 * the same set clause. `updated_at` is on the constraint's list too, but it is
 * the same `new Date()` at every call site rather than something read off a
 * row, so it is appended there instead of being carried through here.
 */
type ProviderOwnedColumn =
  | 'amountCents'
  | 'date'
  | 'authorizedDate'
  | 'postedAt'
  | 'pending'
  | 'pendingTransactionId'
  | 'rawDescriptor'
  | 'merchantName'
  | 'categoryHintPrimary'
  | 'categoryHintDetailed';

/**
 * The provider's half of a row, as values. `Required` rather than `Pick`
 * alone: a nullable column is optional on the insert model, and an optional
 * key is one a builder could silently forget to set.
 */
type ProviderOwnedValues = Required<
  Pick<typeof transactions.$inferInsert, ProviderOwnedColumn>
>;

/** For the upsert: take the provider's half of the row Postgres rejected. */
const PROVIDER_OWNED_FROM_EXCLUDED: Record<ProviderOwnedColumn, SQL> = {
  amountCents: sql`excluded.amount_cents`,
  date: sql`excluded.date`,
  authorizedDate: sql`excluded.authorized_date`,
  postedAt: sql`excluded.posted_at`,
  pending: sql`excluded.pending`,
  pendingTransactionId: sql`excluded.pending_transaction_id`,
  rawDescriptor: sql`excluded.raw_descriptor`,
  merchantName: sql`excluded.merchant_name`,
  categoryHintPrimary: sql`excluded.category_hint_primary`,
  categoryHintDetailed: sql`excluded.category_hint_detailed`,
};

/** For a plain update: the same half, read off the row the feed sent. */
function providerOwnedFrom(row: BankTransactionRow): ProviderOwnedValues {
  return {
    amountCents: row.amountCents,
    date: row.date,
    authorizedDate: row.authorizedDate ?? null,
    postedAt: row.postedAt ?? null,
    pending: row.pending ?? false,
    pendingTransactionId: row.pendingTransactionId ?? null,
    rawDescriptor: row.rawDescriptor ?? null,
    merchantName: row.merchantName ?? null,
    categoryHintPrimary: row.categoryHintPrimary ?? null,
    categoryHintDetailed: row.categoryHintDetailed ?? null,
  };
}

/** The one row a feed identifies by `(provider, account, external id)`. */
function identifies(ownerId: string, row: BankTransactionRow) {
  return and(
    eq(transactions.ownerId, ownerId),
    eq(transactions.provider, row.provider),
    eq(transactions.bankAccountId, row.bankAccountId),
    eq(transactions.externalId, row.externalId)
  );
}

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
  db: Executor,
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
      set: { ...PROVIDER_OWNED_FROM_EXCLUDED, updatedAt: new Date() },
      // The dedupe index does not carry the owner - it cannot, since it is
      // what a provider's ids are unique within. So the owner is asserted
      // here instead: a row that collides with somebody else's is left
      // untouched rather than quietly rewritten.
      setWhere: eq(transactions.ownerId, ownerId),
    })
    .returning();

  return upserted.map(toTransaction);
}

/**
 * Applies the `modified` half of a sync page.
 *
 * An update, never an upsert: `modified` means the provider is correcting a
 * row it has already sent, and a row this deployment has never seen is a page
 * applied out of order, not a transaction to invent. It returns how many rows
 * it actually found, so a caller can tell the difference.
 *
 * Only `PROVIDER_OWNED` is written. In particular `category`, `taxDeductible`
 * and `vendor` are left alone unconditionally - not "unless `user_edited_at`
 * is set". A merchant name that changed is not a reason to re-file a charge,
 * and the categorisation the row was inserted with is either the user's or the
 * one they have been living with; neither is the provider's to revise.
 */
export async function applyModified(
  db: Executor,
  ownerId: string,
  rows: BankTransactionRow[]
): Promise<number> {
  let changed = 0;
  for (const row of rows) {
    const updated = await db
      .update(transactions)
      .set({ ...providerOwnedFrom(row), updatedAt: new Date() })
      .where(identifies(ownerId, row))
      .returning({ id: transactions.id });
    changed += updated.length;
  }
  return changed;
}

/**
 * Hands a posted transaction the filing its pending version was carrying.
 *
 * Plaid sends a settled charge as a *new* transaction with a new id, naming
 * the pending one it supersedes. Left alone that turns an afternoon's filing
 * into a row in the inbox and a duplicate in the ledger, so the user-owned
 * columns move across and the pending row is dropped (ADR 0004).
 *
 * Three rules the tests pin, in order of how much they cost to get wrong:
 *
 * - The posted row has to exist already - call this *after* `upsertFromBank`
 *   has applied the same page. If it does not, nothing happens: deleting the
 *   pending row with nothing to inherit it would destroy the filing outright.
 * - A pending row the user never touched (`user_edited_at` null) is still
 *   dropped, because the posted row supersedes it - but nothing is copied.
 *   Its untouched defaults would otherwise overwrite the categorisation the
 *   posted row was just inserted with.
 * - One transaction per call, so a page either reconciles or does not.
 *
 * Returns the number of pending rows reconciled.
 */
export async function reconcilePending(
  db: Executor,
  ownerId: string,
  bankAccountId: string,
  posted: BankTransactionRow[]
): Promise<number> {
  if (!isUuid(bankAccountId)) return 0;
  const supersessions = posted.filter((row) => row.pendingTransactionId);
  if (supersessions.length === 0) return 0;

  const owned = (externalId: string) =>
    and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.bankAccountId, bankAccountId),
      eq(transactions.externalId, externalId)
    );

  // A `Transaction` opens a savepoint rather than a second transaction, so
  // this reads the same either way: called on its own it is one transaction,
  // called inside the sync lock's it is one step of that one.
  return (db as Database).transaction(async (tx) => {
    let moved = 0;
    for (const row of supersessions) {
      const [postedRow] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(owned(row.externalId))
        .limit(1);
      if (!postedRow) continue;

      const [pendingRow] = await tx
        .select()
        .from(transactions)
        .where(owned(row.pendingTransactionId as string))
        .limit(1);
      if (!pendingRow) continue;

      if (pendingRow.userEditedAt !== null) {
        await tx
          .update(transactions)
          .set({
            projectId: pendingRow.projectId,
            status: pendingRow.status,
            notes: pendingRow.notes,
            receiptNumber: pendingRow.receiptNumber,
            category: pendingRow.category,
            taxDeductible: pendingRow.taxDeductible,
            vendor: pendingRow.vendor,
            userEditedAt: pendingRow.userEditedAt,
            updatedAt: new Date(),
          })
          .where(
            and(eq(transactions.ownerId, ownerId), eq(transactions.id, postedRow.id))
          );
      }

      // Both ids came from owner-scoped reads a moment ago; the owner is
      // repeated here anyway, because "it was checked upstream" is exactly the
      // reasoning that stops being true when one of these moves.
      await tx
        .delete(transactions)
        .where(
          and(eq(transactions.ownerId, ownerId), eq(transactions.id, pendingRow.id))
        );
      moved += 1;
    }
    return moved;
  });
}

/**
 * Applies the `removed` half of a sync page.
 *
 * A row nobody filed is deleted: the provider says it never happened, and
 * there is nothing of the user's in it. A row with a `project_id` is soft
 * deleted instead - `removed_at` is set and every read that counts money skips
 * it - because a categorised expense disappearing from a job's margin with no
 * trace is how a person stops trusting the numbers (ADR 0004).
 */
export async function applyRemoved(
  db: Executor,
  ownerId: string,
  bankAccountId: string,
  externalIds: string[]
): Promise<{ softDeleted: number; deleted: number }> {
  if (externalIds.length === 0 || !isUuid(bankAccountId)) {
    return { softDeleted: 0, deleted: 0 };
  }

  const owned = and(
    eq(transactions.ownerId, ownerId),
    eq(transactions.bankAccountId, bankAccountId),
    inArray(transactions.externalId, externalIds)
  );

  const softDeleted = await db
    .update(transactions)
    .set({ removedAt: new Date(), updatedAt: new Date() })
    .where(and(owned, isNotNull(transactions.projectId)))
    .returning({ id: transactions.id });

  const deleted = await db
    .delete(transactions)
    .where(and(owned, isNull(transactions.projectId)))
    .returning({ id: transactions.id });

  return { softDeleted: softDeleted.length, deleted: deleted.length };
}

/**
 * The row a provider's id names, soft-deleted ones included.
 *
 * Unlike `listTransactions` this does not hide a row with `removed_at` set:
 * the callers are the sync service and its tests, and "the row is gone" and
 * "the row was withdrawn" are answers they have to be able to tell apart.
 */
export async function getByExternalId(
  db: Executor,
  ownerId: string,
  bankAccountId: string,
  externalId: string
): Promise<ExpenseTransaction | null> {
  if (!isUuid(bankAccountId)) return null;
  const [row] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ownerId, ownerId),
        eq(transactions.bankAccountId, bankAccountId),
        eq(transactions.externalId, externalId)
      )
    )
    .limit(1);
  return row ? toTransaction(row) : null;
}
