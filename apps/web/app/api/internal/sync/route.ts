import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { bankRepo, getDb, webhookEventsRepo } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { getBankProvider } from '@/src/server/bank/provider';
import { runSync, syncFailureOf } from '@/src/server/bank/sync';

/**
 * The daily cron safety net (spec §4).
 *
 * Webhooks are primary; this exists to catch up whatever one missed - a
 * delivery Plaid never made, a body that failed verification, a crash before
 * `runSync` ran. It has no signed-in owner, so it authenticates the one way a
 * scheduler can: a bearer token Vercel is configured to send
 * (`vercel.json`'s `crons` block), checked in constant time. `CRON_SECRET`
 * unset is a supported deployment - previews and bare local runs simply have
 * the route disabled - and refuses with 503 rather than skipping the check.
 *
 * The response is counts only, the same discipline the webhook route keeps
 * for the same reason: whoever calls this has, at best, only just proven it
 * holds the secret, and a body naming a connection or an owner would hand
 * that caller more than the scheduler ever needed to see.
 */

/** Ledger rows older than this many days are purged on every run (spec §4). */
const RETENTION_DAYS = 30;

/**
 * `header` is exactly `Bearer <secret>`, checked in constant time.
 *
 * The length check has to come first: `timingSafeEqual` throws on buffers of
 * different lengths rather than answering false, and a caller learning that
 * from a stack trace is no safer than it learning it from a timing
 * difference.
 */
function bearerMatches(header: string | null, secret: string): boolean {
  if (header === null) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const db = getDb();
  const provider = getBankProvider();

  let synced = 0;
  let failed = 0;
  let connections: Array<{ id: string; ownerId: string }> = [];

  if (provider) {
    const keyring = loadKeysFromEnv();
    connections = await bankRepo.listActiveConnectionsAllOwners(db);

    // Same split `syncNowAction` keeps, and for the same reason: the account
    // refresh has nothing downstream of it that will record a failure, so
    // this catch has to; `runSync` already recorded its own failure on the
    // connection before it threw, so the second catch below must not write
    // over that a second time.
    for (const connection of connections) {
      try {
        const accounts = await bankRepo.withAccessToken(
          db,
          connection.ownerId,
          connection.id,
          keyring,
          (accessToken) => provider.getAccounts(accessToken)
        );
        await bankRepo.upsertAccounts(db, connection.ownerId, connection.id, accounts);
      } catch (error) {
        await bankRepo.recordSyncError(db, connection.ownerId, connection.id, syncFailureOf(error));
        failed += 1;
        continue;
      }

      try {
        // A `{skipped: true}` result - another sync already owns this
        // connection - is not a failure: that other run is doing this one's
        // work, so this connection still counts as synced.
        await runSync(db, connection.ownerId, connection.id, { provider, keyring });
        synced += 1;
      } catch {
        failed += 1;
      }
    }
  }

  const purgedEvents = await webhookEventsRepo.purgeWebhookEvents(db, RETENTION_DAYS);

  return NextResponse.json({
    ok: true,
    connections: connections.length,
    synced,
    failed,
    purgedEvents,
  });
}
