import type { Database } from '../client';
import { importBatches } from '../schema';

/**
 * One row per import run (spec §5).
 *
 * The batch is written before the rows so that every transaction it brings in
 * can point back at it. That reference is what makes an import undoable: the
 * user who uploaded last month's statement by mistake can name the upload
 * rather than pick fifty rows out of the ledger by hand.
 */

export type ImportSource = 'manual' | 'csv' | 'plaid';

export interface NewImportBatch {
  source: ImportSource;
  /** Null for a paste, or for anything that did not arrive as a file. */
  filename: string | null;
  /** Rows the file contained, whether or not they could be read. */
  rowCount: number;
  insertedCount: number;
  skippedCount: number;
}

export interface ImportBatch extends NewImportBatch {
  id: string;
  ownerId: string;
  createdAt: string;
}

export async function createImportBatch(
  db: Database,
  ownerId: string,
  input: NewImportBatch
): Promise<ImportBatch> {
  const [row] = await db
    .insert(importBatches)
    .values({
      ownerId,
      source: input.source,
      filename: input.filename,
      rowCount: input.rowCount,
      insertedCount: input.insertedCount,
      skippedCount: input.skippedCount,
    })
    .returning();

  return {
    id: row.id,
    ownerId: row.ownerId,
    source: row.source,
    filename: row.filename,
    rowCount: row.rowCount,
    insertedCount: row.insertedCount,
    skippedCount: row.skippedCount,
    createdAt: row.createdAt.toISOString(),
  };
}
