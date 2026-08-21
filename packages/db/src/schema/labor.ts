import { date, foreignKey, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { cents, createdAt, ownerId, updatedAt } from './columns';
import { projects } from './projects';

/** Hours worked on a project. Hours are numeric(8,2); the rate is cents. */
export const laborEntries = pgTable(
  'labor_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerId(),
    projectId: uuid('project_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    hours: numeric('hours', { precision: 8, scale: 2, mode: 'number' }).notNull(),
    hourlyRateCents: cents('hourly_rate_cents').notNull(),
    workerName: text('worker_name').notNull().default(''),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** Composite, so the project must belong to the same owner. */
    foreignKey({
      name: 'labor_entries_project_id_owner_id_fk',
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete('cascade'),
    index('labor_entries_owner_project_idx').on(table.ownerId, table.projectId),
    index('labor_entries_owner_date_idx').on(table.ownerId, table.date),
  ]
);
