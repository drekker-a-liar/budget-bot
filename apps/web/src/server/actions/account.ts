'use server';

import {
  bankRepo,
  getDb,
  importBatchesRepo,
  invoicesRepo,
  laborRepo,
  projectsRepo,
  transactionsRepo,
} from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { currentOwnerId } from '@/lib/ownerSession';
import { getBankProvider } from '@/src/server/bank/provider';
import { revalidateApp } from './revalidate';
import { ok, unauthorized, type ActionResult } from './result';

/**
 * Deleting everything (spec §6).
 *
 * The one action in this file, and the only one with no form behind it - the
 * confirmation is `ConfirmGate`'s job, on the client, and by the time this
 * runs there is nothing left to validate. What is left is order: every
 * connection gets a best-effort `removeItem` first, the same swallow
 * `disconnectConnectionAction` uses (a Plaid outage must not be the reason an
 * owner cannot delete their own account), and only then do the deletes run -
 * bank connections first, so their accounts cascade away before anything
 * downstream of them is touched, then every other domain table. Auth.js's own
 * `users` and `sessions` rows are untouched: the account survives; its data
 * does not.
 */

export interface DeletedCounts {
  connections: number;
  transactions: number;
  laborEntries: number;
  invoices: number;
  importBatches: number;
  projects: number;
}

export async function deleteAllDataAction(): Promise<ActionResult<DeletedCounts>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const db = getDb();
  const provider = getBankProvider();

  if (provider) {
    const keyring = loadKeysFromEnv();
    const connections = await bankRepo.listConnections(db, ownerId);
    for (const connection of connections) {
      try {
        await bankRepo.withAccessToken(db, ownerId, connection.id, keyring, (accessToken) =>
          provider.removeItem(accessToken)
        );
      } catch {
        // Best-effort, same as disconnectConnectionAction: whether Plaid's
        // own record of the item is gone is worth knowing but never worth
        // blocking on. The row is deleted below regardless.
      }
    }
  }

  const counts: DeletedCounts = {
    connections: await bankRepo.deleteAllConnections(db, ownerId),
    transactions: await transactionsRepo.deleteAllTransactions(db, ownerId),
    laborEntries: await laborRepo.deleteAllLaborEntries(db, ownerId),
    invoices: await invoicesRepo.deleteAllInvoices(db, ownerId),
    importBatches: await importBatchesRepo.deleteAllImportBatches(db, ownerId),
    projects: await projectsRepo.deleteAllProjects(db, ownerId),
  };

  revalidateApp();
  return ok(counts);
}
