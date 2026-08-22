import { parseMoney } from '@budget-bot/core';
import {
  bankRepo,
  importBatchesRepo,
  invoicesRepo,
  laborRepo,
  projectsRepo,
  transactionsRepo,
  type Database,
} from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwner, describeDb, testDatabaseUrl, useTestDb } from './helpers/db';

/**
 * `deleteAllDataAction` (spec §6), against a real Postgres.
 *
 * The property under test is what a `DELETE` scoped to one owner actually
 * reaches, table by table, in a database with real foreign keys - the same
 * reason `webhooks-plaid-route.test.ts` gives for using one. `auth()` and the
 * bank provider are stubbed at the module boundary; every assertion below is
 * on the rows a real database still has, or no longer has, once the action
 * returns.
 */

const authSession = vi.hoisted(() => ({
  current: null as { user: { id: string }; expires: string } | null,
}));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => authSession.current) }));

// `revalidatePath` needs a request-scoped store that only exists inside a
// real Next.js render; calling the action directly, the way this file does,
// has none. Every other action test stubs it the same way.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const removeItem = vi.hoisted(() => ({ fn: vi.fn(async (_accessToken: string) => undefined) }));
const providerRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/src/server/bank/provider', () => ({
  getBankProvider: () => providerRef.current,
  getBankProviderKind: () => (providerRef.current ? 'plaid' : null),
}));

const { deleteAllDataAction } = await import('@/src/server/actions/account');

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const KEY_B64 = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');
const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: KEY_B64 });

function signInAs(ownerId: string): void {
  authSession.current = { user: { id: ownerId }, expires: '2026-09-01' };
}

async function seedOneOfEverything(db: Database, ownerId: string, tag: string) {
  const project = await projectsRepo.createProject(db, ownerId, {
    name: `${tag} Deck`,
    clientName: `${tag} Client`,
    clientPhone: '',
    clientAddress: '',
    description: '',
    status: 'in_progress',
    pricingType: 'fixed',
    quotedTotalCents: parseMoney('4500.00'),
    quotedMaterialsCents: parseMoney('1750.00'),
    quotedLaborHours: 32,
    targetHourlyRateCents: parseMoney('85.00'),
    targetMarginPct: 45,
    startDate: '2026-08-02',
  });

  await transactionsRepo.createTransaction(db, ownerId, {
    date: '2026-08-14',
    description: `${tag} vendor purchase`,
    vendor: `${tag} Home Depot`,
    amountCents: parseMoney('114.75'),
    category: 'materials',
    paymentMethod: 'card',
    status: 'unassigned',
    taxDeductible: true,
  });

  await laborRepo.createLaborEntry(db, ownerId, {
    projectId: project.id,
    date: '2026-08-05',
    hours: 4,
    hourlyRateCents: parseMoney('85.00'),
    workerName: tag,
  });

  await invoicesRepo.createInvoice(db, ownerId, {
    projectId: project.id,
    invoiceNumber: `INV-${tag}-1`,
    amountCents: parseMoney('1950.00'),
    depositAmountCents: parseMoney('0'),
    dateIssued: '2026-08-01',
    dueDate: '2026-08-15',
    status: 'sent',
  });

  await importBatchesRepo.createImportBatch(db, ownerId, {
    source: 'csv',
    filename: `${tag}.csv`,
    rowCount: 1,
    insertedCount: 1,
    skippedCount: 0,
  });

  const connection = await bankRepo.createConnection(
    db,
    ownerId,
    { itemId: `item-${tag}`, accessToken: `access-${tag}`, institutionName: `${tag} Bank` },
    keyring
  );
  await bankRepo.upsertAccounts(db, ownerId, connection.id, [
    {
      externalId: `acct-${tag}`,
      name: `${tag} Checking`,
      officialName: null,
      mask: '0000',
      type: 'depository',
      subtype: 'checking',
      currentBalanceCents: 0,
      availableBalanceCents: 0,
      creditLimitCents: null,
      isoCurrencyCode: 'USD',
    },
  ]);
}

async function tableCounts(db: Database, ownerId: string) {
  return {
    connections: (await bankRepo.listConnections(db, ownerId)).length,
    transactions: (await transactionsRepo.listTransactions(db, ownerId)).length,
    laborEntries: (await laborRepo.listLaborEntries(db, ownerId)).length,
    invoices: (await invoicesRepo.listInvoices(db, ownerId)).length,
    importBatches: (await importBatchesRepo.listImportBatches(db, ownerId)).length,
    projects: (await projectsRepo.listProjects(db, ownerId)).length,
  };
}

