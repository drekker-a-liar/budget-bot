import { parseMoney } from '@budget-bot/core';
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { projectsRepo, transactionsRepo } from '../../src/repos';
import type { BankTransactionRow, NewTransaction } from '../../src/repos/transactions';
import { bankAccounts, bankConnections, transactions } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';
import { newProject } from '../helpers/fixtures';

/**
 * The three writes the sync merge rule is made of (ADR 0004).
 *
 * Everything here is one question asked from several directions: what happens
 * to an afternoon of filing when the bank sends the row again. The provider
 * owns the amount, the dates and its own descriptor; the user owns where the
 * charge was filed, what it is called and whether it is deductible. A test
 * that only checked the provider's half would pass on a repo that overwrote
 * the user's, which is the failure this file exists to catch.
 */

const getDb = useTestDb();

const NOW = '2026-08-20T17:00:00.000Z';

const manual = (overrides: Partial<NewTransaction> = {}): NewTransaction => ({
  date: '2026-08-14',
  description: 'THE HOME DEPOT #0421',
  vendor: 'The Home Depot',
  amountCents: parseMoney('114.75'),
  category: 'materials',
  paymentMethod: 'card',
  status: 'unassigned',
  taxDeductible: false,
  ...overrides,
});

async function createBankAccount(db: Database, ownerId: string): Promise<string> {
  const [connection] = await db
    .insert(bankConnections)
    .values({
      ownerId,
      itemId: `item-${crypto.randomUUID()}`,
      institutionName: 'California Credit Union',
      accessTokenCiphertext: 'v1:00000000:aaaa:bbbb:cccc',
      encryptionKeyId: '00000000',
    })
    .returning({ id: bankConnections.id });
  const [account] = await db
    .insert(bankAccounts)
    .values({
      ownerId,
      connectionId: connection.id,
      externalAccountId: `acct-${crypto.randomUUID()}`,
      name: 'Visa Signature',
      mask: '4892',
      type: 'credit',
    })
    .returning({ id: bankAccounts.id });
  return account.id;
}

const row = (
  bankAccountId: string,
  externalId: string,
  overrides: Partial<BankTransactionRow> = {}
): BankTransactionRow => ({
  ...manual(),
  provider: 'plaid',
  bankAccountId,
  externalId,
  rawDescriptor: 'THE HOME DEPOT #0421 SPRINGFIELD',
  merchantName: 'The Home Depot',
  pending: false,
  ...overrides,
});

describeDb('transactionsRepo.applyModified', () => {
  it('changes the amount and the descriptor but not the user’s filing', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const [created] = await transactionsRepo.upsertFromBank(db, ownerId, [
      row(bankAccountId, 'tx-1', { amountCents: parseMoney('10.00') }),
    ]);
    await transactionsRepo.updateTransaction(db, ownerId, created.id, {
      projectId: project.id,
      status: 'matched',
      category: 'tools',
      vendor: 'Home Depot (deck job)',
      taxDeductible: true,
      notes: 'drill',
      receiptNumber: 'R-77',
      userEditedAt: NOW,
    });

    const changed = await transactionsRepo.applyModified(db, ownerId, [
      row(bankAccountId, 'tx-1', {
        amountCents: parseMoney('12.50'),
        date: '2026-08-15',
        rawDescriptor: 'HOME DEPOT 1234 POSTED',
        postedAt: new Date('2026-08-15T14:00:00.000Z'),
        pending: false,
      }),
    ]);

    expect(changed).toBe(1);
    expect(await transactionsRepo.getTransaction(db, ownerId, created.id)).toMatchObject({
      amountCents: 1250,
      date: '2026-08-15',
      postedAt: '2026-08-15T14:00:00.000Z',
      projectId: project.id,
      status: 'matched',
      category: 'tools',
      vendor: 'Home Depot (deck job)',
      taxDeductible: true,
      notes: 'drill',
      receiptNumber: 'R-77',
    });
    const [raw] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, created.id));
    expect(raw.rawDescriptor).toBe('HOME DEPOT 1234 POSTED');
    // The description is what the user reads every day; the raw descriptor is
    // where the bank's new text goes.
    expect(raw.description).toBe('THE HOME DEPOT #0421');
  });

  it('leaves the category alone even on a row the user never touched', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const [created] = await transactionsRepo.upsertFromBank(db, ownerId, [
      row(bankAccountId, 'tx-1', { category: 'materials', vendor: 'The Home Depot' }),
    ]);

    // `categorizeVendor` runs on insert only (spec §5): a modification that
    // renamed the merchant is not a reason to re-file a charge, and there is
    // no way to tell a categorisation the user accepted from one they never
    // looked at. So `category`, `vendor` and `taxDeductible` are simply not in
    // the set clause - `user_edited_at` does not even have to be consulted.
    await transactionsRepo.applyModified(db, ownerId, [
      row(bankAccountId, 'tx-1', {
        category: 'tools',
        vendor: 'Lowes',
        taxDeductible: true,
        merchantName: 'Lowes',
      }),
    ]);

    expect(await transactionsRepo.getTransaction(db, ownerId, created.id)).toMatchObject({
      category: 'materials',
      vendor: 'The Home Depot',
      taxDeductible: false,
      userEditedAt: null,
    });
  });

  it('does not insert a row the feed has never sent before', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);

    const changed = await transactionsRepo.applyModified(db, ownerId, [
      row(bankAccountId, 'tx-unknown'),
    ]);

    expect(changed).toBe(0);
    expect(await transactionsRepo.listTransactions(db, ownerId)).toEqual([]);
  });

  it('cannot reach across owners', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const bankAccountId = await createBankAccount(db, alice);
    const [created] = await transactionsRepo.upsertFromBank(db, alice, [
      row(bankAccountId, 'tx-1', { amountCents: parseMoney('10.00') }),
    ]);

    const changed = await transactionsRepo.applyModified(db, bob, [
      row(bankAccountId, 'tx-1', { amountCents: parseMoney('999.00') }),
    ]);

    expect(changed).toBe(0);
    expect(
      (await transactionsRepo.getTransaction(db, alice, created.id))?.amountCents
    ).toBe(1000);
  });
});

