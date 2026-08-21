import { parseMoney } from '@budget-bot/core';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { projectsRepo, transactionsRepo } from '../../src/repos';
import type { BankTransactionRow, NewTransaction } from '../../src/repos/transactions';
import { bankAccounts, bankConnections, transactions } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';
import { newProject } from '../helpers/fixtures';

const getDb = useTestDb();

const manual = (overrides: Partial<NewTransaction> = {}): NewTransaction => ({
  date: '2026-08-14',
  description: 'THE HOME DEPOT #0421',
  vendor: 'The Home Depot',
  amountCents: parseMoney('114.75'),
  category: 'materials',
  paymentMethod: 'card',
  status: 'unassigned',
  taxDeductible: true,
  ...overrides,
});

async function createBankAccount(db: Database, ownerId: string): Promise<string> {
  const [connection] = await db
    .insert(bankConnections)
    .values({
      ownerId,
      itemId: `item-${crypto.randomUUID()}`,
      institutionName: 'California Credit Union',
      accessTokenCiphertext: 'v1:k2:aaaa:bbbb:cccc',
      encryptionKeyId: 'k2',
    })
    .returning({ id: bankConnections.id });
  const [account] = await db
    .insert(bankAccounts)
    .values({
      ownerId,
      connectionId: connection.id,
      externalAccountId: 'acct-1',
      name: 'Visa Signature',
      mask: '4892',
      type: 'credit',
    })
    .returning({ id: bankAccounts.id });
  return account.id;
}

const synced = (
  bankAccountId: string,
  overrides: Partial<BankTransactionRow> = {}
): BankTransactionRow => ({
  ...manual(),
  provider: 'plaid',
  bankAccountId,
  externalId: 'plaid-tx-1',
  rawDescriptor: 'THE HOME DEPOT #0421 SPRINGFIELD',
  merchantName: 'The Home Depot',
  pending: false,
  ...overrides,
});

describeDb('transactionsRepo money and identity', () => {
  it('round-trips whole cents through a bigint column', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const amountCents = parseMoney('12345678.99');

    const created = await transactionsRepo.createTransaction(
      db,
      ownerId,
      manual({ amountCents })
    );
    const [read] = await transactionsRepo.listTransactions(db, ownerId);

    expect(created.amountCents).toBe(1234567899);
    expect(read.amountCents).toBe(1234567899);
    expect(Number.isInteger(read.amountCents)).toBe(true);
  });

  it('lets any number of hand-entered rows exist - they have no external id', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    await transactionsRepo.bulkCreateTransactions(db, ownerId, [
      manual({ description: 'First' }),
      manual({ description: 'Second' }),
      manual({ description: 'Third' }),
    ]);

    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(3);
  });

  it('refuses a second row with the same provider, account and external id', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const duplicate = {
      ownerId,
      ...manual(),
      provider: 'plaid',
      bankAccountId,
      externalId: 'plaid-tx-1',
      source: 'plaid' as const,
    };

    await db.insert(transactions).values(duplicate);

    // drizzle wraps the driver error, so the constraint that fired is on the
    // cause; asserting on it names the index rather than any old failure.
    const failure = await db
      .insert(transactions)
      .values(duplicate)
      .then(() => null, (error: { cause?: { constraint_name?: string } }) => error);
    expect(failure?.cause?.constraint_name).toBe(
      'transactions_provider_account_external_key'
    );
  });
});

describeDb('transactionsRepo.getTransaction', () => {
  it('surfaces the bank columns a synced row stores', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);

    const [created] = await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId, {
        externalId: 'tx-1',
        postedAt: new Date('2026-08-18T15:00:00.000Z'),
        pending: true,
      }),
    ]);
    const read = await transactionsRepo.getTransaction(db, ownerId, created.id);

    expect(read).toMatchObject({
      source: 'plaid',
      provider: 'plaid',
      externalId: 'tx-1',
      pending: true,
      postedAt: '2026-08-18T15:00:00.000Z',
      bankAccountId,
      removedAt: null,
      userEditedAt: null,
    });
  });

  it('defaults a manual row to source manual, not pending', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    const created = await transactionsRepo.createTransaction(db, ownerId, manual());

    expect(created).toMatchObject({
      source: 'manual',
      pending: false,
      postedAt: null,
      provider: null,
      externalId: null,
      bankAccountId: null,
      removedAt: null,
      userEditedAt: null,
    });
  });
});

