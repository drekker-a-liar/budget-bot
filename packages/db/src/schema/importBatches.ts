import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ownerId, updatedAt } from './columns';
import { transactionSource } from './enums';

/**
 * One row per import run, so the user can see what a file brought in and undo
 * it in one move (spec §5). Created now and left empty; the CSV rewrite in a
 * later sub-project is the first writer.
 */
export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: ownerId(),
  source: transactionSource('source').notNull(),
  filename: text('filename'),
  rowCount: integer('row_count').notNull().default(0),
  insertedCount: integer('inserted_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
