import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * The database handle. `postgres` (postgres.js) rather than a provider-specific
 * driver, so the same code runs against the docker-compose Postgres, a Neon
 * pooler, and anything else a self-hoster points `DATABASE_URL` at (spec §2).
 * Every repository takes one of these as its first argument.
 */
export type Database = ReturnType<typeof drizzle<typeof schema, postgres.Sql>>;

/** A transaction opened from a `Database`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything that can run a query: the connection, or a transaction on it. */
export type Executor = Database | Transaction;

export interface CreateDbOptions {
  /**
   * Serverless functions each hold their own pool, and Neon's pooler counts
   * every one of them, so this stays small.
   */
  max?: number;
}

export function createSqlClient(url: string, options: CreateDbOptions = {}) {
  return postgres(url, {
    max: options.max ?? 5,
    // Transaction-mode poolers (pgbouncer, Neon's) do not keep the session
    // state a named prepared statement needs, and would fail on reuse.
    prepare: false,
    onnotice: () => {},
  });
}

export function createDb(url: string, options: CreateDbOptions = {}): Database {
  return drizzle(createSqlClient(url, options), { schema });
}

let singleton: Database | undefined;

/**
 * The application's connection, opened the first time something asks for it.
 * Lazy because importing this module must not require a database - the build,
 * the tests that do not touch Postgres, and the JSON store path all import
 * things that transitively reach here.
 */
export function getDb(): Database {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set; see .env.example');
    }
    singleton = createDb(url);
  }
  return singleton;
}

/** Closes the singleton, if one was ever opened. For scripts and tests. */
export async function closeDb(): Promise<void> {
  if (!singleton) return;
  await singleton.$client.end();
  singleton = undefined;
}
