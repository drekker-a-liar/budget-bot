import type { LaborEntry } from '@budget-bot/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client';
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
