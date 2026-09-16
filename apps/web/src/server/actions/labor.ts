'use server';

import type { LaborEntry } from '@budget-bot/core';
import { getDb, laborRepo, UnknownProjectError } from '@budget-bot/db';
import { currentOwner, currentOwnerId } from '@/lib/ownerSession';
import { CreateLaborEntryForm, LaborEntryIdForm } from './inputs';
import { revalidateApp } from './revalidate';
import { failed, invalid, ok, unauthorized, type ActionResult } from './result';

/** Logging hours against a job. */

export async function createLaborEntryAction(
  input: unknown
): Promise<ActionResult<LaborEntry>> {
  const owner = await currentOwner();
  if (!owner) return unauthorized();

  const parsed = CreateLaborEntryForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  // A one-person business logs its own hours, so a blank worker is the owner,
  // by the name the sign-in provider gave. That name lives in the session, not
  // in the form schema, which is why the default is applied here and not in
  // `inputs.ts`; a profile with no name at all leaves the field blank rather
  // than putting a made-up one in the ledger.
  const entryInput = {
    ...parsed.data,
    workerName: parsed.data.workerName || owner.name || '',
  };

  try {
    const entry = await laborRepo.createLaborEntry(getDb(), owner.id, entryInput);
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
