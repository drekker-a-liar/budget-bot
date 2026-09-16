import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_ITEM_ID } from '@/src/server/bank/fake-provider';

/**
 * `POST /api/webhooks/plaid` when the database is what failed.
 *
 * `webhooks-plaid-route.test.ts` proves the route against a real Postgres,
 * and a real Postgres cannot be made to refuse one write on cue. So the
 * repositories are mocked here, for the one case where the mocked shape *is*
 * the point: the ledger write inside the route's own `catch` throws. Before
 * Phase 5 that throw escaped the handler as a 500 - a status Plaid retries
 * against, and the one outcome after verification the route promises never
 * to produce (spec §3). Without this file, that promise is checked only on
 * the paths where the database is healthy.
 */

const ledger = vi.hoisted(() => ({
  markWebhookProcessed: vi.fn(async (_db: unknown, _id: string, _error?: string) => undefined),
}));

vi.mock('@budget-bot/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budget-bot/db')>()),
  getDb: () => ({}),
  webhookEventsRepo: {
    recordWebhookEvent: vi.fn(async () => ({ id: 'evt-1' })),
    resolveWebhookOwner: vi.fn(async () => undefined),
    markWebhookProcessed: ledger.markWebhookProcessed,
  },
  bankRepo: {
    findConnectionByItemId: vi.fn(async () => ({ id: 'conn-1', ownerId: 'owner-1' })),
    recordSyncError: vi.fn(async () => undefined),
  },
}));

const runSync = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/bank/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/server/bank/sync')>()),
  runSync,
}));

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const KEY_B64 = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');

/** Signed the way the fake provider behind the E2E door checks it. */
function signedRequest(payload: Record<string, unknown>): Request {
  const rawBody = JSON.stringify(payload);
  return new Request('http://localhost/api/webhooks/plaid', {
    method: 'POST',
    headers: { 'fake-verification': createHash('sha256').update(rawBody).digest('hex') },
    body: rawBody,
  });
}

describe('POST /api/webhooks/plaid when the ledger write itself fails', () => {
  beforeEach(() => {
    vi.stubEnv('E2E', '1');
    vi.stubEnv('BANK_TOKEN_ENCRYPTION_KEY', KEY_B64);
    runSync.mockReset();
    ledger.markWebhookProcessed.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('still answers 200, and logs rather than throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    runSync.mockRejectedValueOnce(new Error('boom - the database went away mid-sync'));
    ledger.markWebhookProcessed.mockRejectedValueOnce(new Error('boom - and it is still away'));

    const { POST } = await import('@/app/api/webhooks/plaid/route');
    const response = await POST(
      signedRequest({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: FAKE_ITEM_ID,
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // It did try to record the failure - as a code, the way the healthy path
    // does - before the write itself failed.
    expect(ledger.markWebhookProcessed).toHaveBeenCalledWith({}, 'evt-1', 'SYNC_FAILED');
    expect(logged).toHaveBeenCalledTimes(1);
    // The message and stack, never the error object: a driver error carries
    // the failing query and its parameters.
    expect(logged.mock.calls[0].every((part) => typeof part === 'string')).toBe(true);
  });
});
