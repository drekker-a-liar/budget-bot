import type { BankProvider, NormalizedAccount, SyncResult } from '@budget-bot/bank-connectors';
import { bankRepo, schema, webhookEventsRepo, type Database } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwner, describeDb, testDatabaseUrl, useTestDb } from './helpers/db';

/**
 * `GET /api/internal/sync` (spec §4) - the daily safety net, against a real
 * Postgres. The bank provider is mocked at the module boundary rather than
 * driven through `FakeBankProvider`, because this route's own job - keep
 * going when one connection's `getAccounts` fails, and never touch a
 * `reauth_required` one - needs a provider whose behaviour differs *per
 * connection*, which the shared E2E fixture's single fixed script cannot
 * express.
 */

const providerMock = vi.hoisted(() => ({ getBankProvider: vi.fn() }));

vi.mock('@/src/server/bank/provider', () => ({
  getBankProvider: providerMock.getBankProvider,
}));

const KEY_B64 = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');
const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: KEY_B64 });

const CRON_SECRET = 'cron-secret-not-a-real-one';

const EMPTY_PAGE: SyncResult = {
  added: [],
  modified: [],
  removed: [],
  nextCursor: null,
  hasMore: false,
};

function account(externalId: string): NormalizedAccount {
  return {
    externalId,
    name: 'Fake Checking',
    officialName: null,
    mask: '0000',
    type: 'depository',
    subtype: 'checking',
    currentBalanceCents: 0 as NormalizedAccount['currentBalanceCents'],
    availableBalanceCents: 0 as NormalizedAccount['availableBalanceCents'],
    creditLimitCents: null,
    isoCurrencyCode: 'USD',
  };
}

/**
 * A provider whose `getAccounts` fails for exactly one access token and
 * succeeds for every other, so one connection can be made to fail without
 * the rest being touched. Nothing else on it is ever called by this route.
 */
function scriptedProvider(failingAccessToken: string | null): BankProvider {
  return {
    id: 'plaid',
    async createLinkToken() {
      throw new Error('not used by this route');
    },
    async exchangePublicToken() {
      throw new Error('not used by this route');
    },
    async getAccounts(accessToken: string) {
      if (accessToken === failingAccessToken) {
        throw new Error('boom - getAccounts failed for this connection');
      }
      return [account(`${accessToken}-acct`)];
    },
    async syncTransactions() {
      return EMPTY_PAGE;
    },
    async removeItem() {},
    async verifyAndParseWebhook() {
      throw new Error('not used by this route');
    },
  };
}

function request(authorization?: string): Request {
  return new Request('http://localhost/api/internal/sync', {
    method: 'GET',
    headers: authorization !== undefined ? { authorization } : {},
  });
}

/** No value anywhere in the body may be a string (spec §4): counts only. */
function assertCountsOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertCountsOnly(entry);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) assertCountsOnly(entry);
    return;
  }
  expect(['boolean', 'number']).toContain(typeof value);
}

