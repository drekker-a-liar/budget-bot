import type { ExpenseTransaction } from '@budget-bot/core';
import type { Database } from '../client';
import { createImportBatch, type ImportBatch, type NewImportBatch } from './importBatches';
import { bulkCreateImported, type ImportedTransaction } from './transactions';

/**
 * One import, as one write.
 *
 * The batch row and the rows it brought in are the same fact, and the batch
 * has to be written first so the transactions can point at it. Run as two
 * statements, a rejected insert leaves an import in the ledger that brought
 * nothing in - and, once undo exists, one that would undo nothing. So this is
 * the only way the application writes an import: a transaction that owns both
 * halves, leaving the route with nothing to sequence and nothing to get wrong.
 */

export interface ImportCsvBatch {
  batch: NewImportBatch;
  rows: ImportedTransaction[];
  /** The provider these rows came from, e.g. `'csv'`. */
  provider: string;
}

export interface ImportResult {
  batch: ImportBatch;
  inserted: ExpenseTransaction[];
}

export async function importCsvBatch(
  db: Database,
  ownerId: string,
  input: ImportCsvBatch
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    const batch = await createImportBatch(tx, ownerId, input.batch);
    const inserted = await bulkCreateImported(tx, ownerId, input.rows, {
      source: input.batch.source === 'plaid' ? 'plaid' : 'csv',
      provider: input.provider,
      importBatchId: batch.id,
    });
    return { batch, inserted };
  });
}
