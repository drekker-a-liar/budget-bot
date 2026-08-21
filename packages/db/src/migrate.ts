import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createSqlClient } from './client';

/**
 * Applying the committed migrations. This is the only way schema changes ever
 * reach a database: `drizzle-kit push` is never used, so what ran in CI is
 * exactly what runs in production (spec §5).
 */

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  // One connection: the migrator runs statements in order and a pool would
  // only add a way for them to interleave.
  const client = createSqlClient(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
