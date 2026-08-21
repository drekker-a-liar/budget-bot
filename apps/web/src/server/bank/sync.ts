import type { BankProvider, NormalizedTransaction, SyncResult } from '@budget-bot/bank-connectors';
import {
  PlaidItemError,
  PlaidMutationDuringPagination,
  PlaidRateLimited,
  PlaidRequestError,
} from '@budget-bot/bank-connectors';
import { categorizeVendor } from '@budget-bot/core';
import {
  ConnectionNotFoundError,
  bankRepo,
  transactionsRepo,
  withSyncLock,
  type BankAccount,
  type BankTransactionRow,
  type Database,
  type SyncOutcome,
  type Transaction,
} from '@budget-bot/db';
import type { TokenKeyring } from '@budget-bot/db/crypto';

/**
 * `/transactions/sync`, page by page, under ADR 0004's rules.
 *
 * The shape of this file is set by one rule from that ADR: **a cursor may only
 * be persisted after the page it belongs to has landed.** Get that backwards
 * and the transactions between the old cursor and the new one are gone for
 * good - no re-request can fetch them, because from Plaid's point of view they
 * have already been delivered. Everything else here follows from taking that
 * seriously:
 *
 * - The unit of work is a *page*, not a run. Each page is applied and its
 *   cursor committed in one database transaction, so a run that dies on page
 *   nine keeps the eight pages before it and resumes where it stopped.
 * - The advisory lock is taken per page rather than held across the run, for
 *   the same reason: a transaction-scoped lock and a committed page are the
 *   same transaction, so holding the lock across pages would mean holding one
 *   transaction across pages, which is the thing that must not happen.
 * - The provider call happens *inside* that transaction, through
 *   `withAccessToken`, so the plaintext token exists only for the duration of
 *   one callback and never outlives it (spec §9).
 *
 * The counts this returns are what actually happened, not what was attempted.
 * `upsertFromBank`'s written rows are compared against what it was given, and
 * a shortfall is thrown rather than reported as success - the way a page can
 * write nothing while looking fine is a cross-owner collision on the dedupe
 * index, and "your bank synced, there is just nothing there" is the worst
 * possible way to tell somebody their money is missing.
 */

/** Item errors that mean the *user* has to do something, not the system. */
const REAUTH_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
]);

/** Codes this service records itself, as opposed to ones Plaid supplies. */
const RATE_LIMIT = 'RATE_LIMIT_EXCEEDED';
const MUTATION_DURING_PAGINATION = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';
const SYNC_FAILED = 'SYNC_FAILED';
export const UNKNOWN_ACCOUNT = 'UNKNOWN_ACCOUNT';
export const SYNC_WRITE_SHORTFALL = 'SYNC_WRITE_SHORTFALL';

/** How many times a mid-pagination mutation may send the run back to its cursor. */
const DEFAULT_MAX_RESTARTS = 2;

/**
 * The upsert wrote fewer rows than it was given.
 *
 * `upsertFromBank` asserts the owner in its `setWhere`, so a row colliding
 * with another owner's on the partial unique index is left untouched and comes
 * back from `returning()` as nothing at all. That is the right thing for it to
 * do and the wrong thing to swallow: the run would otherwise report a
 * successful sync that stored none of the transactions it was handed.
 */
export class SyncWriteShortfallError extends Error {
  readonly code = SYNC_WRITE_SHORTFALL;

  constructor(
    readonly expected: number,
    readonly written: number
  ) {
    super(
      `A sync page wrote ${written} of ${expected} transactions. The rest collided with rows this owner does not own; nothing has been committed.`
    );
    this.name = 'SyncWriteShortfallError';
  }
}

export interface RunSyncDeps {
  provider: BankProvider;
  keyring: TokenKeyring;
  /**
   * Stop after this many committed pages and report `hasMore`. Unbounded by
   * default, which is what **Sync now** wants; the first sync after Link runs
   * inside a request and passes a small bound instead (spec §5).
   */
  maxPages?: number;
  /** How many times a mid-pagination mutation may restart. Two by default. */
  maxRestarts?: number;
}

/**
 * What a run did, or `{ skipped: true }` when another sync already held the
 * connection and this one had nothing to add.
 *
 * `retryAfterSeconds` appears only on a run that stopped on a rate limit, and
 * is the provider's own hint rather than a guess.
 */
export type RunSyncResult = (SyncOutcome & { retryAfterSeconds?: number }) | { skipped: true };

