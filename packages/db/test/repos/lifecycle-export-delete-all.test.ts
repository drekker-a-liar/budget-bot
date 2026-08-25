import { parseMoney } from '@budget-bot/core';
import { expect, it } from 'vitest';
import { loadKeysFromEnv } from '../../src/crypto';
import {
  bankRepo,
  importBatchesRepo,
  invoicesRepo,
  laborRepo,
  projectsRepo,
  transactionsRepo,
} from '../../src/repos';
import { createOwner, describeDb, useTestDb } from '../helpers/db';
import { newProject } from '../helpers/fixtures';

/**
 * The two repository-level jobs export and delete-all are built on (spec §6):
 * a projection of a connection an export may carry, and a bulk delete per
 * table scoped to one owner. Both are exercised against a real Postgres
 * because the property under test - what a query does and does not return,
 * whether a `DELETE` reaches another owner's rows - is exactly what a mocked
 * database would only ever agree with the test's own assumption about.
 */

const getDb = useTestDb();

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const KEY_B64 = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');
const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: KEY_B64 });

describeDb('bankRepo.listConnectionsForExport', () => {
  it('carries institution, status and account shape - never a token, cursor or id', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(
      db,
      ownerId,
      {
        itemId: 'item-export-1',
        accessToken: 'access-plaintext-export-test',
        institutionId: 'ins_fake',
        institutionName: 'Fake Bank (E2E)',
      },
      keyring
    );
    await bankRepo.upsertAccounts(db, ownerId, connection.id, [
      {
        externalId: 'acct-checking',
        name: 'Business Checking',
        officialName: 'Fake Bank Business Checking',
        mask: '0000',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: parseMoney('412.00'),
        availableBalanceCents: parseMoney('412.00'),
        creditLimitCents: null,
        isoCurrencyCode: 'USD',
      },
    ]);

    const [exported] = await bankRepo.listConnectionsForExport(db, ownerId);

    expect(exported).toEqual({
      institutionName: 'Fake Bank (E2E)',
      status: 'active',
      createdAt: expect.any(String),
      lastSyncedAt: null,
      accounts: [
        {
          name: 'Business Checking',
          mask: '0000',
          type: 'depository',
          subtype: 'checking',
          isEnabled: true,
        },
      ],
    });
    const json = JSON.stringify(exported);
    expect(json).not.toContain('access-plaintext-export-test');
    expect(json).not.toMatch(/cursor|itemId|item_id|encryptionKeyId|encryption_key_id/i);
  });

  it('never returns another owner’s connections', async () => {
    const db = getDb();
    const mine = await createOwner(db);
    const theirs = await createOwner(db);
    await bankRepo.createConnection(
      db,
      theirs,
      { itemId: 'item-not-mine', accessToken: 'access-not-mine', institutionName: 'Not Mine Bank' },
      keyring
    );

    expect(await bankRepo.listConnectionsForExport(db, mine)).toEqual([]);
  });
});

