import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * What the end-to-end run is pointed at, in one place.
 *
 * Two rules shape all of it. The suite must never touch the database a
 * developer is using - it reseeds from scratch, and doing that to somebody's
 * afternoon of test data would be a bad way to introduce yourself - so it runs
 * against `DATABASE_URL_TEST`, the throwaway one `pnpm --filter @budget-bot/db
 * db:test:setup` creates. And it must not be able to run against a production
 * build: `next start` sets `NODE_ENV=production`, and the boot assertion
 * refuses to start with `E2E` set, so the server below is `next dev`.
 */

// `__dirname`, not `import.meta.url`: Playwright compiles this file to
// CommonJS, where the latter is a syntax error.
const REPO_ROOT = resolve(__dirname, '../../..');

/** The one address on the allow list for the duration of the run. */
export const E2E_EMAIL = 'e2e@example.com';

/** Reads the monorepo's root `.env`, the way every script here does. */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(`${REPO_ROOT}/.env`);
  } catch {
    // No .env checked out; CI puts the variables in the environment.
  }
}

/**
 * The database this run owns. Deliberately not `DATABASE_URL`: everything
 * here is destructive.
 */
export function e2eDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set, and the end-to-end suite reseeds whatever it is pointed at. ' +
        'See .env.example, then run `pnpm db:up && pnpm --filter @budget-bot/db db:test:setup`.'
    );
  }
  return url;
}

/**
 * The environment the app under test runs in. `AUTH_SECRET` is a fixed
 * throwaway rather than a generated one so a re-run reuses the cookies of the
 * last one instead of invalidating them.
 */
export function e2eServerEnv(): Record<string, string> {
  return {
    DATABASE_URL: e2eDatabaseUrl(),
    ALLOWED_EMAILS: E2E_EMAIL,
    AUTH_SECRET: 'end-to-end-test-secret-not-a-real-one',
    E2E: '1',
    SEED_DEMO: '0',
  };
}

/**
 * Runs one of the `@budget-bot/db` scripts against the E2E database.
 *
 * A subprocess rather than an import: those scripts are TypeScript source in a
 * workspace package, and Playwright's transform does not reach inside
 * `node_modules` to compile them.
 */
export function runDbScript(script: string, args: string[] = []): void {
  execFileSync('pnpm', ['--filter', '@budget-bot/db', script, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
  });
}
