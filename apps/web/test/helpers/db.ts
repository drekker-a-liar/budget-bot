import { fileURLToPath } from 'node:url';
import { createDb, createSqlClient, schema, type Database } from '@budget-bot/db';
import { runMigrations } from '@budget-bot/db/migrate';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

/**
 * The harness for the tests in this app that need a real Postgres, which for
 * now means the sync service.
 *
 * Deliberately the same shape as `packages/db/test/helpers/db.ts` - probe,
 * skip with a reason, migrate once, truncate between cases - because they are
 * the same job and two harnesses that drifted would be two ways of being
 * wrong. It is a copy rather than an import: `packages/db` exports four entry
 * points and none of them is its test tree, and opening one so an app could
 * reach into another package's tests would be a worse dependency than thirty
 * duplicated lines.
 *
 * ## Its own database, not the db package's
 *
 * `turbo test` runs every package's suite at once, so `@budget-bot/db` and
 * this app would otherwise be truncating the same tables at the same time -
 * each one deleting rows the other was in the middle of asserting on, and
 * failing in a way that looks like a bug in the sync service. So this appends
 * `_web` to whatever database `DATABASE_URL_TEST` names and creates it on
 * first use. Nothing has to be added to CI for that: the suite provisions
 * itself, and skips with a message if it cannot.
 */

/** The monorepo's root `.env`, the way the db scripts read it. Already-set wins. */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // No .env checked out - CI puts the variables in the environment.
}

/** `DATABASE_URL_TEST`, pointed at this app's own database. */
function webTestUrl(): string | undefined {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) return undefined;
  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!name) return undefined;
  url.pathname = `/${encodeURIComponent(`${name}_web`)}`;
  return url.toString();
}

const url = webTestUrl();

/**
 * Creates the database if it is not there. `CREATE DATABASE` cannot run inside
 * the database being created, so this goes through the server's default one -
 * the same route `packages/db`'s `db:test:setup` script takes.
 */
async function ensureDatabase(target: string): Promise<void> {
  const name = decodeURIComponent(new URL(target).pathname.slice(1));
  const maintenance = new URL(target);
  maintenance.pathname = '/postgres';

  const client = createSqlClient(maintenance.toString(), { max: 1 });
  try {
    const existing = await client`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) {
      // The name is derived from a URL a developer wrote and CREATE DATABASE
      // takes no parameters, so it is quoted as an identifier.
      await client.unsafe(`create database "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

async function probe(): Promise<string | null> {
  if (!url) return 'DATABASE_URL_TEST is not set (see .env.example)';
  try {
    await ensureDatabase(url);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return `the Postgres in DATABASE_URL_TEST is unreachable (${message || code || 'unknown error'}); try \`pnpm db:up\``;
  }

  const client = createSqlClient(url, { max: 1 });
  try {
    await client`select 1`;
    return null;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return `${url.replace(/\/\/[^@]*@/, '//')} is unreachable (${message || code || 'unknown error'})`;
  } finally {
    await client.end();
  }
}

const skipReason = await probe();

/** `describe`, unless there is no database, in which case it says why. */
export function describeDb(name: string, suite: () => void): void {
  if (skipReason === null) {
    describe(name, suite);
  } else {
    describe.skip(`${name} [skipped: ${skipReason}]`, suite);
  }
}

/** Every table these tests write to, ordered so a truncate cascade is enough. */
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

export function useTestDb(): () => Database {
  let db: Database;

  beforeAll(async () => {
    await runMigrations(url as string);
    db = createDb(url as string, { max: 1 });
  });

  beforeEach(async () => {
    // Through the driver rather than through drizzle: `drizzle-orm` is not a
    // dependency of this app, and adding one so a test can write `sql.raw`
    // would be a strange reason to take on an ORM.
    await db.$client.unsafe(
      `truncate table ${TABLES.join(', ')} restart identity cascade`
    );
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  return () => db;
}

/**
 * Runs `fn` with the sync advisory lock for `connectionId` held by *another*
 * session, which is what a second sync arriving mid-run looks like from the
 * inside. The blocking form rather than the `try` one: nothing else holds it
 * when this is called, so it is taken immediately, and a silent failure to
 * take it would turn the test it is written for into one that asserts nothing.
 */
export async function holdSyncLock<T>(
  connectionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const client = createSqlClient(url as string, { max: 1 });
  try {
    return (await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${connectionId}))`;
      return fn();
    })) as T;
  } finally {
    await client.end();
  }
}

let ownerSequence = 0;

/** Auth.js owns `users` in the application; the tests stand in for it. */
export async function createOwner(db: Database, email?: string): Promise<string> {
  ownerSequence += 1;
  const [row] = await db
    .insert(schema.users)
    .values({ email: email ?? `web-owner-${ownerSequence}@example.test`, name: 'Test Owner' })
    .returning({ id: schema.users.id });
  return row.id;
}
