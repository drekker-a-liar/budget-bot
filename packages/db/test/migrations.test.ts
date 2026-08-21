import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/client';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate';
import { describeDb } from './helpers/db';

/**
 * The committed SQL is what runs in production - `drizzle-kit push` is never
 * used (spec §5) - so it is worth reading directly, not only through drizzle.
 */
describe('the committed migrations', () => {
  const files = readdirSync(MIGRATIONS_FOLDER).filter((name) => name.endsWith('.sql'));
  const sqlText = files
    .map((name) => readFileSync(join(MIGRATIONS_FOLDER, name), 'utf8'))
    .join('\n');

  it('are committed, not generated at deploy time', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('create the deduplication index as a partial one', () => {
    // The risk this pins: if drizzle-kit ever drops the predicate, the index
    // becomes a plain unique one and a second hand-entered transaction - every
    // one of which has a null external id - would be rejected.
    expect(sqlText).toContain(
      'CREATE UNIQUE INDEX "transactions_provider_account_external_key" ON "transactions" USING btree ("provider","bank_account_id","external_id") WHERE "external_id" IS NOT NULL;'
    );
    expect(sqlText).toContain('WHERE "external_id" IS NOT NULL');
  });

  it('scopes every child table to its project by owner, not by project alone', () => {
    for (const table of ['invoices', 'labor_entries', 'transactions']) {
      expect(sqlText).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_project_id_owner_id_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id")`
      );
    }
    expect(sqlText).toContain('CONSTRAINT "projects_id_owner_key" UNIQUE("id","owner_id")');
  });

  it('nulls only project_id when a project is deleted', () => {
    // The risk this pins: drizzle-kit cannot emit the column list, so it is
    // hand-written. Re-generating the migration silently drops it, and a bare
    // SET NULL would try to null `owner_id` too and fail its NOT NULL - which
    // would surface as "cannot delete a project", far from its cause.
    expect(sqlText).toContain(
      'REFERENCES "public"."projects"("id","owner_id") ON DELETE set null ("project_id")'
    );
  });

  it('never uses a floating point type for money', () => {
    expect(sqlText).not.toMatch(/\b(real|double precision|float)\b/i);
    expect(sqlText).toMatch(/"amount_cents" bigint/);
  });
});

describeDb('applying the migrations', () => {
  let db: Database;
  const url = process.env.DATABASE_URL_TEST as string;

  beforeAll(async () => {
    db = createDb(url, { max: 1 });
    // From scratch: an empty database, exactly what a new self-hoster has.
    // The bookkeeping table goes too - drizzle keeps it in its own schema, and
    // leaving it behind would tell the migrator there was nothing to do.
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('builds the whole schema on an empty database, and again on a full one', async () => {
    await runMigrations(url);
    const first = await tableNames(db);

    // Re-running must be a no-op: the Vercel build applies migrations on every
    // deploy, most of which change nothing.
    await runMigrations(url);
    const second = await tableNames(db);

    expect(first).toContain('transactions');
    expect(first).toContain('users');
    expect(first).toContain('bank_connections');
    expect(second).toEqual(first);
  });
});

async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`
  );
  return [...rows].map((row) => row.table_name);
}
