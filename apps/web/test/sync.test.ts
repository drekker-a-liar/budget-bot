import type { NormalizedTransaction, SyncResult } from '@budget-bot/bank-connectors';
import {
  PlaidItemError,
  PlaidMutationDuringPagination,
  PlaidRateLimited,
  PlaidRequestError,
} from '@budget-bot/bank-connectors';
import type { Cents } from '@budget-bot/core';
import { bankRepo, transactionsRepo, type BankConnection, type Database } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  FAKE_ACCESS_TOKEN,
  FAKE_INSTITUTION_NAME,
  FAKE_ITEM_ID,
  FakeBankProvider,
  defaultFakeScript,
  type FakeBankScript,
} from '@/src/server/bank/fake-provider';
import {
  SYNC_WRITE_SHORTFALL,
  SyncWriteShortfallError,
  UNKNOWN_ACCOUNT,
  runSync,
  type RunSyncResult,
} from '@/src/server/bank/sync';
import { createOwner, describeDb, holdSyncLock, useTestDb } from './helpers/db';

/**
 * `runSync` against a real Postgres and a scripted bank.
 *
 * Real Postgres because every rule worth asserting here is one Postgres
 * provides: the partial unique index the upsert dedupes on, the advisory lock
 * that keeps two syncs off one connection, and - above all - the transaction
 * boundary that makes "the cursor is committed with its page" mean anything. A
 * mocked database could be made to agree with any of those and would prove
 * none of them.
 *
 * Scripted bank because the alternative is a Plaid account, and a test suite
 * that only runs for people with credentials is not a check on an open-source
 * repository. The fake is strict about the access token it will answer to, so
 * every case below also quietly asserts that the token really was decrypted
 * out of the row on the way past.
 */

/**
 * Only the lock is ever intercepted, and only when a case says so.
 *
 * There is one branch in `runSync` that a real lock cannot reach on purpose:
 * the handover, where a *second* sync takes the connection between two of this
 * one's pages. Producing that with real sessions means one of them blocking on
 * a lock the other still holds inside a transaction it cannot commit until the
 * first is released, which is a deadlock rather than a test. So the lock is
 * intercepted for that one case, by page number, and every other case here -
 * including the contended one below - goes through the real
 * `pg_try_advisory_xact_lock`.
 */
const lock = { skipFromAttempt: Number.POSITIVE_INFINITY, attempts: 0 };

vi.mock('@budget-bot/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@budget-bot/db')>();
  return {
    ...actual,
    withSyncLock: async (
      db: Parameters<typeof actual.withSyncLock>[0],
      connectionId: string,
      fn: Parameters<typeof actual.withSyncLock>[2]
    ) => {
      lock.attempts += 1;
      if (lock.attempts >= lock.skipFromAttempt) return { skipped: true as const };
      return actual.withSyncLock(db, connectionId, fn);
    },
  };
});

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const keyring = loadKeysFromEnv({
  BANK_TOKEN_ENCRYPTION_KEY: Buffer.from('not-a-real-key--not-a-real-key32').toString('base64'),
});

const ACCOUNTS = defaultFakeScript(new Date('2026-08-20T12:00:00.000Z')).accounts;
const CREDIT = 'fake-credit';
const CHECKING = 'fake-checking';

function cents(value: number): Cents {
  return value as Cents;
}

function txn(
  overrides: Pick<NormalizedTransaction, 'externalId' | 'amountCents' | 'rawDescriptor'> &
    Partial<NormalizedTransaction>
): NormalizedTransaction {
  return {
    accountExternalId: CREDIT,
    date: '2026-08-18',
    postedAt: new Date('2026-08-18T17:00:00.000Z'),
    authorizedDate: null,
    merchantName: null,
    pending: false,
    pendingTransactionId: null,
    categoryHintPrimary: null,
    categoryHintDetailed: null,
    isoCurrencyCode: 'USD',
    ...overrides,
  };
}

function page(overrides: Partial<SyncResult> = {}): SyncResult {
  return { added: [], modified: [], removed: [], nextCursor: null, hasMore: false, ...overrides };
}

