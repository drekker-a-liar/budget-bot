import { createHash } from 'node:crypto';
import { bankRepo, schema, type BankConnection, type Database } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  FAKE_ACCESS_TOKEN,
  FAKE_INSTITUTION_NAME,
  FAKE_ITEM_ID,
  defaultFakeScript,
} from '@/src/server/bank/fake-provider';
import { createOwner, describeDb, testDatabaseUrl, useTestDb } from './helpers/db';

/**
 * `POST /api/webhooks/plaid` (spec §3), against a real Postgres and the
 * scripted bank behind the E2E door - the same reasons `sync.test.ts` gives
 * for using both: the advisory lock, the cursor commit and the replay ledger
 * are all things Postgres actually enforces, and a mocked database would only
 * ever agree with whatever this test assumed.
 *
 * `runSync` is mocked as a spy *around* its real implementation - the way
 * `sync.test.ts` wraps `withSyncLock` - so a case can assert it was called
 * exactly once without losing the real page-by-page commit underneath it.
 */

const runSyncMock = { fn: vi.fn() };

vi.mock('@/src/server/bank/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/server/bank/sync')>();
  runSyncMock.fn.mockImplementation(actual.runSync);
  return { ...actual, runSync: runSyncMock.fn };
});

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const KEY_B64 = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');
const keyring = loadKeysFromEnv({ BANK_TOKEN_ENCRYPTION_KEY: KEY_B64 });

const FAKE_HEADER = 'fake-verification';

