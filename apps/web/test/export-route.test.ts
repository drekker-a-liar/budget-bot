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
 * `GET /api/export` (spec §6), against a real Postgres.
 *
 * The property under test is what actually reaches the JSON body: the
 * signed-in owner's own rows, and never a second owner's, never a token or
 * anything shaped like one, and never the columns that exist to run a sync
 * rather than to describe what is connected. Walking the body recursively -
 * every key name, every string value - is what makes this a test of the
 * response rather than of this file's own assumption about it: a field added
 * to a table later is caught here whether or not anybody remembered to.
 */

const authSession = vi.hoisted(() => ({
  current: null as { user: { id: string }; expires: string } | null,
}));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => authSession.current) }));

const { GET } = await import('@/app/api/export/route');

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const KEY_B64 = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');
const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: KEY_B64 });

function signInAs(ownerId: string): void {
  authSession.current = { user: { id: ownerId }, expires: '2026-09-01' };
}

/** Never a real secret - a fake one shaped exactly like a bank access token. */
const FAKE_BANK_ACCESS_TOKEN = 'access-sandbox-8f2a1c04-b6d9-4e77-9b12-0d3a5c6e7f80';

/** Every key name, and every string value, anywhere in a JSON value. */
function walk(value: unknown, keys: Set<string>, strings: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, strings);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      keys.add(key);
      walk(inner, keys, strings);
    }
    return;
  }
  if (typeof value === 'string') strings.add(value);
}

describeDb('GET /api/export', () => {
  const getDb = useTestDb();
  let db: Database;

  beforeEach(() => {
    vi.stubEnv('BANK_TOKEN_ENCRYPTION_KEY', KEY_B64);
    vi.stubEnv('DATABASE_URL', testDatabaseUrl as string);
    authSession.current = null;
    db = getDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses with no session', async () => {
    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('carries the owner’s own data, no token or provider id anywhere, and never another owner’s', async () => {
    const alice = await createOwner(db);
    const bob = await createOwner(db);

    const aliceProject = await projectsRepo.createProject(db, alice, {
      name: 'Alice Deck',
      clientName: 'Alice Client',
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
    await transactionsRepo.createTransaction(db, alice, {
      date: '2026-08-14',
      description: 'Alice vendor purchase',
      vendor: 'Alice Home Depot',
      amountCents: parseMoney('114.75'),
      category: 'materials',
      paymentMethod: 'card',
      status: 'unassigned',
      taxDeductible: true,
    });
    await laborRepo.createLaborEntry(db, alice, {
      projectId: aliceProject.id,
      date: '2026-08-05',
      hours: 4,
      hourlyRateCents: parseMoney('85.00'),
      workerName: 'Alice',
    });
    await invoicesRepo.createInvoice(db, alice, {
      projectId: aliceProject.id,
      invoiceNumber: 'INV-ALICE-1',
      amountCents: parseMoney('1950.00'),
      depositAmountCents: parseMoney('0'),
      dateIssued: '2026-08-01',
      dueDate: '2026-08-15',
      status: 'sent',
    });
    await importBatchesRepo.createImportBatch(db, alice, {
      source: 'csv',
      filename: 'alice.csv',
      rowCount: 1,
      insertedCount: 1,
      skippedCount: 0,
    });
    const aliceConnection = await bankRepo.createConnection(
      db,
      alice,
      {
        itemId: 'item-alice',
        accessToken: FAKE_BANK_ACCESS_TOKEN,
        institutionId: 'ins_alice',
        institutionName: 'Alice Bank',
      },
      keyring
    );
    await bankRepo.upsertAccounts(db, alice, aliceConnection.id, [
      {
        externalId: 'acct-alice-checking',
        name: 'Alice Checking',
        officialName: 'Alice Bank Checking',
        mask: '0000',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: parseMoney('412.00'),
        availableBalanceCents: parseMoney('412.00'),
        creditLimitCents: null,
        isoCurrencyCode: 'USD',
      },
    ]);

    // Bob: a distinctive vendor tag that must never appear in Alice's export.
    const bobProject = await projectsRepo.createProject(db, bob, {
      name: 'Bob Fence',
      clientName: 'Bob Client',
      clientPhone: '',
      clientAddress: '',
      description: '',
      status: 'in_progress',
      pricingType: 'fixed',
      quotedTotalCents: parseMoney('2000.00'),
      quotedMaterialsCents: parseMoney('800.00'),
      quotedLaborHours: 10,
      targetHourlyRateCents: parseMoney('75.00'),
      targetMarginPct: 40,
      startDate: '2026-08-02',
    });
    await transactionsRepo.createTransaction(db, bob, {
      date: '2026-08-14',
      description: 'not alices',
      vendor: 'BOB-ONLY-VENDOR-TAG',
      amountCents: parseMoney('42.10'),
      category: 'materials',
      paymentMethod: 'card',
      status: 'unassigned',
      taxDeductible: true,
      projectId: bobProject.id,
    });

    signInAs(alice);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="budget-bot-export-\d{4}-\d{2}-\d{2}\.json"$/
    );

    const body = (await response.json()) as Record<string, unknown>;

    expect(body.units).toBe('cents');
    expect(body.exportedAt).toEqual(expect.any(String));
    expect(body.projects).toHaveLength(1);
    expect(body.transactions).toHaveLength(1);
    expect(body.laborEntries).toHaveLength(1);
    expect(body.invoices).toHaveLength(1);
    expect(body.importBatches).toHaveLength(1);
    expect(body.connections).toEqual([
      {
        institutionName: 'Alice Bank',
        status: 'active',
        createdAt: expect.any(String),
        lastSyncedAt: null,
        accounts: [
          {
            name: 'Alice Checking',
            mask: '0000',
            type: 'depository',
            subtype: 'checking',
            isEnabled: true,
          },
        ],
      },
    ]);

    const keys = new Set<string>();
    const strings = new Set<string>();
    walk(body, keys, strings);

    for (const forbidden of [
      'accessTokenCiphertext',
      'cursor',
      'itemId',
      'encryptionKeyId',
      'externalId',
      // A raw `bank_accounts.id` foreign key. Accounts carry no id in the
      // export at all (spec §6), so this could never be correlated to
      // anything else in the file - a database handle with no purpose here.
      'bankAccountId',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }

    for (const value of strings) {
      expect(value).not.toMatch(/^access-(sandbox|development|production)-/);
      expect(value).not.toMatch(/^v1:/);
      expect(value).not.toContain('BOB-ONLY-VENDOR-TAG');
    }
  });
});
