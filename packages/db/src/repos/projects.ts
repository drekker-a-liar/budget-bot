import type { Project } from '@budget-bot/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { projects } from '../schema';
import { isUuid, orUndefined, toIso } from './rows';

/**
 * Projects. Every function takes the owner and filters on it: owner scoping is
 * a property of the query, not of the caller remembering to add a `where`.
 */

type ProjectRow = typeof projects.$inferSelect;

export type NewProject = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
export type ProjectUpdate = Partial<NewProject>;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    clientAddress: row.clientAddress,
    description: row.description,
    status: row.status,
    pricingType: row.pricingType,
    quotedTotalCents: row.quotedTotalCents as Project['quotedTotalCents'],
    quotedMaterialsCents: row.quotedMaterialsCents as Project['quotedMaterialsCents'],
    quotedLaborHours: row.quotedLaborHours,
    targetHourlyRateCents: row.targetHourlyRateCents as Project['targetHourlyRateCents'],
    targetMarginPct: row.targetMarginPct,
    startDate: row.startDate,
    deadlineDate: orUndefined(row.deadlineDate),
    completedDate: orUndefined(row.completedDate),
    notes: orUndefined(row.notes),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Only the columns a project actually has. An update body arrives from a
 * request, so it is copied field by field rather than spread: an unknown key
 * must not become a column, and a key the caller left out must not become a
 * null.
 */
function toUpdate(input: ProjectUpdate) {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.clientName !== undefined && { clientName: input.clientName }),
    ...(input.clientPhone !== undefined && { clientPhone: input.clientPhone }),
    ...(input.clientAddress !== undefined && { clientAddress: input.clientAddress }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.pricingType !== undefined && { pricingType: input.pricingType }),
    ...(input.quotedTotalCents !== undefined && { quotedTotalCents: input.quotedTotalCents }),
    ...(input.quotedMaterialsCents !== undefined && {
      quotedMaterialsCents: input.quotedMaterialsCents,
    }),
    ...(input.quotedLaborHours !== undefined && { quotedLaborHours: input.quotedLaborHours }),
    ...(input.targetHourlyRateCents !== undefined && {
      targetHourlyRateCents: input.targetHourlyRateCents,
    }),
    ...(input.targetMarginPct !== undefined && { targetMarginPct: input.targetMarginPct }),
    ...(input.startDate !== undefined && { startDate: input.startDate }),
    ...(input.deadlineDate !== undefined && { deadlineDate: input.deadlineDate ?? null }),
    ...(input.completedDate !== undefined && { completedDate: input.completedDate ?? null }),
    ...(input.notes !== undefined && { notes: input.notes ?? null }),
  };
}

export async function listProjects(db: Database, ownerId: string): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.createdAt), desc(projects.id));
  return rows.map(toProject);
}

export async function getProject(
  db: Database,
  ownerId: string,
  id: string
): Promise<Project | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.ownerId, ownerId), eq(projects.id, id)))
    .limit(1);
  return row && toProject(row);
}

export async function createProject(
  db: Database,
  ownerId: string,
  input: NewProject
): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({
      ownerId,
      name: input.name,
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      clientAddress: input.clientAddress,
      description: input.description,
      status: input.status,
      pricingType: input.pricingType,
      quotedTotalCents: input.quotedTotalCents,
      quotedMaterialsCents: input.quotedMaterialsCents,
      quotedLaborHours: input.quotedLaborHours,
      targetHourlyRateCents: input.targetHourlyRateCents,
      targetMarginPct: input.targetMarginPct,
      startDate: input.startDate,
      deadlineDate: input.deadlineDate ?? null,
      completedDate: input.completedDate ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return toProject(row);
}

export async function updateProject(
  db: Database,
  ownerId: string,
  id: string,
  updates: ProjectUpdate
): Promise<Project | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(projects)
    .set({ ...toUpdate(updates), updatedAt: new Date() })
    .where(and(eq(projects.ownerId, ownerId), eq(projects.id, id)))
    .returning();
  return row ? toProject(row) : null;
}

export async function deleteProject(
  db: Database,
  ownerId: string,
  id: string
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.ownerId, ownerId), eq(projects.id, id)))
    .returning({ id: projects.id });
  return deleted.length > 0;
}

/** Every project the owner has, gone at once (spec §6, delete-all). */
export async function deleteAllProjects(db: Database, ownerId: string): Promise<number> {
  const deleted = await db
    .delete(projects)
    .where(eq(projects.ownerId, ownerId))
    .returning({ id: projects.id });
  return deleted.length;
}
