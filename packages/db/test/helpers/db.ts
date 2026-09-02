import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { createDb, createSqlClient, type Database } from '../../src/client';
import { runMigrations } from '../../src/migrate';
import { users } from '../../src/schema';

/**
 * Harness for the tests that need a real Postgres. They run against a real
 * database rather than a mock because everything worth asserting here - a
 * partial unique index, an upsert's merge rule, `bigint` round-tripping - is
 * behaviour Postgres provides and a fake would only restate.
 *
 * The suite skips itself, with a reason, when that database is not reachable,
 * so `pnpm test` still passes on a machine with no Docker running.
 */

const url = process.env.DATABASE_URL_TEST;

async function probe(): Promise<string | null> {
  if (!url) return 'DATABASE_URL_TEST is not set (see .env.example)';
  // The raw driver rather than drizzle: its error is one line about the
  // connection, not a dump of the query that could not run.
  const client = createSqlClient(url, { max: 1 });
  try {
    await client`select 1`;
    return null;
  } catch (error) {
    // postgres.js reports a refused connection as a code with no message.
    const { code, message } = error as { code?: string; message?: string };
    return `DATABASE_URL_TEST is unreachable (${message || code || 'unknown error'}); try \`pnpm db:up\``;
  } finally {
    await client.end();
  }
}

const skipReason = await probe();

/**
 * `describe`, unless there is no database, in which case it says why.
 *
 * Under `CI` a missing database is a failure, not a skip. The skip exists so
 * `pnpm test` passes on a laptop with no Docker running; in CI the database is
 * provisioned by the workflow, and the only way it is unreachable is a
 * configuration mistake - which is exactly what happened when `turbo`'s strict
 * env mode hid `DATABASE_URL_TEST` from every task and 231 tests skipped, with
 * a reason, behind a green check for the whole of Phases 3 to 5.
 */
export function describeDb(name: string, suite: () => void): void {
  if (skipReason === null) {
    describe(name, suite);
  } else if (process.env.CI) {
    throw new Error(`${name}: database-backed suite cannot run in CI - ${skipReason}`);
  } else {
    describe.skip(`${name} [skipped: ${skipReason}]`, suite);
  }
}

/** Every table the tests write to, ordered so a truncate cascade is enough. */
const TABLES = [
  'transactions',
  'invoices',
  'labor_entries',
  'projects',
  'import_batches',
  'webhook_events',
  'bank_accounts',
  'bank_connections',
  'accounts',
  'sessions',
  'verification_tokens',
  'users',
];

/**
 * Opens one connection for the file, applies the migrations, and empties every
 * table before each test so no case can depend on another's rows.
 */
export function useTestDb(): () => Database {
  let db: Database;

  beforeAll(async () => {
    await runMigrations(url as string);
    db = createDb(url as string, { max: 1 });
  });

  beforeEach(async () => {
    await db.execute(sql.raw(`truncate table ${TABLES.join(', ')} restart identity cascade`));
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  return () => db;
}

let ownerSequence = 0;

/**
 * Auth.js owns the `users` table in the application; the tests stand in for it
 * because every other table's `owner_id` points here.
 */
export async function createOwner(db: Database, email?: string): Promise<string> {
  ownerSequence += 1;
  const [row] = await db
    .insert(users)
    .values({ email: email ?? `owner-${ownerSequence}@example.test`, name: 'Test Owner' })
    .returning({ id: users.id });
  return row.id;
}
