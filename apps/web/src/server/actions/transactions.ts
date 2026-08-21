'use server';

import type { ExpenseTransaction } from '@budget-bot/core';
import { getDb, transactionsRepo, UnknownProjectError } from '@budget-bot/db';
import { currentOwnerId } from '@/lib/ownerSession';
import {
  AssignTransactionForm,
  CreateTransactionForm,
  TransactionIdForm,
  UpdateTransactionCategoryForm,
} from './inputs';
import { revalidateApp } from './revalidate';
import { failed, invalid, ok, unauthorized, type ActionResult } from './result';

/**
 * Writing expenses.
 *
 * `UnknownProjectError` is the database refusing to attach a row to a project
 * that is not this owner's. From the caller's side that is indistinguishable
 * from a project that does not exist, and either way it is their mistake, so
 * it comes back as a failed result rather than as a thrown error.
 *
 * The two actions that correct a synced row stamp `userEditedAt`. That column
 * is what the sync merge rule reads (ADR 0004), and it can only be set here:
 * a repository sees a write, not who asked for it, and a bank feed writes
 * through the same repository. Every write below that a person initiated
 * carries the stamp, so "the user has touched this row" is a fact recorded at
 * the moment it becomes true rather than inferred afterwards.
 */

/** Stamped on every correction a person makes, for the merge rule to read. */
const editedNow = () => new Date().toISOString();

export async function createTransactionAction(
  input: unknown
): Promise<ActionResult<ExpenseTransaction>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = CreateTransactionForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const transaction = await transactionsRepo.createTransaction(
      getDb(),
      ownerId,
      parsed.data
    );
    revalidateApp();
    return ok(transaction);
  } catch (error) {
    if (error instanceof UnknownProjectError) return failed(error.message);
    throw error;
  }
}

/** Files a charge against a job, or - with an empty id - back into the inbox. */
export async function assignTransactionAction(
  input: unknown
): Promise<ActionResult<ExpenseTransaction>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = AssignTransactionForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  // `null`, not `undefined`: an absent key means "leave the filing alone",
  // which would put the row in the inbox while it still pointed at a job.
  const projectId = parsed.data.projectId || null;
  try {
    const transaction = await transactionsRepo.updateTransaction(
      getDb(),
      ownerId,
      parsed.data.id,
      { projectId, status: projectId ? 'matched' : 'unassigned', userEditedAt: editedNow() }
    );
    if (!transaction) return failed('No such charge.');
    revalidateApp();
    return ok(transaction);
  } catch (error) {
    if (error instanceof UnknownProjectError) return failed(error.message);
    throw error;
  }
}

export async function updateTransactionCategoryAction(
  input: unknown
): Promise<ActionResult<ExpenseTransaction>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = UpdateTransactionCategoryForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const transaction = await transactionsRepo.updateTransaction(
    getDb(),
    ownerId,
    parsed.data.id,
    { category: parsed.data.category, userEditedAt: editedNow() }
  );
  if (!transaction) return failed('No such charge.');

  revalidateApp();
  return ok(transaction);
}

export async function deleteTransactionAction(input: unknown): Promise<ActionResult<null>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = TransactionIdForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const deleted = await transactionsRepo.deleteTransaction(getDb(), ownerId, parsed.data.id);
  if (!deleted) return failed('No such charge.');

  revalidateApp();
  return ok(null);
}
