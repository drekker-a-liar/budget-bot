import { NextResponse } from 'next/server';
import {
  bankRepo,
  getDb,
  importBatchesRepo,
  invoicesRepo,
  laborRepo,
  projectsRepo,
  transactionsRepo,
} from '@budget-bot/db';
import { currentOwnerId } from '@/lib/ownerSession';

/**
 * Exporting everything (spec §6).
 *
 * Auth-gated the way every route in this app is: `auth()` is asked directly,
 * not trusted from the middleware, which only ever gets to decide whether a
 * cookie exists at all (ADR 0003). The only route under `app/api` besides
 * Auth.js's own that reads rather than writes - the rest of this app reads in
 * Server Components - because what this reads is a download, not a page.
 *
 * One JSON document, assembled from every domain table plus what a
 * connection is safe to describe. `bankRepo.listConnectionsForExport` is a
 * narrower projection than the one the connections screen itself reads: no
 * ciphertext, no cursor, no item id, no encryption key id, and no id at all -
 * an export describes what is connected, not a handle back into this
 * database. `externalId` and `bankAccountId` are stripped from every
 * transaction for the same reason: `externalId` is Plaid's id for that row,
 * not this application's, and `bankAccountId` is a raw `bank_accounts.id`
 * that nothing else in the file could ever correlate to - accounts carry no
 * id in the export at all. Contrast `projectId`, which stays: it matches a
 * `projects[].id` in the same document, so it is information the file
 * actually holds together rather than a handle back into this database.
 *
 * Money stays a whole number of cents everywhere in this application (ADR
 * 0007); `units` says so once at the top rather than leaving a reader of the
 * file to assume it.
 */
export async function GET(): Promise<NextResponse> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  const [projects, transactions, laborEntries, invoices, importBatches, connections] =
    await Promise.all([
      projectsRepo.listProjects(db, ownerId),
      transactionsRepo.listTransactions(db, ownerId),
      laborRepo.listLaborEntries(db, ownerId),
      invoicesRepo.listInvoices(db, ownerId),
      importBatchesRepo.listImportBatches(db, ownerId),
      bankRepo.listConnectionsForExport(db, ownerId),
    ]);

  const exportedAt = new Date();
  const filename = `budget-bot-export-${exportedAt.toISOString().slice(0, 10)}.json`;

  return NextResponse.json(
    {
      exportedAt: exportedAt.toISOString(),
      units: 'cents',
      projects,
      // `externalId` is Plaid's own id for the row, never this app's, and
      // `bankAccountId` is a database handle with nothing in the file to
      // correlate it to - both kept out the same way the connection's item
      // id is.
      transactions: transactions.map(
        ({ externalId: _externalId, bankAccountId: _bankAccountId, ...rest }) => rest
      ),
      laborEntries,
      invoices,
      importBatches,
      connections,
    },
    { headers: { 'Content-Disposition': `attachment; filename="${filename}"` } }
  );
}
