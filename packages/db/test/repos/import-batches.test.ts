import { parseMoney } from '@budget-bot/core';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { importsRepo, importBatchesRepo, transactionsRepo } from '../../src/repos';
import { UnknownProjectError } from '../../src/repos/errors';
import { bankAccounts, bankConnections, importBatches, transactions } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';

/**
 * An import is one event with rows hanging off it, so that a user who
 * uploaded the wrong statement can see what it brought in and take it back
 * out again in one move (spec §5).
 */

const getDb = useTestDb();

/** A minimal linked account, so a synced (`plaid`) row has one to point at. */
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

const csvRow = (overrides: Partial<Parameters<typeof transactionsRepo.bulkCreateImported>[2][number]> = {}) => ({
  date: '2026-08-18',
  description: 'THE HOME DEPOT #0421',
  vendor: 'The Home Depot',
  amountCents: parseMoney('114.75'),
  category: 'materials' as const,
  paymentMethod: 'card' as const,
  status: 'unassigned' as const,
  taxDeductible: true,
  externalId: 'external-1',
  ...overrides,
});

describeDb('import batches', () => {
  let ownerId: string;

  beforeEach(async () => {
    ownerId = await createOwner(getDb());
  });

  it('records what a file brought in, alongside what it could not read', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'capital-one-august.csv',
      rowCount: 12,
      insertedCount: 10,
      skippedCount: 2,
    });

    const [row] = await getDb()
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, batch.id));

    expect(row).toMatchObject({
      ownerId,
      source: 'csv',
      filename: 'capital-one-august.csv',
      rowCount: 12,
      insertedCount: 10,
      skippedCount: 2,
    });
  });

  it('accepts a paste with no filename behind it', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: null,
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });

    expect(batch.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ties every row it inserted back to the batch that brought it', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'august.csv',
      rowCount: 2,
      insertedCount: 2,
      skippedCount: 0,
    });

    const created = await transactionsRepo.bulkCreateImported(getDb(), ownerId, [
      csvRow({ externalId: 'a' }),
      csvRow({ externalId: 'b', description: "LOWE'S #1104" }),
    ], { source: 'csv', provider: 'csv', importBatchId: batch.id });

    expect(created).toHaveLength(2);
    const rows = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.importBatchId, batch.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source)).toEqual(['csv', 'csv']);
    expect(rows.map((row) => row.provider)).toEqual(['csv', 'csv']);
    expect(rows.map((row) => row.externalId).sort()).toEqual(['a', 'b']);
  });

  it('records a charge the bank has not settled as still pending', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: null,
      rowCount: 2,
      insertedCount: 2,
      skippedCount: 0,
    });

    await transactionsRepo.bulkCreateImported(getDb(), ownerId, [
      csvRow({ externalId: 'settled' }),
      csvRow({ externalId: 'authorizing', pending: true }),
    ], { source: 'csv', provider: 'csv', importBatchId: batch.id });

    const rows = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.ownerId, ownerId));
    expect(rows.map((row) => [row.externalId, row.pending]).sort()).toEqual([
      ['authorizing', true],
      ['settled', false],
    ]);
  });

  it('leaves the bank account null, because a file is not a linked account', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: null,
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });

    await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow()], {
      source: 'csv',
      provider: 'csv',
      importBatchId: batch.id,
    });

    const [row] = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.ownerId, ownerId));
    expect(row.bankAccountId).toBeNull();
  });

  it('skips a row that repeats an earlier import, rather than landing it twice (spec §7)', async () => {
    // `transactions_owner_csv_external_key` closes the gap the old
    // `(provider, bank_account_id, external_id)` index left open: a CSV
    // row's bank_account_id is always null, and Postgres treats null as
    // distinct from null, so re-importing the same statement used to
    // duplicate every row.
    for (const filename of ['first.csv', 'second.csv']) {
      const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
        source: 'csv',
        filename,
        rowCount: 1,
        insertedCount: 1,
        skippedCount: 0,
      });
      await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow()], {
        source: 'csv',
        provider: 'csv',
        importBatchId: batch.id,
      });
    }

    const rows = await getDb()
      .select()
      .from(transactions)
      .where(and(eq(transactions.ownerId, ownerId), eq(transactions.externalId, 'external-1')));
    expect(rows).toHaveLength(1);
  });

  it('lets a different owner import the identical file, because the index is owner-scoped', async () => {
    const otherOwnerId = await createOwner(getDb());
    const batch1 = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'first.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    const batch2 = await importBatchesRepo.createImportBatch(getDb(), otherOwnerId, {
      source: 'csv',
      filename: 'first.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });

    await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow()], {
      source: 'csv',
      provider: 'csv',
      importBatchId: batch1.id,
    });
    const forOther = await transactionsRepo.bulkCreateImported(
      getDb(),
      otherOwnerId,
      [csvRow()],
      { source: 'csv', provider: 'csv', importBatchId: batch2.id }
    );

    expect(forOther).toHaveLength(1);
    const rows = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, 'external-1'));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ownerId).sort()).toEqual([ownerId, otherOwnerId].sort());
  });

  it('leaves a synced Plaid row untouched by the CSV index, even sharing an owner and external id', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'first.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow()], {
      source: 'csv',
      provider: 'csv',
      importBatchId: batch.id,
    });

    // A synced row is scoped by `(provider, bank_account_id, external_id)`,
    // never by the CSV index - the CSV index's predicate is `provider =
    // 'csv'`, so a `plaid` row with the same owner and external id is simply
    // not covered by it and both coexist.
    const synced = await transactionsRepo.upsertFromBank(getDb(), ownerId, [
      {
        date: '2026-08-18',
        description: 'THE HOME DEPOT #0421',
        vendor: 'The Home Depot',
        amountCents: parseMoney('114.75'),
        category: 'materials',
        paymentMethod: 'card',
        status: 'unassigned',
        taxDeductible: true,
        provider: 'plaid',
        bankAccountId: await createBankAccount(getDb(), ownerId),
        externalId: 'external-1',
      },
    ]);

    expect(synced).toHaveLength(1);
    const rows = await getDb()
      .select()
      .from(transactions)
      .where(and(eq(transactions.ownerId, ownerId), eq(transactions.externalId, 'external-1')));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.provider).sort()).toEqual(['csv', 'plaid']);
  });

  it('leaves bulkCreateImported itself inert for a non-csv provenance, even sharing an owner and external id', async () => {
    // The coexistence test above proves the *index* is provider-scoped by
    // going through upsertFromBank, a different write path. This exercises
    // the claim the report disclosed as unpinned: bulkCreateImported's own
    // ON CONFLICT arbiter is inert once provenance.provider isn't 'csv',
    // because a row with a different provider is outside the partial
    // index's predicate and can never be its conflict target.
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'first.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow()], {
      source: 'csv',
      provider: 'csv',
      importBatchId: batch.id,
    });

    const otherBatch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'plaid',
      filename: null,
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    const landed = await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow()], {
      source: 'plaid',
      provider: 'plaid',
      importBatchId: otherBatch.id,
    });

    expect(landed).toHaveLength(1);
    const rows = await getDb()
      .select()
      .from(transactions)
      .where(and(eq(transactions.ownerId, ownerId), eq(transactions.externalId, 'external-1')));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.provider).sort()).toEqual(['csv', 'plaid']);
  });

  it('imports the rows that are new and skips only the ones that repeat', async () => {
    const first = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'first.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    await transactionsRepo.bulkCreateImported(getDb(), ownerId, [csvRow({ externalId: 'a' })], {
      source: 'csv',
      provider: 'csv',
      importBatchId: first.id,
    });

    const second = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: 'second.csv',
      rowCount: 3,
      insertedCount: 3,
      skippedCount: 0,
    });
    const inserted = await transactionsRepo.bulkCreateImported(
      getDb(),
      ownerId,
      [
        csvRow({ externalId: 'a' }), // repeats the first import
        csvRow({ externalId: 'b' }),
        csvRow({ externalId: 'c' }),
      ],
      { source: 'csv', provider: 'csv', importBatchId: second.id }
    );

    expect(inserted.map((row) => row.externalId).sort()).toEqual(['b', 'c']);
    const rows = await getDb().select().from(transactions).where(eq(transactions.ownerId, ownerId));
    expect(rows).toHaveLength(3);
  });

  it('imports nothing for an empty batch rather than sending an empty insert', async () => {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: null,
      rowCount: 0,
      insertedCount: 0,
      skippedCount: 0,
    });

    await expect(
      transactionsRepo.bulkCreateImported(getDb(), ownerId, [], {
        source: 'csv',
        provider: 'csv',
        importBatchId: batch.id,
      })
    ).resolves.toEqual([]);
  });

  describe('importing a whole file at once', () => {
    const batch = {
      source: 'csv' as const,
      filename: 'august.csv',
      rowCount: 2,
      insertedCount: 2,
      skippedCount: 0,
    };

    it('writes the batch and its rows together', async () => {
      const result = await importsRepo.importCsvBatch(getDb(), ownerId, {
        batch,
        rows: [csvRow({ externalId: 'a' }), csvRow({ externalId: 'b' })],
        provider: 'csv',
      });

      expect(result.batch.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.inserted).toHaveLength(2);

      const rows = await getDb()
        .select()
        .from(transactions)
        .where(eq(transactions.importBatchId, result.batch.id));
      expect(rows).toHaveLength(2);
    });

    it('re-importing the identical file reports every row skipped, and lands none of them again', async () => {
      const rows = [csvRow({ externalId: 'a' }), csvRow({ externalId: 'b' })];
      await importsRepo.importCsvBatch(getDb(), ownerId, { batch, rows, provider: 'csv' });

      const second = await importsRepo.importCsvBatch(getDb(), ownerId, {
        batch: { ...batch, filename: 'august-again.csv' },
        rows,
        provider: 'csv',
      });

      expect(second.inserted).toEqual([]);
      expect(second.batch).toMatchObject({ insertedCount: 0, skippedCount: 2 });
      const all = await getDb()
        .select()
        .from(transactions)
        .where(eq(transactions.ownerId, ownerId));
      expect(all).toHaveLength(2);
    });

    it('reports the exact split when only some rows repeat an earlier import', async () => {
      await importsRepo.importCsvBatch(getDb(), ownerId, {
        batch,
        rows: [csvRow({ externalId: 'a' }), csvRow({ externalId: 'b' })],
        provider: 'csv',
      });

      const result = await importsRepo.importCsvBatch(getDb(), ownerId, {
        batch: { ...batch, filename: 'september.csv', rowCount: 3, insertedCount: 3, skippedCount: 0 },
        rows: [
          csvRow({ externalId: 'a' }), // repeats
          csvRow({ externalId: 'c' }),
          csvRow({ externalId: 'd' }),
        ],
        provider: 'csv',
      });

      expect(result.inserted.map((row) => row.externalId).sort()).toEqual(['c', 'd']);
      expect(result.batch).toMatchObject({ insertedCount: 2, skippedCount: 1 });
    });

    it('leaves no batch behind when the rows cannot be inserted', async () => {
      // The failure this exists for: the batch row is written first, so a
      // rejected insert used to leave an import in the ledger that had brought
      // nothing in - and, once undo exists, one that would undo nothing.
      await expect(
        importsRepo.importCsvBatch(getDb(), ownerId, {
          batch,
          rows: [
            csvRow({ externalId: 'a' }),
            csvRow({
              externalId: 'b',
              projectId: '11111111-1111-4111-8111-111111111111',
            }),
          ],
          provider: 'csv',
        })
      ).rejects.toThrow(UnknownProjectError);

      expect(await getDb().select().from(importBatches)).toEqual([]);
      expect(await getDb().select().from(transactions)).toEqual([]);
    });

    it('still records a batch that brought nothing in, so the upload is visible', async () => {
      // A file whose every row was unreadable is not a failure: the user needs
      // to see that the upload happened and skipped everything.
      const result = await importsRepo.importCsvBatch(getDb(), ownerId, {
        batch: { ...batch, rowCount: 2, insertedCount: 0, skippedCount: 2 },
        rows: [],
        provider: 'csv',
      });

      expect(result.inserted).toEqual([]);
      expect(await getDb().select().from(importBatches)).toHaveLength(1);
    });
  });

  it('stamps the batch with the owner who uploaded it, and nobody else', async () => {
    const otherId = await createOwner(getDb());

    const batch = await importBatchesRepo.createImportBatch(getDb(), otherId, {
      source: 'csv',
      filename: 'theirs.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });

    const mine = await getDb()
      .select()
      .from(importBatches)
      .where(eq(importBatches.ownerId, ownerId));
    expect(mine).toEqual([]);
    expect(batch.ownerId).toBe(otherId);
  });
});