function bodyHashHex(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function webhookRequest(payload: Record<string, unknown>, headerOverride?: string): Request {
  const rawBody = JSON.stringify(payload);
  return new Request('http://localhost/api/webhooks/plaid', {
    method: 'POST',
    headers: { [FAKE_HEADER]: headerOverride ?? bodyHashHex(rawBody) },
    body: rawBody,
  });
}

/** No response this route sends may carry an id of any kind (spec §3). */
function assertNoIdentifiers(value: unknown): void {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const json = JSON.stringify(value);
  expect(json).not.toMatch(UUID);
  expect(json).not.toMatch(/(item|owner|connection)id/i);
}

describeDb('POST /api/webhooks/plaid', () => {
  const getDb = useTestDb();
  let db: Database;
  let ownerId: string;
  let connection: BankConnection;

  beforeEach(async () => {
    vi.stubEnv('E2E', '1');
    vi.stubEnv('BANK_TOKEN_ENCRYPTION_KEY', KEY_B64);
    vi.stubEnv('DATABASE_URL', testDatabaseUrl as string);
    runSyncMock.fn.mockClear();

    db = getDb();
    ownerId = await createOwner(db);
    connection = await bankRepo.createConnection(
      db,
      ownerId,
      {
        itemId: FAKE_ITEM_ID,
        accessToken: FAKE_ACCESS_TOKEN,
        institutionId: 'ins_fake',
        institutionName: FAKE_INSTITUTION_NAME,
      },
      keyring
    );
    await bankRepo.upsertAccounts(db, ownerId, connection.id, defaultFakeScript().accounts);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function post(payload: Record<string, unknown>) {
    const { POST } = await import('@/app/api/webhooks/plaid/route');
    const response = await POST(webhookRequest(payload));
    const body = await response.json();
    return { status: response.status, body };
  }

  it('refuses a body whose signature does not check out', async () => {
    const { POST } = await import('@/app/api/webhooks/plaid/route');
    const response = await POST(
      webhookRequest({ webhook_type: 'TRANSACTIONS', item_id: FAKE_ITEM_ID }, 'not-the-hash')
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false });
    assertNoIdentifiers(body);

    const rows = await db.select().from(schema.webhookEvents);
    expect(rows).toHaveLength(0);
  });

  it('recognises a redelivered payload rather than reprocessing it', async () => {
    const payload = {
      webhook_type: 'ITEM',
      webhook_code: 'WEBHOOK_UPDATE_ACKNOWLEDGED',
      item_id: 'item-nobody-has-ever-seen',
    };

    const first = await post(payload);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });

    const second = await post(payload);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, duplicate: true });
    assertNoIdentifiers(second.body);
  });

  it('processes two different bodies naming the same item, since replay is keyed by body hash, not item', async () => {
    const first = await post({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: FAKE_ITEM_ID,
      nonce: 'first',
    });
    const second = await post({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: FAKE_ITEM_ID,
      nonce: 'second',
    });

    // Neither is a `duplicate` reply: the two bodies differ (by `nonce`),
    // even though both name the same item, so both are new arrivals.
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });

    expect(runSyncMock.fn).toHaveBeenCalledTimes(2);

    const rows = await db.select().from(schema.webhookEvents);
    const matching = rows.filter((row) => row.itemId === FAKE_ITEM_ID);
    expect(matching).toHaveLength(2);
    expect(matching.every((row) => row.processedAt !== null)).toBe(true);
  });

  it('marks an unrecognised item processed without dispatching anything', async () => {
    const { status, body } = await post({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'item-nobody-has-ever-seen',
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    assertNoIdentifiers(body);
    expect(runSyncMock.fn).not.toHaveBeenCalled();
  });

  it('dispatches exactly one runSync for a TRANSACTIONS/SYNC_UPDATES_AVAILABLE webhook', async () => {
    const { status, body } = await post({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: FAKE_ITEM_ID,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    assertNoIdentifiers(body);
    expect(runSyncMock.fn).toHaveBeenCalledTimes(1);

    const [, calledOwnerId, calledConnectionId] = runSyncMock.fn.mock.calls[0];
    expect(calledOwnerId).toBe(ownerId);
    expect(calledConnectionId).toBe(connection.id);

    // A real effect of the real `runSync`: the fake's two-page default script
    // ran to completion and its cursor landed on the last page it issued.
    const reloaded = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(reloaded?.cursor).toBe('fake-2');
  });

  it('marks the connection reauth_required on an ITEM_LOGIN_REQUIRED error', async () => {
    // Plaid's real shape: `webhook_type: 'ITEM'`, `webhook_code: 'ERROR'`, and
    // the actual reason nested under `error.error_code` - not a bare
    // `webhook_type: 'ERROR'`.
    const { status, body } = await post({
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: FAKE_ITEM_ID,
      error: { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED' },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    assertNoIdentifiers(body);

    const reloaded = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(reloaded?.status).toBe('reauth_required');
    expect(reloaded?.lastErrorCode).toBe('ITEM_LOGIN_REQUIRED');
  });

  it('leaves the connection active on an ITEM/ERROR that is not a reauth code', async () => {
    // A negative probe alongside the positive one above: an `ITEM`/`ERROR`
    // payload whose `error.error_code` is not `ITEM_LOGIN_REQUIRED` must not
    // be read as a reauth signal at all.
    const { status, body } = await post({
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: FAKE_ITEM_ID,
      error: { error_type: 'ITEM_ERROR', error_code: 'INSTITUTION_DOWN' },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    assertNoIdentifiers(body);

    const reloaded = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.lastErrorCode).toBeNull();

    const rows = await db.select().from(schema.webhookEvents);
    const row = rows.find((candidate) => candidate.itemId === FAKE_ITEM_ID);
    if (!row) throw new Error('the webhook row is missing');
    expect(row.processedAt).not.toBeNull();
    expect(row.error).toBeNull();
  });

  it('marks the connection reauth_required on ITEM/PENDING_EXPIRATION', async () => {
    const { status } = await post({
      webhook_type: 'ITEM',
      webhook_code: 'PENDING_EXPIRATION',
      item_id: FAKE_ITEM_ID,
    });

    expect(status).toBe(200);
    const reloaded = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(reloaded?.status).toBe('reauth_required');
    expect(reloaded?.lastErrorCode).toBe('PENDING_EXPIRATION');
  });

  it('does not let the next successful sync erase a standing PENDING_EXPIRATION warning (SF-2)', async () => {
    await post({
      webhook_type: 'ITEM',
      webhook_code: 'PENDING_EXPIRATION',
      item_id: FAKE_ITEM_ID,
    });

    // The token still works - that is the whole point of an early warning -
    // so the very next transaction webhook runs a real sync to completion,
    // the same as any other TRANSACTIONS/SYNC_UPDATES_AVAILABLE dispatch.
    const { status, body } = await post({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: FAKE_ITEM_ID,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(runSyncMock.fn).toHaveBeenCalledTimes(1);

    const reloaded = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(reloaded?.status).toBe('reauth_required');
    expect(reloaded?.lastErrorCode).toBe('PENDING_EXPIRATION');
    // The sync itself still ran and committed real progress - only the
    // status/error columns are sticky, not the connection's usefulness.
    expect(reloaded?.cursor).not.toBeNull();
  });

  it('records a crash after verification on the ledger row and still answers 200', async () => {
    runSyncMock.fn.mockImplementationOnce(async () => {
      throw new Error('boom - a crash unrelated to the provider');
    });

    const { status, body } = await post({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: FAKE_ITEM_ID,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    assertNoIdentifiers(body);

    const rows = await db.select().from(schema.webhookEvents);
    const row = rows.find((candidate) => candidate.itemId === FAKE_ITEM_ID);
    if (!row) throw new Error('the webhook row is missing');
    expect(row.processedAt).not.toBeNull();
    expect(row.error).not.toBeNull();
    // A code, never the crash's own message (spec §9) - and never the payload.
    expect(row.error).not.toMatch(/boom/);
  });

  it('never persists the raw payload, only the ledger columns', async () => {
    await post({
      webhook_type: 'ITEM',
      webhook_code: 'WEBHOOK_UPDATE_ACKNOWLEDGED',
      item_id: FAKE_ITEM_ID,
      secret_field: 'should never be stored',
    });

    const [row] = await db.select().from(schema.webhookEvents);
    expect(Object.keys(row)).not.toContain('payload');
    expect(JSON.stringify(row)).not.toMatch(/should never be stored/);
  });

  it('answers 200 with no verification when no provider is configured', async () => {
    vi.stubEnv('E2E', '0');
    vi.stubEnv('PLAID_CLIENT_ID', '');
    vi.stubEnv('PLAID_SECRET', '');

    const { status, body } = await post({ webhook_type: 'TRANSACTIONS' });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});