describeDb('deleteAllDataAction', () => {
  const getDb = useTestDb();
  let db: Database;

  beforeEach(() => {
    vi.stubEnv('BANK_TOKEN_ENCRYPTION_KEY', KEY_B64);
    vi.stubEnv('DATABASE_URL', testDatabaseUrl as string);
    removeItem.fn.mockClear();
    removeItem.fn.mockResolvedValue(undefined);
    providerRef.current = { id: 'plaid', removeItem: removeItem.fn };
    authSession.current = null;
    db = getDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses with no session, and touches nothing', async () => {
    const result = await deleteAllDataAction();

    expect(result).toEqual({ ok: false, error: 'Unauthorized' });
    expect(removeItem.fn).not.toHaveBeenCalled();
  });

  it('deletes only the signed-in owner’s rows, table by table, leaving another owner’s intact', async () => {
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    await seedOneOfEverything(db, alice, 'Alice');
    await seedOneOfEverything(db, bob, 'BobOnlyVendorTag');

    signInAs(alice);
    const result = await deleteAllDataAction();

    expect(result).toEqual({
      ok: true,
      data: {
        connections: 1,
        transactions: 1,
        laborEntries: 1,
        invoices: 1,
        importBatches: 1,
        projects: 1,
      },
    });
    expect(removeItem.fn).toHaveBeenCalledTimes(1);

    expect(await tableCounts(db, alice)).toEqual({
      connections: 0,
      transactions: 0,
      laborEntries: 0,
      invoices: 0,
      importBatches: 0,
      projects: 0,
    });
    expect(await tableCounts(db, bob)).toEqual({
      connections: 1,
      transactions: 1,
      laborEntries: 1,
      invoices: 1,
      importBatches: 1,
      projects: 1,
    });

    // The account survives; its data does not (spec §6). Raw SQL rather than
    // drizzle's query builder: `drizzle-orm` is not a dependency of this app
    // (see `test/helpers/db.ts`).
    const [aliceUser] = await db.$client`select id from users where id = ${alice}`;
    expect(aliceUser).toBeDefined();
  });

  it('still deletes everything when the bank refuses to remove the item', async () => {
    removeItem.fn.mockRejectedValue(new Error('Plaid is down'));
    const alice = await createOwner(db);
    await seedOneOfEverything(db, alice, 'Alice');

    signInAs(alice);
    const result = await deleteAllDataAction();

    expect(result.ok).toBe(true);
    expect(await tableCounts(db, alice)).toEqual({
      connections: 0,
      transactions: 0,
      laborEntries: 0,
      invoices: 0,
      importBatches: 0,
      projects: 0,
    });
  });

  it('still deletes everything, including a connection, on a deployment with no bank provider configured', async () => {
    // The deliberate divergence from disconnectConnectionAction/syncNowAction,
    // which both refuse outright with no provider (spec §6): an owner should
    // still be able to delete everything on a deployment that has never had
    // Plaid credentials, or has since had them removed. The connection row
    // still gets deleted below - `removeItem` is simply never asked, because
    // there is no provider to ask it of.
    providerRef.current = null;
    const alice = await createOwner(db);
    await seedOneOfEverything(db, alice, 'Alice');

    signInAs(alice);
    const result = await deleteAllDataAction();

    expect(result).toEqual({
      ok: true,
      data: {
        connections: 1,
        transactions: 1,
        laborEntries: 1,
        invoices: 1,
        importBatches: 1,
        projects: 1,
      },
    });
    expect(removeItem.fn).not.toHaveBeenCalled();
    expect(await tableCounts(db, alice)).toEqual({
      connections: 0,
      transactions: 0,
      laborEntries: 0,
      invoices: 0,
      importBatches: 0,
      projects: 0,
    });
  });

  it('reports zeroes for an owner with nothing to delete, rather than failing', async () => {
    const alice = await createOwner(db);
    signInAs(alice);

    const result = await deleteAllDataAction();

    expect(result).toEqual({
      ok: true,
      data: {
        connections: 0,
        transactions: 0,
        laborEntries: 0,
        invoices: 0,
        importBatches: 0,
        projects: 0,
      },
    });
    expect(removeItem.fn).not.toHaveBeenCalled();
  });
});
