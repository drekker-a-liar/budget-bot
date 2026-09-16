'use server';

import {
  bankRepo,
  getDb,
  importBatchesRepo,
  invoicesRepo,
  laborRepo,
  projectsRepo,
  transactionsRepo,
  webhookEventsRepo,
} from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { currentOwnerId } from '@/lib/ownerSession';
import { getBankProvider } from '@/src/server/bank/provider';
import { revalidateApp } from './revalidate';
import { failed, ok, unauthorized, type ActionResult } from './result';

/**
 * Deleting everything (spec §6).
 *
 * The one action in this file, and the only one with no form behind it - the
 * confirmation is `ConfirmGate`'s job, on the client, and by the time this
 * runs there is nothing left to validate. What is left is order: every
 * connection gets a best-effort `removeItem` first, the same swallow
 * `disconnectConnectionAction` uses (a Plaid outage must not be the reason an
 * owner cannot delete their own account), and only then do the deletes run,
 * in one transaction - bank connections first, so their accounts cascade
 * away before anything downstream of them is touched, then every other
 * domain table. The owner's `webhook_events` rows go too (spec §6: "delete
 * the owner's rows in every domain table") - rows with no owner (a
 * redelivery for an item this deployment never recognised) or another
 * owner's rows are untouched, the same scoping `deleteOwnerWebhookEvents`
 * documents. Auth.js's own `users` and `sessions` rows are untouched: the
 * account survives; its data does not.
 */

export interface DeletedCounts {
  connections: number;
  transactions: number;
  laborEntries: number;
  invoices: number;
  importBatches: number;
  projects: number;
  webhookEvents: number;
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

  // One transaction for the seven deletes (Phase 5 audit). They used to run
  // one after another on the connection, and a failure in the fourth left an
  // owner with no connections, no transactions and no labor but every invoice
  // and project still there - a half-emptied account that looked, from the
  // dashboard, like a bug in the totals rather than an interrupted delete.
  // Now a failure anywhere rolls every table back, the refusal says so, and
  // the owner presses the button again.
  //
  // The `removeItem` loop above stays outside it on purpose: it talks to
  // Plaid, and a transaction held open across a network call to a third
  // party is a lock held for as long as Plaid takes to answer.
  let counts: DeletedCounts;
  try {
    counts = await db.transaction(async (tx) => ({
      connections: await bankRepo.deleteAllConnections(tx, ownerId),
      transactions: await transactionsRepo.deleteAllTransactions(tx, ownerId),
      laborEntries: await laborRepo.deleteAllLaborEntries(tx, ownerId),
      invoices: await invoicesRepo.deleteAllInvoices(tx, ownerId),
      importBatches: await importBatchesRepo.deleteAllImportBatches(tx, ownerId),
      projects: await projectsRepo.deleteAllProjects(tx, ownerId),
      webhookEvents: await webhookEventsRepo.deleteOwnerWebhookEvents(tx, ownerId),
    }));
  } catch (error) {
    // A refusal rather than a rethrow: the one thing the owner needs to know
    // is that nothing went, which a rejected action call ("Something went
    // wrong connecting to the server") does not say. The message and stack,
    // never the object: a driver error carries the failing query and its
    // parameters.
    console.error(
      'Delete-all rolled back:',
      error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
    );
    return failed(
      'Nothing was deleted: the database refused partway through, and the whole delete was rolled back. Try again.'
    );
  }

  revalidateApp();
  return ok(counts);
}
