import type { LaborEntry, MonthlyMarginRange } from '@budget-bot/core';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Database, Executor } from '../client';
import { laborEntries } from '../schema';
import { rejectingForeignProject } from './errors';
import { isUuid, orUndefined, toIso } from './rows';

type LaborRow = typeof laborEntries.$inferSelect;

export type NewLaborEntry = Omit<LaborEntry, 'id' | 'createdAt' | 'updatedAt'>;

function toLaborEntry(row: LaborRow): LaborEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    date: row.date,
    hours: row.hours,
    hourlyRateCents: row.hourlyRateCents as LaborEntry['hourlyRateCents'],
    workerName: row.workerName,
    notes: orUndefined(row.notes),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listLaborEntries(
  db: Database,
  ownerId: string,
  projectId?: string
): Promise<LaborEntry[]> {
  // A project id that is not a uuid cannot match any row, and comparing it
  // would be a type error in Postgres rather than an empty result.
  if (projectId !== undefined && !isUuid(projectId)) return [];
  const rows = await db
    .select()
    .from(laborEntries)
    .where(
      projectId === undefined
        ? eq(laborEntries.ownerId, ownerId)
        : and(eq(laborEntries.ownerId, ownerId), eq(laborEntries.projectId, projectId))
    )
    .orderBy(desc(laborEntries.createdAt), desc(laborEntries.id));
  return rows.map(toLaborEntry);
}

/**
 * Labor entries dated in `range` (inclusive) - the exact predicate
 * `calculateMonthlyMargins` (spec §2) applies to labor cost, pushed down to
 * `labor_entries_owner_date_idx` for the margin query (spec §3) rather than
 * fetched in full and filtered in the app.
 */
export async function listLaborEntriesInRange(
  db: Database,
  ownerId: string,
  range: MonthlyMarginRange
): Promise<LaborEntry[]> {
  const rows = await db
    .select()
    .from(laborEntries)
    .where(
      and(
        eq(laborEntries.ownerId, ownerId),
        gte(laborEntries.date, range.start),
        lte(laborEntries.date, range.end)
      )
    )
    .orderBy(desc(laborEntries.createdAt), desc(laborEntries.id));
  return rows.map(toLaborEntry);
}

export async function createLaborEntry(
  db: Database,
  ownerId: string,
  input: NewLaborEntry
): Promise<LaborEntry> {
  const [row] = await rejectingForeignProject(input.projectId, () =>
    db
    .insert(laborEntries)
    .values({
      ownerId,
      projectId: input.projectId,
      date: input.date,
      hours: input.hours,
      hourlyRateCents: input.hourlyRateCents,
      workerName: input.workerName,
      notes: input.notes ?? null,
    })
    .returning()
  );
  return toLaborEntry(row);
}

export async function deleteLaborEntry(
  db: Database,
  ownerId: string,
  id: string
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(laborEntries)
    .where(and(eq(laborEntries.ownerId, ownerId), eq(laborEntries.id, id)))
    .returning({ id: laborEntries.id });
  return deleted.length > 0;
}

/** Every labor entry the owner has, gone at once (spec §6, delete-all). */
export async function deleteAllLaborEntries(db: Executor, ownerId: string): Promise<number> {
  const deleted = await db
    .delete(laborEntries)
    .where(eq(laborEntries.ownerId, ownerId))
    .returning({ id: laborEntries.id });
  return deleted.length;
}
