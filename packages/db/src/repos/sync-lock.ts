import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../client';

/**
 * One sync per connection at a time (ADR 0004).
 *
 * A webhook, the cron safety net and someone pressing **Sync now** can all
 * arrive within the same second, and `/transactions/sync` is a cursor: two
 * runs applying pages against the same cursor interleave into duplicated work
 * and a cursor that ends up behind where it should be.
 *
 * A Postgres advisory lock rather than a `status` column or a row lock,
 * because it is the only one of the three that cannot be left held. It is
 * scoped to the transaction (`_xact_`), so a process that crashes mid-sync
 * releases it when its connection dies, and nothing has to remember to clean
 * up after it. `_try_` rather than the blocking form: a second sync arriving
 * while one is running has nothing to add, so it says so and returns instead
 * of queueing behind work that will have already done its job.
 *
 * The lock is the transaction, so the work runs inside it: a page that fails
 * rolls back with the cursor it would have committed.
 */

export type SyncLockResult<T> = { skipped: true } | { skipped: false; result: T };

export async function withSyncLock<T>(
  db: Database,
  connectionId: string,
  fn: (tx: Transaction) => Promise<T>
): Promise<SyncLockResult<T>> {
  return db.transaction(async (tx) => {
    // `hashtext` because the lock space is a pair of 32-bit integers and a
    // connection id is a uuid. A collision would make two unrelated
    // connections take turns, which is slower than it needs to be and never
    // wrong; the reverse - two runs on one connection both proceeding - is
    // the failure that matters, and hashing cannot cause it.
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${connectionId})) as locked`
    );
    if (!row.locked) return { skipped: true };
    return { skipped: false, result: await fn(tx) };
  });
}
