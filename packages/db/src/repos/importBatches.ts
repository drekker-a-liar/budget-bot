import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../client';
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

type ImportBatchRow = typeof importBatches.$inferSelect;

function toImportBatch(row: ImportBatchRow): ImportBatch {
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

export async function createImportBatch(
  db: Executor,
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

  return toImportBatch(row);
}

/**
 * Corrects a batch's counts to what actually landed.
 *
 * `createImportBatch` is written before the rows, from a guess made off the
 * parsed file alone - it cannot yet know which rows the cross-batch dedupe
 * index (spec §7) will drop. `importCsvBatch` calls this in the same
 * transaction once the insert has run, so the persisted batch never claims
 * rows that were silently skipped as duplicates.
 */
export async function updateImportBatchCounts(
  db: Executor,
  id: string,
  counts: { insertedCount: number; skippedCount: number }
): Promise<ImportBatch> {
  const [row] = await db
    .update(importBatches)
    .set({
      insertedCount: counts.insertedCount,
      skippedCount: counts.skippedCount,
      updatedAt: new Date(),
    })
    .where(eq(importBatches.id, id))
    .returning();
  return toImportBatch(row);
}

/** Every import batch the owner has run, newest first - what an export reads (spec §6). */
export async function listImportBatches(db: Executor, ownerId: string): Promise<ImportBatch[]> {
  const rows = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.ownerId, ownerId))
    .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
  return rows.map(toImportBatch);
}

/** Every import batch the owner has, gone at once (spec §6, delete-all). */
export async function deleteAllImportBatches(db: Executor, ownerId: string): Promise<number> {
  const rows = await db
    .delete(importBatches)
    .where(eq(importBatches.ownerId, ownerId))
    .returning({ id: importBatches.id });
  return rows.length;
}
