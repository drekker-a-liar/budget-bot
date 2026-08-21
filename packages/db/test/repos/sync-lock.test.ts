import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/client';
import { withSyncLock } from '../../src/repos';
import { users } from '../../src/schema';
import { describeDb, useTestDb } from '../helpers/db';

/**
 * The lock that stops a webhook and the cron sync applying the same page twice
 * (ADR 0004).
 *
 * Both cases below need *two* connections. `pg_try_advisory_xact_lock` is held
 * by a session, so two overlapping transactions on the same connection cannot
 * contend for it - postgres.js would serialise them, and the test would pass
 * against a `withSyncLock` that did nothing at all.
 */

const getDb = useTestDb();

/** Held open until the test releases it, so the lock is genuinely contended. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describeDb('withSyncLock', () => {
  let other: Database;

  beforeAll(() => {
    other = createDb(process.env.DATABASE_URL_TEST as string, { max: 1 });
  });

  afterAll(async () => {
    await other?.$client.end();
  });

  it('skips a sync while another connection is running one', async () => {
    const db = getDb();
    const connectionId = crypto.randomUUID();
    const held = deferred();
    const started = deferred();

    const first = withSyncLock(db, connectionId, async () => {
      started.resolve();
      await held.promise;
      return 'first';
    });
    await started.promise;

    const second = await withSyncLock(other, connectionId, async () => 'second');
    held.resolve();

    expect(second).toEqual({ skipped: true });
    expect(await first).toEqual({ skipped: false, result: 'first' });
  });

  it('lets a different connection sync at the same time', async () => {
    const db = getDb();
    const held = deferred();
    const started = deferred();

    const first = withSyncLock(db, crypto.randomUUID(), async () => {
      started.resolve();
      await held.promise;
      return 'first';
    });
    await started.promise;

    const second = await withSyncLock(other, crypto.randomUUID(), async () => 'second');
    held.resolve();

    expect(second).toEqual({ skipped: false, result: 'second' });
    expect(await first).toEqual({ skipped: false, result: 'first' });
  });

  it('runs both when they do not overlap', async () => {
    const db = getDb();
    const connectionId = crypto.randomUUID();

    expect(await withSyncLock(db, connectionId, async () => 1)).toEqual({
      skipped: false,
      result: 1,
    });
    expect(await withSyncLock(other, connectionId, async () => 2)).toEqual({
      skipped: false,
      result: 2,
    });
  });

  it('releases the lock when the work throws', async () => {
    const db = getDb();
    const connectionId = crypto.randomUUID();

    await expect(
      withSyncLock(db, connectionId, async () => {
        throw new Error('page failed');
      })
    ).rejects.toThrow('page failed');

    // The lock is transaction-scoped, so the rollback that carried the failure
    // out is also what let go of it - there is nothing to release by hand.
    expect(await withSyncLock(other, connectionId, async () => 'after')).toEqual({
      skipped: false,
      result: 'after',
    });
  });

  it('rolls the work back when the page fails', async () => {
    const db = getDb();
    const connectionId = crypto.randomUUID();
    const email = `rollback-${crypto.randomUUID()}@example.test`;

    await expect(
      withSyncLock(db, connectionId, async (tx) => {
        await tx.insert(users).values({ email, name: 'Rolled back' });
        throw new Error('page failed');
      })
    ).rejects.toThrow('page failed');

    // The work runs in the same transaction the lock is held in, so a page
    // that fails leaves nothing behind and the next attempt starts from the
    // cursor that was last committed.
    expect(await db.select().from(users).where(eq(users.email, email))).toEqual([]);
  });
});