/**
 * A script for a run that is resuming.
 *
 * The connection's cursor survives a run, so a second `runSync` asks for the
 * page *after* it - and the fake resolves a cursor by finding the page that
 * issued it, exactly as a real provider resolves it against its own history.
 * So a resuming script has to still contain the page it left off at, which is
 * what this puts in front.
 */
function resumingFrom(cursor: string, ...rest: SyncResult[]): SyncResult[] {
  return [page({ nextCursor: cursor, hasMore: true }), ...rest];
}

/** Three pages carrying seven transactions between them. */
function threePages(): SyncResult[] {
  return [
    page({
      added: [
        txn({ externalId: 'txn-1', amountCents: cents(11475), rawDescriptor: 'HOME DEPOT #1234' }),
        txn({ externalId: 'txn-2', amountCents: cents(6210), rawDescriptor: 'SHELL OIL 4471' }),
        txn({
          externalId: 'txn-3',
          amountCents: cents(2199),
          rawDescriptor: 'ACE HARDWARE 88',
          accountExternalId: CHECKING,
        }),
      ],
      nextCursor: 'cursor-1',
      hasMore: true,
    }),
    page({
      added: [
        txn({ externalId: 'txn-4', amountCents: cents(9107), rawDescriptor: 'MENARDS 3021' }),
        txn({ externalId: 'txn-5', amountCents: cents(4500), rawDescriptor: 'FASTENAL 12' }),
        txn({ externalId: 'txn-6', amountCents: cents(-50000), rawDescriptor: 'CARD PAYMENT' }),
      ],
      nextCursor: 'cursor-2',
      hasMore: true,
    }),
    page({
      added: [
        txn({ externalId: 'txn-7', amountCents: cents(1250), rawDescriptor: 'DUMP FEE COUNTY' }),
      ],
      nextCursor: 'cursor-3',
      hasMore: false,
    }),
  ];
}

