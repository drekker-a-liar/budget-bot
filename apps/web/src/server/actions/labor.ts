'use server';

import type { LaborEntry } from '@budget-bot/core';
import { getDb, laborRepo, UnknownProjectError } from '@budget-bot/db';
import { currentOwnerId } from '@/lib/ownerSession';
import { CreateLaborEntryForm, LaborEntryIdForm } from './inputs';
import { revalidateApp } from './revalidate';
import { failed, invalid, ok, unauthorized, type ActionResult } from './result';

/** Logging hours against a job. */

export async function createLaborEntryAction(
  input: unknown
): Promise<ActionResult<LaborEntry>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = CreateLaborEntryForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const entry = await laborRepo.createLaborEntry(getDb(), ownerId, parsed.data);
    revalidateApp();
    return ok(entry);
  } catch (error) {
    if (error instanceof UnknownProjectError) return failed(error.message);
    throw error;
  }
}

export async function deleteLaborEntryAction(input: unknown): Promise<ActionResult<null>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = LaborEntryIdForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const deleted = await laborRepo.deleteLaborEntry(getDb(), ownerId, parsed.data.id);
  if (!deleted) return failed('No such labor entry.');

  revalidateApp();
  return ok(null);
}