describeDb('importBatchesRepo.listImportBatches', () => {
  it('lists only the owner’s own batches', async () => {
    const db = getDb();
    const mine = await createOwner(db);
    const theirs = await createOwner(db);
    await importBatchesRepo.createImportBatch(db, mine, {
      source: 'csv',
      filename: 'mine.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    await importBatchesRepo.createImportBatch(db, theirs, {
      source: 'csv',
      filename: 'theirs.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });

    const batches = await importBatchesRepo.listImportBatches(db, mine);

    expect(batches).toHaveLength(1);
    expect(batches[0].filename).toBe('mine.csv');
  });
});

describeDb('the delete-all functions (spec §6)', () => {
  async function twoOwnersWithData() {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);

    const aliceProject = await projectsRepo.createProject(db, alice, newProject({ name: "Alice's Deck" }));
    const bobProject = await projectsRepo.createProject(db, bob, newProject({ name: "Bob's Fence" }));

    await transactionsRepo.createTransaction(db, alice, {
      date: '2026-08-14',
      description: 'THE HOME DEPOT #0421',
      vendor: 'The Home Depot',
      amountCents: parseMoney('114.75'),
      category: 'materials',
      paymentMethod: 'card',
      status: 'unassigned',
      taxDeductible: true,
    });
    await transactionsRepo.createTransaction(db, bob, {
      date: '2026-08-14',
      description: 'LOWES #1104',
      vendor: "Lowe's",
      amountCents: parseMoney('42.10'),
      category: 'materials',
      paymentMethod: 'card',
      status: 'unassigned',
      taxDeductible: true,
    });

    await laborRepo.createLaborEntry(db, alice, {
      projectId: aliceProject.id,
      date: '2026-08-05',
      hours: 4,
      hourlyRateCents: parseMoney('85.00'),
      workerName: 'Mike',
    });
    await laborRepo.createLaborEntry(db, bob, {
      projectId: bobProject.id,
      date: '2026-08-05',
      hours: 6,
      hourlyRateCents: parseMoney('75.00'),
      workerName: 'Bob',
    });

    await invoicesRepo.createInvoice(db, alice, {
      projectId: aliceProject.id,
      invoiceNumber: 'INV-A-1',
      amountCents: parseMoney('1950.00'),
      depositAmountCents: parseMoney('0'),
      dateIssued: '2026-08-01',
      dueDate: '2026-08-15',
      status: 'sent',
    });
    await invoicesRepo.createInvoice(db, bob, {
      projectId: bobProject.id,
      invoiceNumber: 'INV-B-1',
      amountCents: parseMoney('900.00'),
      depositAmountCents: parseMoney('0'),
      dateIssued: '2026-08-01',
      dueDate: '2026-08-15',
      status: 'sent',
    });

    await importBatchesRepo.createImportBatch(db, alice, {
      source: 'csv',
      filename: 'alice.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    await importBatchesRepo.createImportBatch(db, bob, {
      source: 'csv',
      filename: 'bob.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });

    const aliceConnection = await bankRepo.createConnection(
      db,
      alice,
      { itemId: 'item-alice', accessToken: 'access-alice', institutionName: 'Alice Bank' },
      keyring
    );
    await bankRepo.createConnection(
      db,
      bob,
      { itemId: 'item-bob', accessToken: 'access-bob', institutionName: 'Bob Bank' },
      keyring
    );

    return { db, alice, bob, aliceProject, bobProject, aliceConnection };
  }

  it('deletes only the calling owner’s rows, table by table, leaving the other owner intact', async () => {
    const { db, alice, bob } = await twoOwnersWithData();

    const counts = {
      connections: await bankRepo.deleteAllConnections(db, alice),
      transactions: await transactionsRepo.deleteAllTransactions(db, alice),
      laborEntries: await laborRepo.deleteAllLaborEntries(db, alice),
      invoices: await invoicesRepo.deleteAllInvoices(db, alice),
      importBatches: await importBatchesRepo.deleteAllImportBatches(db, alice),
      projects: await projectsRepo.deleteAllProjects(db, alice),
    };

    expect(counts).toEqual({
      connections: 1,
      transactions: 1,
      laborEntries: 1,
      invoices: 1,
      importBatches: 1,
      projects: 1,
    });

    expect(await bankRepo.listConnections(db, alice)).toEqual([]);
    expect(await transactionsRepo.listTransactions(db, alice)).toEqual([]);
    expect(await laborRepo.listLaborEntries(db, alice)).toEqual([]);
    expect(await invoicesRepo.listInvoices(db, alice)).toEqual([]);
    expect(await importBatchesRepo.listImportBatches(db, alice)).toEqual([]);
    expect(await projectsRepo.listProjects(db, alice)).toEqual([]);

    expect(await bankRepo.listConnections(db, bob)).toHaveLength(1);
    expect(await transactionsRepo.listTransactions(db, bob)).toHaveLength(1);
    expect(await laborRepo.listLaborEntries(db, bob)).toHaveLength(1);
    expect(await invoicesRepo.listInvoices(db, bob)).toHaveLength(1);
    expect(await importBatchesRepo.listImportBatches(db, bob)).toHaveLength(1);
    expect(await projectsRepo.listProjects(db, bob)).toHaveLength(1);
  });

  it('reports zero rather than failing when the owner has nothing in a table', async () => {
    const db = getDb();
    const empty = await createOwner(db);

    expect(await bankRepo.deleteAllConnections(db, empty)).toBe(0);
    expect(await transactionsRepo.deleteAllTransactions(db, empty)).toBe(0);
    expect(await laborRepo.deleteAllLaborEntries(db, empty)).toBe(0);
    expect(await invoicesRepo.deleteAllInvoices(db, empty)).toBe(0);
    expect(await importBatchesRepo.deleteAllImportBatches(db, empty)).toBe(0);
    expect(await projectsRepo.deleteAllProjects(db, empty)).toBe(0);
  });
});
