import { z } from 'zod';

/**
 * Every environment variable this repository reads, in one schema, plus the
 * boot assertion that refuses to start a production deployment with an open
 * door (ADR 0003, spec §7).
 *
 * Two separate jobs live here on purpose:
 *
 * - `env` *shapes* the variables (types, defaults, the comma list). It is
 *   permissive about what is absent, because development runs with almost
 *   none of them set.
 * - `assertProductionSecurity` *judges* them, and only in production. It reads
 *   the raw environment rather than `env` so it can complain about a variable
 *   that is set to something wrong, and about `DEV_OWNER_EMAIL`, which is not
 *   in the schema at all any more and must not come back.
 */

/** A comma-separated list, trimmed and lowercased, empties dropped. */
const emailList = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );

const flag = z.enum(['0', '1']).default('0');

export const envSchema = z.object({
  /** Postgres the app reads and writes. */
  DATABASE_URL: z.string().min(1),
  /**
   * Postgres the `packages/db` suite runs against. Never read by the app; it
   * is declared here so `.env.example` and this schema stay a single list.
   */
  DATABASE_URL_TEST: z.string().optional(),

  /** `1` while the legacy JSON file store still exists (removed in Task 5). */
  USE_PG: flag,

  /** Signs and encrypts Auth.js cookies. */
  AUTH_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  /** Only needed where Auth.js cannot infer the deployment URL itself. */
  AUTH_URL: z.string().optional(),
  /** Who may sign in. Anyone not on this list is refused before a user row exists. */
  ALLOWED_EMAILS: emailList,

  /** AES-256-GCM key for bank access tokens (ADR 0002), 32 bytes of base64. */
  BANK_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  /** Set during a rotation so tokens written under the old key still decrypt. */
  BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

  /** Which Plaid environment the bank connectors talk to (built in Phase 2). */
  PLAID_ENV: z.enum(['sandbox', 'production']).optional(),
  /** Bearer token the scheduled sync endpoint requires (built in Phase 3). */
  CRON_SECRET: z.string().optional(),

  /** `1` seeds demo fixtures for a user the first time they sign in. */
  SEED_DEMO: flag,

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Keys the runtime supplies, so `.env.example` does not document them. Next
 * sets `NODE_ENV` itself and writing it into a `.env` file breaks the dev
 * server in confusing ways.
 */
export const RUNTIME_PROVIDED_ENV_KEYS = ['NODE_ENV'] as const;

/**
 * The environment as it really arrives: every value a string or absent. Not
 * `NodeJS.ProcessEnv`, whose Next augmentation insists on `NODE_ENV`, which
 * would stop a test handing this function a two-variable environment.
 */
export type RawEnv = Record<string, string | undefined>;

export function parseEnv(raw: RawEnv = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment is not usable:\n${problems}\nSee .env.example.`);
  }
  return result.data;
}

let parsed: Env | undefined;

/**
 * The parsed environment, read the first time a property is touched. Lazy
 * because importing this module must not require a configured environment -
 * the build, and every test that never reads a variable, import it anyway.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, key) {
    parsed ??= parseEnv();
    return parsed[key as keyof Env];
  },
});

/** Drops the memoized parse. For tests that change the environment. */
export function resetEnvCache(): void {
  parsed = undefined;
}

/**
 * Whether sign-in can work at all. Deliberately a boolean and never the values
 * themselves: `/api/health` is reachable without a session.
 */
export function isAuthConfigured(raw: RawEnv = process.env): boolean {
  return Boolean(
    raw.AUTH_SECRET &&
      raw.AUTH_GITHUB_ID &&
      raw.AUTH_GITHUB_SECRET &&
      splitEmails(raw.ALLOWED_EMAILS).length > 0
  );
}

/** The allow list, however it was written. Exported so the callbacks share it. */
export function splitEmails(raw: string | undefined): string[] {
  return emailList.parse(raw ?? '');
}

const AUTH_SECRET_MIN_LENGTH = 32;
const BANK_TOKEN_KEY_BYTES = 32;

function decodesToBytes(value: string, expected: number): boolean {
  // The same rule `decodeKey` in @budget-bot/db applies at runtime: whatever
  // base64 decodes to, its length is what matters. Deliberately not stricter,
  // so this assertion never rejects a key the crypto module would accept.
  return Buffer.from(value, 'base64').length === expected;
}

/**
 * Refuses to let a production deployment start with any part of the locked
 * door missing. Reports every failing check at once - a deployment that boots,
 * fails, is fixed and fails again on the next variable wastes the one thing a
 * self-hoster has least of, which is patience.
 *
 * Never quotes a value back: this message reaches logs.
 */
export function assertProductionSecurity(raw: RawEnv = process.env): void {
  if (raw.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  if (!raw.AUTH_SECRET || raw.AUTH_SECRET.length < AUTH_SECRET_MIN_LENGTH) {
    problems.push(
      `AUTH_SECRET is missing or shorter than ${AUTH_SECRET_MIN_LENGTH} characters. Generate one with \`openssl rand -base64 32\`.`
    );
  }

  if (!raw.AUTH_GITHUB_ID) {
    problems.push('AUTH_GITHUB_ID is missing; create a GitHub OAuth app for this deployment.');
  }
  if (!raw.AUTH_GITHUB_SECRET) {
    problems.push('AUTH_GITHUB_SECRET is missing; create a GitHub OAuth app for this deployment.');
  }

  if (splitEmails(raw.ALLOWED_EMAILS).length === 0) {
    problems.push(
      'ALLOWED_EMAILS is empty; with no allow list nobody can sign in and the deployment is not protecting anything.'
    );
  }

  if (!raw.BANK_TOKEN_ENCRYPTION_KEY) {
    problems.push(
      'BANK_TOKEN_ENCRYPTION_KEY is missing. Generate one with `openssl rand -base64 32`.'
    );
  } else if (!decodesToBytes(raw.BANK_TOKEN_ENCRYPTION_KEY, BANK_TOKEN_KEY_BYTES)) {
    problems.push(
      `BANK_TOKEN_ENCRYPTION_KEY must be exactly ${BANK_TOKEN_KEY_BYTES} bytes of base64. Generate one with \`openssl rand -base64 32\`.`
    );
  }

  if (raw.PLAID_ENV === 'production' && !raw.CRON_SECRET) {
    problems.push('CRON_SECRET is missing, and PLAID_ENV=production means the sync endpoint is live.');
  }

  if (raw.USE_PG !== '1') {
    problems.push(
      'USE_PG must be 1 in production; the JSON file store is development scaffolding and holds one shared, unauthenticated copy of the books.'
    );
  }

  if (raw.DEV_OWNER_EMAIL) {
    problems.push(
      'DEV_OWNER_EMAIL must not be set; it names an owner without a session and was removed when Auth.js landed. Delete it from the environment.'
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: this production environment is not secure.\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}\nSee .env.example, and run \`pnpm check:security\` before deploying.`
    );
  }
}