describeDb('transactionsRepo.upsertFromBank', () => {
  it('inserts rows the feed has not sent before', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);

    await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId, { externalId: 'plaid-tx-1' }),
      synced(bankAccountId, { externalId: 'plaid-tx-2' }),
    ]);

    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(2);
  });

  it('applies the same page twice without duplicating anything', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const page = [
      synced(bankAccountId, { externalId: 'plaid-tx-1' }),
      synced(bankAccountId, { externalId: 'plaid-tx-2' }),
    ];

    await transactionsRepo.upsertFromBank(db, ownerId, page);
    await transactionsRepo.upsertFromBank(db, ownerId, page);

    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(2);
  });

  it('collapses a page that carries the same transaction twice', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);

    await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId, { amountCents: parseMoney('10.00') }),
      synced(bankAccountId, { amountCents: parseMoney('12.00') }),
    ]);

    const rows = await transactionsRepo.listTransactions(db, ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(1200);
  });

  it('overwrites the columns the provider owns when a transaction changes', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId, {
        amountCents: parseMoney('114.75'),
        date: '2026-08-14',
        pending: true,
      }),
    ]);

    // The pending authorisation posted: a different amount, a settlement date.
    await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId, {
        amountCents: parseMoney('121.10'),
        date: '2026-08-15',
        pending: false,
        postedAt: new Date('2026-08-15T14:00:00.000Z'),
        rawDescriptor: 'THE HOME DEPOT #0421 SPRINGFIELD IL',
        merchantName: 'Home Depot',
        categoryHintPrimary: 'HOME_IMPROVEMENT',
        categoryHintDetailed: 'HOME_IMPROVEMENT_HARDWARE',
      }),
    ]);

    const [row] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ownerId, ownerId));
    expect(row.amountCents).toBe(12110);
    expect(row.date).toBe('2026-08-15');
    expect(row.pending).toBe(false);
    expect(row.postedAt?.toISOString()).toBe('2026-08-15T14:00:00.000Z');
    expect(row.rawDescriptor).toBe('THE HOME DEPOT #0421 SPRINGFIELD IL');
    expect(row.merchantName).toBe('Home Depot');
    expect(row.categoryHintPrimary).toBe('HOME_IMPROVEMENT');
    expect(row.categoryHintDetailed).toBe('HOME_IMPROVEMENT_HARDWARE');
  });

  it('never overwrites what the user decided about a transaction', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const [created] = await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId),
    ]);

    // The user files it: a project, a category, a receipt, a note.
    await transactionsRepo.updateTransaction(db, ownerId, created.id, {
      status: 'matched',
      notes: 'Deck rebuild, second lumber run',
      receiptNumber: 'R-4471',
      category: 'tools',
      vendor: 'Home Depot (Springfield)',
      taxDeductible: false,
    });

    // ...and then the bank re-sends the transaction with everything different.
    await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId, {
        status: 'unassigned',
        notes: 'from the bank',
        receiptNumber: '',
        category: 'materials',
        vendor: 'THE HOME DEPOT',
        taxDeductible: true,
        description: 'THE HOME DEPOT #0421 REBILLED',
      }),
    ]);

    const [row] = await transactionsRepo.listTransactions(db, ownerId);
    expect(row.status).toBe('matched');
    expect(row.notes).toBe('Deck rebuild, second lumber run');
    expect(row.receiptNumber).toBe('R-4471');
    expect(row.category).toBe('tools');
    expect(row.vendor).toBe('Home Depot (Springfield)');
    expect(row.taxDeductible).toBe(false);
    expect(row.description).toBe('THE HOME DEPOT #0421');
  });

  it('leaves a project assignment alone when the transaction is re-synced', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const [created] = await transactionsRepo.upsertFromBank(db, ownerId, [
      synced(bankAccountId),
    ]);
    await transactionsRepo.updateTransaction(db, ownerId, created.id, {
      projectId: project.id,
      status: 'matched',
    });

    await transactionsRepo.upsertFromBank(db, ownerId, [synced(bankAccountId)]);

    const [row] = await transactionsRepo.listTransactions(db, ownerId);
    expect(row.projectId).toBe(project.id);
    expect(row.status).toBe('matched');
  });
});

describeDb('transactionsRepo owner isolation', () => {
  it('never returns, updates or deletes another owner’s rows', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const hers = await transactionsRepo.createTransaction(db, alice, manual());

    expect(await transactionsRepo.listTransactions(db, bob)).toEqual([]);
    expect(await transactionsRepo.updateTransaction(db, bob, hers.id, { notes: 'mine' })).toBeNull();
    expect(await transactionsRepo.deleteTransaction(db, bob, hers.id)).toBe(false);
    expect(await transactionsRepo.listTransactions(db, alice)).toHaveLength(1);
  });

  it('keeps the bank feeds of two owners apart', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const hers = await createBankAccount(db, alice);
    const his = await createBankAccount(db, bob);

    await transactionsRepo.upsertFromBank(db, alice, [synced(hers)]);
    await transactionsRepo.upsertFromBank(db, bob, [synced(his)]);

    expect(await transactionsRepo.listTransactions(db, alice)).toHaveLength(1);
    expect(await transactionsRepo.listTransactions(db, bob)).toHaveLength(1);
  });

  it('unfiles a charge when the update says the project is null', async () => {
    // The inbox's "put it back" is `projectId: null`, and it has to clear the
    // column rather than only changing the status - a row that says
    // `unassigned` while still pointing at a job counts twice: once in the
    // inbox, once against that job's margin.
    const db = getDb();
    const ownerId = await createOwner(db);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const created = await transactionsRepo.createTransaction(db, ownerId, {
      ...manual(),
      projectId: project.id,
      status: 'matched',
    });

    const updated = await transactionsRepo.updateTransaction(db, ownerId, created.id, {
      projectId: null,
      status: 'unassigned',
    });

    expect(updated).toMatchObject({ status: 'unassigned' });
    expect(updated?.projectId).toBeUndefined();
  });

  it('leaves the filing alone when an update does not mention the project', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const created = await transactionsRepo.createTransaction(db, ownerId, {
      ...manual(),
      projectId: project.id,
      status: 'matched',
    });

    const updated = await transactionsRepo.updateTransaction(db, ownerId, created.id, {
      category: 'tools',
    });

    expect(updated).toMatchObject({ category: 'tools', projectId: project.id });
  });
});
