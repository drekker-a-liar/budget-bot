import { parseMoney } from '@budget-bot/core';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { importsRepo, importBatchesRepo, transactionsRepo } from '../../src/repos';
import { UnknownProjectError } from '../../src/repos/errors';
import { importBatches, transactions } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';

/**
 * An import is one event with rows hanging off it, so that a user who
 * uploaded the wrong statement can see what it brought in and take it back
 * out again in one move (spec §5).
 */

const getDb = useTestDb();

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

  it('lets the same file be imported twice, because nothing yet says otherwise', async () => {
    // The dedupe index is `(provider, bank_account_id, external_id)` and
    // Postgres treats null bank accounts as distinct, so two uploads of one
    // statement land twice. That is the documented state until bank accounts
    // exist (Phase 2); this test is here so the change is a visible one.
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
    expect(rows).toHaveLength(2);
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