describeDb('GET /api/internal/sync', () => {
  const getDb = useTestDb();
  let db: Database;

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    vi.stubEnv('BANK_TOKEN_ENCRYPTION_KEY', KEY_B64);
    vi.stubEnv('DATABASE_URL', testDatabaseUrl as string);
    providerMock.getBankProvider.mockReset();
    providerMock.getBankProvider.mockReturnValue(scriptedProvider(null));
    db = getDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function get(authorization?: string) {
    const { GET } = await import('@/app/api/internal/sync/route');
    const response = await GET(request(authorization));
    const body = await response.json();
    return { status: response.status, body };
  }

  it('answers 503 and does nothing when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const { status, body } = await get(`Bearer ${CRON_SECRET}`);

    expect(status).toBe(503);
    expect(body).toEqual({ ok: false });
    expect(providerMock.getBankProvider).not.toHaveBeenCalled();
  });

  it('answers 401 on the wrong bearer token', async () => {
    const { status, body } = await get('Bearer not-the-secret');

    expect(status).toBe(401);
    expect(body).toEqual({ ok: false });
  });

  it('answers 401 with no Authorization header at all', async () => {
    const { status, body } = await get(undefined);

    expect(status).toBe(401);
    expect(body).toEqual({ ok: false });
  });

  it('never sends a WWW-Authenticate hint on a refusal', async () => {
    const { GET } = await import('@/app/api/internal/sync/route');
    const response = await GET(request('Bearer wrong'));

    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('syncs every active connection across owners', async () => {
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const alicesConnection = await bankRepo.createConnection(
      db,
      alice,
      { itemId: 'item-alice', accessToken: 'access-alice' },
      keyring
    );
    const bobsConnection = await bankRepo.createConnection(
      db,
      bob,
      { itemId: 'item-bob', accessToken: 'access-bob' },
      keyring
    );

    const { status, body } = await get(`Bearer ${CRON_SECRET}`);

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, connections: 2, synced: 2, failed: 0, purgedEvents: 0 });
    assertCountsOnly(body);

    const reloadedAlice = await bankRepo.getConnection(db, alice, alicesConnection.id);
    expect(reloadedAlice?.lastSyncedAt).not.toBeNull();
    expect(reloadedAlice?.status).toBe('active');
    const reloadedBob = await bankRepo.getConnection(db, bob, bobsConnection.id);
    expect(reloadedBob?.lastSyncedAt).not.toBeNull();
    expect(reloadedBob?.status).toBe('active');
  });

  it('keeps going past one connection whose getAccounts fails, and records the failure', async () => {
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const healthy = await bankRepo.createConnection(
      db,
      alice,
      { itemId: 'item-alice', accessToken: 'access-alice' },
      keyring
    );
    const failing = await bankRepo.createConnection(
      db,
      bob,
      { itemId: 'item-bob', accessToken: 'access-bob' },
      keyring
    );
    providerMock.getBankProvider.mockReturnValue(scriptedProvider('access-bob'));

    const { status, body } = await get(`Bearer ${CRON_SECRET}`);

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, connections: 2, synced: 1, failed: 1, purgedEvents: 0 });

    const reloadedHealthy = await bankRepo.getConnection(db, alice, healthy.id);
    expect(reloadedHealthy?.status).toBe('active');
    expect(reloadedHealthy?.lastSyncedAt).not.toBeNull();

    const reloadedFailing = await bankRepo.getConnection(db, bob, failing.id);
    expect(reloadedFailing?.status).toBe('error');
    expect(reloadedFailing?.lastErrorCode).not.toBeNull();
  });

  it('sweeps a connection standing at ‘error’ and self-heals it on a successful sync (SF-1)', async () => {
    const bob = await createOwner(db);
    const errored = await bankRepo.createConnection(
      db,
      bob,
      { itemId: 'item-bob', accessToken: 'access-bob' },
      keyring
    );
    await bankRepo.recordSyncError(db, bob, errored.id, {
      code: 'SYNC_FAILED',
      status: 'error',
    });

    const { status, body } = await get(`Bearer ${CRON_SECRET}`);

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, connections: 1, synced: 1, failed: 0, purgedEvents: 0 });

    const reloaded = await bankRepo.getConnection(db, bob, errored.id);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.lastErrorCode).toBeNull();
    expect(reloaded?.lastSyncedAt).not.toBeNull();
  });

  it('does not sync a connection that is reauth_required', async () => {
    const bob = await createOwner(db);
    const needsReauth = await bankRepo.createConnection(
      db,
      bob,
      { itemId: 'item-bob', accessToken: 'access-bob' },
      keyring
    );
    await bankRepo.recordSyncError(db, bob, needsReauth.id, {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'reauth_required',
    });

    const { status, body } = await get(`Bearer ${CRON_SECRET}`);

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, connections: 0, synced: 0, failed: 0, purgedEvents: 0 });

    const reloaded = await bankRepo.getConnection(db, bob, needsReauth.id);
    expect(reloaded?.status).toBe('reauth_required');
    expect(reloaded?.lastSyncedAt).toBeNull();
  });

  it('purges webhook ledger rows older than 30 days and keeps the rest', async () => {
    const old = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'hash-old',
      itemId: null,
      webhookType: 'ITEM',
      webhookCode: null,
    });
    if (!('id' in old)) throw new Error('unreachable');
    // Through the driver rather than drizzle's query builder: this app does
    // not depend on `drizzle-orm` (see `test/helpers/db.ts`), and backdating
    // one column for a fixture is not a reason to add one.
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await db.$client`update webhook_events set received_at = ${thirtyOneDaysAgo} where id = ${old.id}`;

    const recent = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'hash-recent',
      itemId: null,
      webhookType: 'ITEM',
      webhookCode: null,
    });
    if (!('id' in recent)) throw new Error('unreachable');

    const { status, body } = await get(`Bearer ${CRON_SECRET}`);

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, connections: 0, synced: 0, failed: 0, purgedEvents: 1 });

    const rows = await db.select().from(schema.webhookEvents);
    expect(rows.map((row) => row.id)).toEqual([recent.id]);
  });
});
