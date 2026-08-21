'use server';

import type { Project } from '@budget-bot/core';
import { getDb, projectsRepo } from '@budget-bot/db';
import { currentOwnerId } from '@/lib/ownerSession';
import { CreateProjectForm, UpdateProjectStatusForm } from './inputs';
import { revalidateApp } from './revalidate';
import { failed, invalid, ok, unauthorized, type ActionResult } from './result';

/**
 * Writing projects.
 *
 * Every action here does the same four things in the same order: ask who is
 * signed in, validate what arrived, call the repository with that owner, and
 * invalidate the pages that drew from it. The owner comes from the session and
 * never from the caller - a client cannot name whose books it is writing to.
 */

export async function createProjectAction(input: unknown): Promise<ActionResult<Project>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = CreateProjectForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const project = await projectsRepo.createProject(getDb(), ownerId, parsed.data);
  revalidateApp();
  return ok(project);
}

export async function updateProjectStatusAction(
  input: unknown
): Promise<ActionResult<Project>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = UpdateProjectStatusForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const project = await projectsRepo.updateProject(getDb(), ownerId, parsed.data.id, {
    status: parsed.data.status,
  });
  // Null means no project of that id belongs to this owner. Whether it never
  // existed or belongs to someone else is not something to say out loud.
  if (!project) return failed('No such project.');

  revalidateApp();
  return ok(project);
}