describeDb('transactionsRepo.reconcilePending', () => {
  it('moves the filing from the pending row to the posted one and drops the pending row', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const [pending] = await transactionsRepo.upsertFromBank(db, ownerId, [
      row(bankAccountId, 'pend-1', { pending: true, amountCents: parseMoney('10.00') }),
    ]);
    await transactionsRepo.updateTransaction(db, ownerId, pending.id, {
      projectId: project.id,
      status: 'matched',
      category: 'tools',
      vendor: 'Home Depot (deck job)',
      taxDeductible: true,
      notes: 'receipt 77',
      receiptNumber: 'R-77',
      userEditedAt: NOW,
    });

    const posted = row(bankAccountId, 'post-1', {
      pending: false,
      pendingTransactionId: 'pend-1',
      amountCents: parseMoney('10.00'),
    });
    await transactionsRepo.upsertFromBank(db, ownerId, [posted]);
    const moved = await transactionsRepo.reconcilePending(db, ownerId, bankAccountId, [
      posted,
    ]);

    expect(moved).toBe(1);
    expect(
      await transactionsRepo.getByExternalId(db, ownerId, bankAccountId, 'pend-1')
    ).toBeNull();
    expect(
      await transactionsRepo.getByExternalId(db, ownerId, bankAccountId, 'post-1')
    ).toMatchObject({
      projectId: project.id,
      status: 'matched',
      category: 'tools',
      vendor: 'Home Depot (deck job)',
      taxDeductible: true,
      notes: 'receipt 77',
      receiptNumber: 'R-77',
      userEditedAt: NOW,
      pending: false,
    });
  });

  it('drops a pending row the user never filed without copying anything', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    await transactionsRepo.upsertFromBank(db, ownerId, [
      row(bankAccountId, 'pend-1', { pending: true, category: 'overhead' }),
    ]);

    const posted = row(bankAccountId, 'post-1', {
      pendingTransactionId: 'pend-1',
      category: 'materials',
    });
    await transactionsRepo.upsertFromBank(db, ownerId, [posted]);
    const moved = await transactionsRepo.reconcilePending(db, ownerId, bankAccountId, [
      posted,
    ]);

    // The posted row supersedes the pending one either way, so the pending row
    // goes; what it does not do is drag an untouched default over the
    // categorisation the posted row was inserted with.
    expect(moved).toBe(1);
    expect(
      await transactionsRepo.getByExternalId(db, ownerId, bankAccountId, 'pend-1')
    ).toBeNull();
    expect(
      await transactionsRepo.getByExternalId(db, ownerId, bankAccountId, 'post-1')
    ).toMatchObject({ category: 'materials', userEditedAt: null });
  });

  it('keeps the pending row when the posted row has not landed yet', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const [pending] = await transactionsRepo.upsertFromBank(db, ownerId, [
      row(bankAccountId, 'pend-1', { pending: true }),
    ]);
    await transactionsRepo.updateTransaction(db, ownerId, pending.id, {
      projectId: project.id,
      userEditedAt: NOW,
    });

    // Called without upserting the posted row first: deleting the pending row
    // here would throw the filing away with nothing to inherit it.
    const moved = await transactionsRepo.reconcilePending(db, ownerId, bankAccountId, [
      row(bankAccountId, 'post-1', { pendingTransactionId: 'pend-1' }),
    ]);

    expect(moved).toBe(0);
    expect(
      await transactionsRepo.getByExternalId(db, ownerId, bankAccountId, 'pend-1')
    ).toMatchObject({ projectId: project.id });
  });

  it('ignores posted rows that do not supersede anything', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const posted = row(bankAccountId, 'post-1');
    await transactionsRepo.upsertFromBank(db, ownerId, [posted]);

    expect(
      await transactionsRepo.reconcilePending(db, ownerId, bankAccountId, [posted])
    ).toBe(0);
    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(1);
  });

  it('cannot reconcile against another owner’s rows', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const bankAccountId = await createBankAccount(db, alice);
    const posted = row(bankAccountId, 'post-1', { pendingTransactionId: 'pend-1' });
    await transactionsRepo.upsertFromBank(db, alice, [
      row(bankAccountId, 'pend-1', { pending: true }),
      posted,
    ]);

    expect(
      await transactionsRepo.reconcilePending(db, bob, bankAccountId, [posted])
    ).toBe(0);
    expect(
      await transactionsRepo.getByExternalId(db, alice, bankAccountId, 'pend-1')
    ).not.toBeNull();
  });
});