/** What applying one page produced, before it is folded into the run's totals. */
interface PageOutcome {
  added: number;
  modified: number;
  removed: number;
  /** Rows naming an account this connection does not have. Skipped, not written. */
  unknownAccount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/** The dedupe key `upsertFromBank` collapses rows on, repeated here to count them. */
function identityOf(row: BankTransactionRow): string {
  return `${row.provider} ${row.bankAccountId} ${row.externalId}`;
}

/**
 * One provider transaction, as a row.
 *
 * `categorizeVendor` runs here and only here, because this is the insert path:
 * a re-sync never revisits `category`, `vendor` or `taxDeductible` (ADR 0004),
 * so the guess a row is created with is the last one the system makes on its
 * own. It reads the merchant name when the provider resolved one and the
 * bank's raw line otherwise - "The Home Depot" categorises better than
 * "HOME DEPOT #1234 SLC UT", and the raw line is kept beside it either way.
 */
function toRow(transaction: NormalizedTransaction, account: BankAccount): BankTransactionRow {
  const description = transaction.merchantName ?? transaction.rawDescriptor;
  const auto = categorizeVendor(description);

  return {
    date: transaction.date,
    description,
    vendor: auto.cleanVendor,
    amountCents: transaction.amountCents,
    category: auto.category,
    paymentMethod: 'card' as const,
    cardLast4: account.mask ?? undefined,
    // Positive is money out (ADR 0004). A negative row is a refund or a card
    // payment: real, stored, and kept out of the metrics, because counting it
    // as an expense would double-count the purchases it settles.
    status: transaction.amountCents < 0 ? ('ignored' as const) : ('unassigned' as const),
    taxDeductible: auto.taxDeductible,

    provider: 'plaid',
    bankAccountId: account.id,
    externalId: transaction.externalId,
    // A still-authorizing charge has not posted, whatever the provider filled
    // in: the amount and the date can both still move.
    postedAt: transaction.pending ? null : transaction.postedAt,
    authorizedDate: transaction.authorizedDate,
    pending: transaction.pending,
    pendingTransactionId: transaction.pendingTransactionId,
    rawDescriptor: transaction.rawDescriptor,
    merchantName: transaction.merchantName,
    categoryHintPrimary: transaction.categoryHintPrimary,
    categoryHintDetailed: transaction.categoryHintDetailed,
  };
}

/**
 * A page, applied in the order ADR 0004 requires.
 *
 * `upsertFromBank` first, because `reconcilePending` needs the posted row to
 * already exist - it moves the pending row's filing onto it and then deletes
 * the pending row, and doing that with nothing to inherit the filing would
 * destroy it. `applyRemoved` last, so a pending row that this page superseded
 * has already gone by the time its id shows up in `removed`.
 *
 * The cursor is written at the end, inside the same transaction: it and the
 * page commit together or neither does.
 */
async function applyPage(
  tx: Transaction,
  ownerId: string,
  connectionId: string,
  page: SyncResult,
  accounts: BankAccount[]
): Promise<PageOutcome> {
  const byExternalId = new Map(accounts.map((account) => [account.externalId, account]));
  let unknownAccount = 0;

  /**
   * Rows for accounts this connection actually has. A row naming an account
   * that is not here cannot be written at all - `bank_account_id` is part of
   * the dedupe key and a foreign key besides - so it is skipped and counted,
   * and the count turns into a recorded error at the end of the run. Dropping
   * it silently would be a transaction the owner never sees and never knows to
   * look for.
   */
  function resolve(transactions: NormalizedTransaction[]): BankTransactionRow[] {
    const rows: BankTransactionRow[] = [];
    for (const transaction of transactions) {
      const account = byExternalId.get(transaction.accountExternalId);
      if (!account) {
        unknownAccount += 1;
        continue;
      }
      rows.push(toRow(transaction, account));
    }
    return rows;
  }

  const added = resolve(page.added);
  const modified = resolve(page.modified);

  const written = await transactionsRepo.upsertFromBank(tx, ownerId, added);
  const expected = new Set(added.map(identityOf)).size;
  if (written.length !== expected) throw new SyncWriteShortfallError(expected, written.length);

  const modifiedCount = await transactionsRepo.applyModified(tx, ownerId, modified);

  // Per account, because that is the shape `reconcilePending` takes: the
  // pending row and the posted one that supersedes it are always the same
  // account, and passing the account is what lets it find the pending row by
  // external id without a second index.
  const addedByAccount = new Map<string, BankTransactionRow[]>();
  for (const row of added) {
    const rows = addedByAccount.get(row.bankAccountId);
    if (rows) rows.push(row);
    else addedByAccount.set(row.bankAccountId, [row]);
  }
  for (const [bankAccountId, rows] of addedByAccount) {
    await transactionsRepo.reconcilePending(tx, ownerId, bankAccountId, rows);
  }

  // `removed` is ids and nothing else - the provider does not say which
  // account each one was on - so every account behind this connection is
  // offered the whole list. An id lives on exactly one of them, so the counts
  // add up rather than double-counting.
  let removed = 0;
  if (page.removed.length > 0) {
    for (const account of accounts) {
      const { softDeleted, deleted } = await transactionsRepo.applyRemoved(
        tx,
        ownerId,
        account.id,
        page.removed
      );
      removed += softDeleted + deleted;
    }
  }

  // Only when there is one. Plaid answers an item with nothing to send with no
  // cursor at all, and there is nothing to commit for a page that did not move.
  if (page.nextCursor !== null) {
    await bankRepo.setCursor(tx, ownerId, connectionId, page.nextCursor);
  }

  return {
    added: written.length,
    modified: modifiedCount,
    removed,
    unknownAccount,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

/** One page: read the committed cursor, fetch, apply, commit. */
async function syncOnePage(
  tx: Transaction,
  ownerId: string,
  connectionId: string,
  { provider, keyring }: RunSyncDeps
): Promise<PageOutcome> {
  const connection = await bankRepo.getConnection(tx, ownerId, connectionId);
  if (!connection) throw new ConnectionNotFoundError();

  // Re-read per page rather than once per run. It is one small query, and it
  // means an account added between pages is one this run can already file
  // against instead of counting as unknown.
  const accounts = await bankRepo.listAccounts(tx, ownerId, connectionId);

  const page = await bankRepo.withAccessToken(tx, ownerId, connectionId, keyring, (accessToken) =>
    provider.syncTransactions(accessToken, connection.cursor)
  );

  return applyPage(tx, ownerId, connectionId, page, accounts);
}

/**
 * Why the run stopped, on the connection, as a code and never a message.
 *
 * A provider's message is free text from somebody else's system and it ends up
 * on a settings screen; the code is what a screen can be written against and
 * what support asks for (spec §9).
 */
async function recordFailure(
  db: Database,
  ownerId: string,
  connectionId: string,
  error: unknown
): Promise<void> {
  const failure = ((): { code: string; status: 'error' | 'reauth_required' } => {
    if (error instanceof PlaidRateLimited) return { code: RATE_LIMIT, status: 'error' };
    if (error instanceof PlaidMutationDuringPagination) {
      return { code: MUTATION_DURING_PAGINATION, status: 'error' };
    }
    if (error instanceof PlaidItemError) {
      return {
        code: error.code,
        status: REAUTH_CODES.has(error.code) ? 'reauth_required' : 'error',
      };
    }
    if (error instanceof PlaidRequestError) return { code: error.code, status: 'error' };
    if (error instanceof SyncWriteShortfallError) {
      return { code: SYNC_WRITE_SHORTFALL, status: 'error' };
    }
    // Something this service did not anticipate. The connection still has to
    // say a sync failed, because a screen showing "last synced: 20 minutes
    // ago" after a crash is a lie the user has no way to catch.
    return { code: SYNC_FAILED, status: 'error' };
  })();

  await bankRepo.recordSyncError(db, ownerId, connectionId, failure);
}

/**
 * Pull every page there is, or as many as `maxPages` allows.
 *
 * `db` is the connection rather than a transaction on purpose: this function
 * opens one transaction per page and each of them is a real commit, which is
 * the whole point (ADR 0004).
 */
export async function runSync(
  db: Database,
  ownerId: string,
  connectionId: string,
  deps: RunSyncDeps
): Promise<RunSyncResult> {
  const maxPages = deps.maxPages ?? Number.POSITIVE_INFINITY;
  const maxRestarts = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS;

  const totals: SyncOutcome = { added: 0, modified: 0, removed: 0, pages: 0, hasMore: false };
  let unknownAccount = 0;
  let restarts = 0;

  while (totals.pages < maxPages) {
    let locked;
    try {
      locked = await withSyncLock(db, connectionId, (tx) =>
        syncOnePage(tx, ownerId, connectionId, deps)
      );
    } catch (error) {
      // The page rolled back, so the committed cursor is still the one this
      // attempt read. Going round again re-reads it and asks for the same page
      // - which is exactly what "restart from the last committed cursor"
      // means, and why this needs no state of its own beyond a counter.
      if (error instanceof PlaidMutationDuringPagination && restarts < maxRestarts) {
        restarts += 1;
        continue;
      }

      await recordFailure(db, ownerId, connectionId, error);

      // A rate limit is not a failed sync, it is an unfinished one. Everything
      // committed so far stands, and the caller is told when to come back.
      if (error instanceof PlaidRateLimited) {
        return { ...totals, hasMore: true, retryAfterSeconds: error.retryAfterSeconds };
      }
      throw error;
    }

    if (locked.skipped) {
      // Nothing committed yet: another sync owns this connection and is doing
      // the same work, so there is nothing for this one to add.
      if (totals.pages === 0) return { skipped: true };
      // Mid-run: another sync took over between pages. What this one committed
      // is committed; the rest is the other run's, so say there is more.
      return { ...totals, hasMore: true };
    }

    const page = locked.result;
    totals.added += page.added;
    totals.modified += page.modified;
    totals.removed += page.removed;
    totals.pages += 1;
    totals.hasMore = page.hasMore;
    unknownAccount += page.unknownAccount;

    if (!page.hasMore) break;
    if (page.nextCursor === null) {
      // "There is more" with nothing to ask for it with. Nothing can be lost
      // by stopping - the committed cursor is untouched and the next run asks
      // the same question - and looping would spin on the same page for ever.
      totals.hasMore = true;
      break;
    }
  }

  await bankRepo.recordSyncResult(db, ownerId, connectionId, totals);

  // After the success, not instead of it: the sync did happen and
  // `last_synced_at` should say so, but a page that named an account this
  // connection does not have dropped transactions on the floor, and the
  // connection is the only place that can tell anyone.
  if (unknownAccount > 0) {
    await bankRepo.recordSyncError(db, ownerId, connectionId, {
      code: UNKNOWN_ACCOUNT,
      status: 'error',
    });
  }

  return totals;
}