describeDb('runSync', () => {
  const getDb = useTestDb();
  let db: Database;
  let ownerId: string;
  let connection: BankConnection;

  beforeEach(async () => {
    lock.skipFromAttempt = Number.POSITIVE_INFINITY;
    lock.attempts = 0;

    db = getDb();
    ownerId = await createOwner(db);
    connection = await bankRepo.createConnection(
      db,
      ownerId,
      {
        itemId: FAKE_ITEM_ID,
        accessToken: FAKE_ACCESS_TOKEN,
        institutionId: 'ins_fake',
        institutionName: FAKE_INSTITUTION_NAME,
      },
      keyring
    );
    await bankRepo.upsertAccounts(db, ownerId, connection.id, ACCOUNTS);
  });

  function sync(
    script: Partial<FakeBankScript> & Pick<FakeBankScript, 'pages'>,
    options: { maxPages?: number; maxRestarts?: number } = {}
  ): { provider: FakeBankProvider; run: () => Promise<RunSyncResult> } {
    const provider = new FakeBankProvider({ accounts: ACCOUNTS, ...script });
    return {
      provider,
      run: () => runSync(db, ownerId, connection.id, { provider, keyring, ...options }),
    };
  }

  async function cursorOf(): Promise<string | null> {
    return (await bankRepo.getConnection(db, ownerId, connection.id))?.cursor ?? null;
  }

  async function reload(): Promise<BankConnection> {
    const row = await bankRepo.getConnection(db, ownerId, connection.id);
    if (!row) throw new Error('the connection vanished');
    return row;
  }

  async function accountIdFor(externalId: string): Promise<string> {
    const accounts = await bankRepo.listAccounts(db, ownerId, connection.id);
    const account = accounts.find((row) => row.externalId === externalId);
    if (!account) throw new Error(`no account ${externalId}`);
    return account.id;
  }

  it('applies three pages, committing the cursor with each', async () => {
    const out = await sync({ pages: threePages() }).run();

    expect(out).toMatchObject({ added: 7, modified: 0, removed: 0, pages: 3, hasMore: false });
    expect(await cursorOf()).toBe('cursor-3');
    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(7);
  });

  it('marks the connection synced and clears whatever a transient failure left (SF-1)', async () => {
    await bankRepo.recordSyncError(db, ownerId, connection.id, {
      code: 'SYNC_FAILED',
      status: 'error',
    });

    await sync({ pages: threePages() }).run();
    const after = await reload();

    expect(after.status).toBe('active');
    expect(after.lastErrorCode).toBeNull();
    expect(after.lastSyncedAt).not.toBeNull();
  });

  it('leaves the previous cursor when a page fails', async () => {
    const pages = threePages();
    const { run } = sync({
      pages,
      failAtPage: { index: 1, error: new PlaidRequestError('INTERNAL_SERVER_ERROR', 'boom') },
    });

    await expect(run()).rejects.toBeInstanceOf(PlaidRequestError);

    // The page that failed rolled back whole; the page before it did not.
    expect(await cursorOf()).toBe('cursor-1');
    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(
      pages[0].added.length
    );
    expect(await reload()).toMatchObject({
      status: 'error',
      lastErrorCode: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('restarts from the committed cursor on mutation-during-pagination, once', async () => {
    const { provider, run } = sync({
      pages: threePages(),
      failAtPage: {
        index: 1,
        error: new PlaidMutationDuringPagination('data moved mid-pagination'),
        times: 1,
      },
    });

    expect(await run()).toMatchObject({ added: 7, pages: 3, hasMore: false });
    // The retry asked for `cursor-1` again - the last cursor that committed -
    // rather than starting over from nothing.
    expect(provider.cursorsRequested).toEqual([null, 'cursor-1', 'cursor-1', 'cursor-2']);
    expect(await cursorOf()).toBe('cursor-3');
  });

  it('gives up after the restart budget, and says which failure it was', async () => {
    const { provider, run } = sync(
      {
        pages: threePages(),
        failAtPage: { index: 1, error: new PlaidMutationDuringPagination('again') },
      },
      { maxRestarts: 2 }
    );

    await expect(run()).rejects.toBeInstanceOf(PlaidMutationDuringPagination);

    // One attempt plus two restarts, all against the committed cursor.
    expect(provider.cursorsRequested).toEqual([null, 'cursor-1', 'cursor-1', 'cursor-1']);
    expect(await cursorOf()).toBe('cursor-1');
    expect((await reload()).lastErrorCode).toBe(
      'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'
    );
  });

  it('stops cleanly on rate limit and records the error', async () => {
    const { run } = sync({
      pages: threePages(),
      failAtPage: { index: 1, error: new PlaidRateLimited('slow down', 42) },
    });

    // Not a rejection: the pages that landed are real, and the caller is being
    // told to come back rather than that the sync failed.
    expect(await run()).toEqual({
      added: 3,
      modified: 0,
      removed: 0,
      pages: 1,
      hasMore: true,
      unknownAccountCount: 0,
      retryAfterSeconds: 42,
    });
    expect(await cursorOf()).toBe('cursor-1');
    expect(await reload()).toMatchObject({
      status: 'error',
      lastErrorCode: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('records reauth_required on ITEM_LOGIN_REQUIRED', async () => {
    const { run } = sync({
      pages: threePages(),
      failAtPage: { index: 0, error: new PlaidItemError('ITEM_LOGIN_REQUIRED', 'log in again') },
    });

    await expect(run()).rejects.toBeInstanceOf(PlaidItemError);
    expect(await reload()).toMatchObject({
      status: 'reauth_required',
      lastErrorCode: 'ITEM_LOGIN_REQUIRED',
    });
  });

  it.each(['PENDING_EXPIRATION', 'USER_PERMISSION_REVOKED'])(
    'records reauth_required on %s too',
    async (code) => {
      const { run } = sync({
        pages: threePages(),
        failAtPage: { index: 0, error: new PlaidItemError(code, 'the user has to act') },
      });

      await expect(run()).rejects.toBeInstanceOf(PlaidItemError);
      expect((await reload()).status).toBe('reauth_required');
    }
  );

  it('records a plain error for an item error the user cannot fix', async () => {
    const { run } = sync({
      pages: threePages(),
      failAtPage: { index: 0, error: new PlaidItemError('ITEM_NOT_SUPPORTED', 'no') },
    });

    await expect(run()).rejects.toBeInstanceOf(PlaidItemError);
    expect(await reload()).toMatchObject({
      status: 'error',
      lastErrorCode: 'ITEM_NOT_SUPPORTED',
    });
  });

  it('categorises on insert and files negatives as ignored', async () => {
    await sync({
      pages: [
        page({
          added: [
            txn({
              externalId: 'txn-hd',
              amountCents: cents(11475),
              rawDescriptor: 'HOME DEPOT #1234 SLC UT',
              merchantName: 'The Home Depot',
            }),
            txn({
              externalId: 'txn-pay',
              amountCents: cents(-50000),
              rawDescriptor: 'PAYMENT THANK YOU',
            }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    const credit = await accountIdFor(CREDIT);
    const purchase = await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-hd');
    const payment = await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-pay');

    expect(purchase).toMatchObject({
      category: 'materials',
      vendor: 'The Home Depot',
      taxDeductible: true,
      status: 'unassigned',
      // The description is the merchant when there is one; the bank's own line
      // is kept beside it rather than in place of it (asserted below - the
      // provider columns are not on the type the repository reads back).
      description: 'The Home Depot',
      // The card the charge was on, so the ledger can say which one.
      cardLast4: '4471',
      source: 'plaid',
      provider: 'plaid',
    });
    // Positive is money out, and no sign was flipped on the way in.
    expect(purchase?.amountCents).toBe(11475);

    expect(payment).toMatchObject({ status: 'ignored', amountCents: -50000 });

    // The columns the provider owns, read straight off the row: the bank's own
    // line is kept verbatim next to the cleaned-up description, and the hints
    // are stored rather than being collapsed into the category.
    const [stored] = await db.$client<
      Array<{ raw_descriptor: string; merchant_name: string; category_hint_primary: string | null }>
    >`select raw_descriptor, merchant_name, category_hint_primary
        from transactions where owner_id = ${ownerId} and external_id = 'txn-hd'`;
    expect(stored).toMatchObject({
      raw_descriptor: 'HOME DEPOT #1234 SLC UT',
      merchant_name: 'The Home Depot',
    });
  });

  it('leaves a still-authorizing charge with no posted time', async () => {
    await sync({
      pages: [
        page({
          added: [
            txn({
              externalId: 'txn-pending',
              amountCents: cents(8800),
              rawDescriptor: 'LOWES PENDING',
              pending: true,
              postedAt: new Date('2026-08-18T17:00:00.000Z'),
            }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    const row = await transactionsRepo.getByExternalId(
      db,
      ownerId,
      await accountIdFor(CREDIT),
      'txn-pending'
    );

    expect(row).toMatchObject({ pending: true, postedAt: null });
  });

  it('moves a filed pending charge onto the posted one that supersedes it', async () => {
    await sync({
      pages: [
        page({
          added: [
            txn({ externalId: 'txn-p', amountCents: cents(21000), rawDescriptor: 'LOWES', pending: true }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    const credit = await accountIdFor(CREDIT);
    const pending = await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-p');
    // Stand in for the user filing it: `reconcilePending` only carries filing
    // across when somebody actually touched the row.
    await transactionsRepo.updateTransaction(db, ownerId, pending!.id, {
      notes: 'kitchen job',
      userEditedAt: new Date('2026-08-19T09:00:00.000Z').toISOString(),
    });

    await sync({
      pages: resumingFrom(
        'cursor-1',
        page({
          added: [
            txn({
              externalId: 'txn-posted',
              amountCents: cents(21419),
              rawDescriptor: 'LOWES',
              pendingTransactionId: 'txn-p',
            }),
          ],
          removed: ['txn-p'],
          nextCursor: 'cursor-2',
        })
      ),
    }).run();

    expect(await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-p')).toBeNull();
    expect(await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-posted')).toMatchObject(
      { notes: 'kitchen job', amountCents: 21419 }
    );
  });

  it('applies the modified and removed halves of a page', async () => {
    await sync({
      pages: [
        page({
          added: [
            txn({ externalId: 'txn-a', amountCents: cents(1000), rawDescriptor: 'MENARDS' }),
            txn({ externalId: 'txn-b', amountCents: cents(2000), rawDescriptor: 'FASTENAL' }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    const out = await sync({
      pages: resumingFrom(
        'cursor-1',
        page({
          modified: [
            txn({ externalId: 'txn-a', amountCents: cents(1234), rawDescriptor: 'MENARDS' }),
          ],
          removed: ['txn-b'],
          nextCursor: 'cursor-2',
        })
      ),
    }).run();

    expect(out).toMatchObject({ added: 0, modified: 1, removed: 1 });
    const credit = await accountIdFor(CREDIT);
    expect(
      (await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-a'))?.amountCents
    ).toBe(1234);
    expect(await transactionsRepo.getByExternalId(db, ownerId, credit, 'txn-b')).toBeNull();
  });

  it('returns skipped when another sync holds the lock', async () => {
    const { provider, run } = sync({ pages: threePages() });

    const out = await holdSyncLock(connection.id, run);

    expect(out).toEqual({ skipped: true });
    // It did not even ask the bank: there was nothing for this run to add.
    expect(provider.cursorsRequested).toEqual([]);
    expect(await cursorOf()).toBeNull();
  });

  it('stops mid-run when another sync takes over, keeping what it committed', async () => {
    // The first page goes through the real lock; the second attempt is the one
    // a second sync would have won.
    lock.skipFromAttempt = 2;

    const out = await sync({ pages: threePages() }).run();

    expect(out).toEqual({
      added: 3,
      modified: 0,
      removed: 0,
      pages: 1,
      hasMore: true,
      unknownAccountCount: 0,
    });
    expect(await cursorOf()).toBe('cursor-1');
    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(3);
  });

  it('stops after maxPages and reports hasMore', async () => {
    const out = await sync({ pages: threePages() }, { maxPages: 2 }).run();

    expect(out).toMatchObject({ added: 6, pages: 2, hasMore: true });
    expect(await cursorOf()).toBe('cursor-2');
  });

  it('skips a row for an account this connection does not have, and says so', async () => {
    const out = await sync({
      pages: [
        page({
          added: [
            txn({ externalId: 'txn-ok', amountCents: cents(1000), rawDescriptor: 'MENARDS' }),
            txn({
              externalId: 'txn-orphan',
              amountCents: cents(2000),
              rawDescriptor: 'MENARDS',
              accountExternalId: 'fake-not-linked',
            }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    // The page still lands - one dropped row is not a reason to lose the other
    // - but the connection carries the code, because a transaction that never
    // arrived is one the owner would otherwise never know to look for. The
    // count itself is transient: it rides back on the result for the caller
    // to show, but is not what `recordSyncResult` persists.
    expect(out).toMatchObject({ added: 1, pages: 1, unknownAccountCount: 1 });
    const after = await reload();
    expect(after.lastErrorCode).toBe(UNKNOWN_ACCOUNT);
    expect(after.lastSyncedAt).not.toBeNull();
  });

  it('files a card charge to the card and a bank charge as a transfer', async () => {
    // The account the charge landed on is the only thing that says how it was
    // paid. A credit line is a card, and the mask is the card's last four, so
    // the ledger can say which one. A checking account is not: the mask is the
    // *account* number, and printing it as a card's last four would be a wrong
    // fact about a real card, so it is left off and the charge is a transfer.
    await sync({
      pages: [
        page({
          added: [
            txn({ externalId: 'txn-card', amountCents: cents(11475), rawDescriptor: 'MENARDS' }),
            txn({
              externalId: 'txn-bank',
              amountCents: cents(6210),
              rawDescriptor: 'CITY WATER AUTOPAY',
              accountExternalId: CHECKING,
            }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    const onCard = await transactionsRepo.getByExternalId(
      db,
      ownerId,
      await accountIdFor(CREDIT),
      'txn-card'
    );
    const onBank = await transactionsRepo.getByExternalId(
      db,
      ownerId,
      await accountIdFor(CHECKING),
      'txn-bank'
    );

    expect(onCard).toMatchObject({ paymentMethod: 'card', cardLast4: '4471' });
    expect(onBank).toMatchObject({ paymentMethod: 'transfer' });
    expect(onBank?.cardLast4).toBeUndefined();
  });

  it('refuses to call a page a success when the upsert wrote fewer rows than it was given', async () => {
    // A row belonging to somebody else, on the same account and external id.
    // `upsertFromBank` asserts the owner in its `setWhere`, so the conflicting
    // row is left untouched and comes back from `returning()` as nothing -
    // which must not read as "synced, nothing to do".
    const intruder = await createOwner(db, 'intruder@example.test');
    const credit = await accountIdFor(CREDIT);
    await db.$client`
      insert into transactions
        (owner_id, date, description, vendor, amount_cents, category, payment_method,
         status, source, provider, bank_account_id, external_id)
      values
        (${intruder}, '2026-08-01', 'not yours', '', 100, 'materials', 'card',
         'unassigned', 'plaid', 'plaid', ${credit}, 'txn-collide')
    `;

    const { run } = sync({
      pages: [
        page({
          added: [
            txn({ externalId: 'txn-fine', amountCents: cents(1000), rawDescriptor: 'MENARDS' }),
            txn({ externalId: 'txn-collide', amountCents: cents(2000), rawDescriptor: 'MENARDS' }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    });

    await expect(run()).rejects.toBeInstanceOf(SyncWriteShortfallError);

    // The whole page rolled back, cursor included.
    expect(await cursorOf()).toBeNull();
    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(0);
    expect((await reload()).lastErrorCode).toBe(SYNC_WRITE_SHORTFALL);
  });

  it('does not read a page that names one charge twice as a shortfall', async () => {
    // `upsertFromBank` collapses a page onto the dedupe key before it writes,
    // so a provider that lists the same transaction twice - which
    // `/transactions/sync` does when a charge is amended inside one page -
    // produces one row for two entries. Counting what was *given* rather than
    // what was distinct would call that a shortfall and roll the page back.
    const out = await sync({
      pages: [
        page({
          added: [
            txn({ externalId: 'txn-twice', amountCents: cents(1000), rawDescriptor: 'MENARDS' }),
            txn({ externalId: 'txn-twice', amountCents: cents(1000), rawDescriptor: 'MENARDS' }),
          ],
          nextCursor: 'cursor-1',
        }),
      ],
    }).run();

    expect(out).toMatchObject({ added: 1, pages: 1 });
    expect(await cursorOf()).toBe('cursor-1');
  });

  it('never lets the shortfall message carry the token or a row of somebody else’s', async () => {
    const error = new SyncWriteShortfallError(2, 1);

    expect(error.message).not.toContain(FAKE_ACCESS_TOKEN);
    expect(error.code).toBe(SYNC_WRITE_SHORTFALL);
  });

  it('commits nothing and asks again when the provider sends more with no cursor', async () => {
    const out = await sync({
      pages: [page({ added: [], nextCursor: null, hasMore: true })],
    }).run();

    expect(out).toMatchObject({ pages: 1, hasMore: true });
    expect(await cursorOf()).toBeNull();
  });

  it('refuses a connection that belongs to somebody else', async () => {
    const stranger = await createOwner(db, 'stranger@example.test');

    await expect(
      runSync(db, stranger, connection.id, {
        provider: new FakeBankProvider({ accounts: ACCOUNTS, pages: threePages() }),
        keyring,
      })
    ).rejects.toThrow();
  });
});