describeDb('transactionsRepo.applyRemoved', () => {
  it('soft-deletes a filed row and deletes an unfiled one', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);
    const project = await projectsRepo.createProject(db, ownerId, newProject());
    const [filed, unfiled] = await transactionsRepo.upsertFromBank(db, ownerId, [
      row(bankAccountId, 'tx-filed'),
      row(bankAccountId, 'tx-unfiled'),
    ]);
    await transactionsRepo.updateTransaction(db, ownerId, filed.id, {
      projectId: project.id,
      status: 'matched',
      userEditedAt: NOW,
    });

    const result = await transactionsRepo.applyRemoved(db, ownerId, bankAccountId, [
      'tx-filed',
      'tx-unfiled',
    ]);

    expect(result).toEqual({ softDeleted: 1, deleted: 1 });
    // A categorised expense the provider withdrew is never silently lost
    // (ADR 0004): it leaves the ledger but the row survives for the person who
    // filed it to look at.
    const kept = await transactionsRepo.getByExternalId(
      db,
      ownerId,
      bankAccountId,
      'tx-filed'
    );
    expect(kept?.removedAt).not.toBeNull();
    expect(await transactionsRepo.listTransactions(db, ownerId)).toEqual([]);
    expect(
      await transactionsRepo.getByExternalId(db, ownerId, bankAccountId, 'tx-unfiled')
    ).toBeNull();
    expect(await transactionsRepo.getTransaction(db, ownerId, unfiled.id)).toBeUndefined();
  });

  it('does nothing for an empty page', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bankAccountId = await createBankAccount(db, ownerId);

    expect(await transactionsRepo.applyRemoved(db, ownerId, bankAccountId, [])).toEqual({
      softDeleted: 0,
      deleted: 0,
    });
  });

  it('cannot remove another owner’s rows', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const bankAccountId = await createBankAccount(db, alice);
    await transactionsRepo.upsertFromBank(db, alice, [row(bankAccountId, 'tx-1')]);

    expect(
      await transactionsRepo.applyRemoved(db, bob, bankAccountId, ['tx-1'])
    ).toEqual({ softDeleted: 0, deleted: 0 });
    expect(await transactionsRepo.listTransactions(db, alice)).toHaveLength(1);
  });
});

describeDb('transactionsRepo.upsertFromBank owner scoping', () => {
  it('cannot write across owners even with a colliding key', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const bankAccountId = await createBankAccount(db, alice);
    await transactionsRepo.upsertFromBank(db, alice, [
      row(bankAccountId, 'tx-1', { amountCents: parseMoney('10.00') }),
    ]);

    // Bob names Alice's account and her external id. The dedupe index does not
    // carry the owner, so without `setWhere` the conflict would quietly
    // rewrite her row's amount.
    const written = await transactionsRepo.upsertFromBank(db, bob, [
      row(bankAccountId, 'tx-1', { amountCents: parseMoney('999.00') }),
    ]);

    expect(written).toEqual([]);
    expect(await transactionsRepo.listTransactions(db, bob)).toEqual([]);
    const [alices] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.ownerId, alice), eq(transactions.externalId, 'tx-1')));
    expect(alices.amountCents).toBe(1000);
  });
});

describeDb('transactionsRepo.getByExternalId', () => {
  it('finds the owner’s row and nobody else’s', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const bankAccountId = await createBankAccount(db, alice);
    await transactionsRepo.upsertFromBank(db, alice, [row(bankAccountId, 'tx-1')]);

    expect(
      await transactionsRepo.getByExternalId(db, alice, bankAccountId, 'tx-1')
    ).toMatchObject({ externalId: 'tx-1' });
    expect(
      await transactionsRepo.getByExternalId(db, bob, bankAccountId, 'tx-1')
    ).toBeNull();
    expect(
      await transactionsRepo.getByExternalId(db, alice, bankAccountId, 'tx-nope')
    ).toBeNull();
  });

  it('refuses a bank account id that is not a uuid rather than letting Postgres raise', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(
      await transactionsRepo.getByExternalId(db, ownerId, 'acct-1', 'tx-1')
    ).toBeNull();
  });
});
