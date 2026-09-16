import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertProductionSecurity, type RawEnv } from '../src/env';

/**
 * `pnpm check:security`: the boot assertion, run on purpose rather than by
 * accident at 3am on a deploy.
 *
 * `NODE_ENV` is forced to production because the point is to judge the
 * variables a production deployment would get - run it against the output of
 * `vercel env pull --environment=production`, or against a shell that has the
 * same variables exported.
 *
 * ## One input, and it is named out loud
 *
 * This used to load the repository's `.env` first, and could therefore print
 * "safe to deploy to production" about an environment that was missing
 * `ALLOWED_EMAILS`, because the developer's own `.env` supplied it. The only
 * mistake this tool can make is saying *yes* too often, so it has exactly one
 * input and no hidden ones:
 *
 *   pnpm check:security                  # judges process.env
 *   pnpm check:security --from .env      # judges that file, and nothing else
 *
 * A file, when one is given, is judged *instead of* the environment rather
 * than merged with it - a variable exported in the shell must not be able to
 * complete a file that a deployment will get incomplete. Either way the source
 * and the variable names are printed before the verdict, so the operator can
 * see what was judged.
 *
 * The flag is `--from` rather than `--env-file` because node 24 scans the
 * whole command line for its own `--env-file` option and reports a missing
 * path itself, before this script runs. A relative path is resolved against
 * the directory the command was typed in (`INIT_CWD`, which pnpm sets), not
 * against `apps/web`, so `pnpm check:security --from .env` works from the
 * repository root the way every document spells it.
 */

/** Every variable `assertProductionSecurity` reads. Names only, ever. */
const CHECKED = [
  'ALLOWED_EMAILS',
  'AUTH_GITHUB_ID',
  'AUTH_GITHUB_SECRET',
  'AUTH_SECRET',
  'BANK_TOKEN_ENCRYPTION_KEY',
  'CRON_SECRET',
  'DATABASE_URL',
  'DEV_OWNER_EMAIL',
  'E2E',
  'PLAID_CLIENT_ID',
  'PLAID_ENV',
  'PLAID_SECRET',
] as const;

class UsageError extends Error {}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** `--from <path>`, or nothing. Anything else is a mistake worth stopping for. */
function readArgs(argv: string[]): { envFile: string | null } {
  let envFile: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--from') {
      throw new UsageError(
        `Unrecognised argument '${argv[i]}'. Usage: check-security [--from <path>]`
      );
    }
    const path = argv[i + 1];
    if (!path) {
      throw new UsageError('--from needs a path after it, e.g. --from .env');
    }
    envFile = resolve(process.env.INIT_CWD ?? process.cwd(), path);
    i += 1;
  }

  return { envFile };
}

/**
 * `KEY=value` lines, the way `vercel env pull` writes them: comments, blank
 * lines, `export ` prefixes and surrounding quotes are all things a real
 * pulled file contains. Deliberately small - this reads one file to judge it,
 * it is not a dotenv implementation, and nothing here is loaded into
 * `process.env`.
 */
function parseEnvFile(path: string): RawEnv {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`Cannot read ${path}: ${(error as Error).message}`);
  }

  const env: RawEnv = {};
  for (const line of contents.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, name, raw] = match;
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    env[name] = quoted ? quoted[2] : raw;
  }
  return env;
}

let source: string;
let environment: RawEnv;

try {
  const { envFile } = readArgs(process.argv.slice(2));
  source = envFile ?? 'environment only';
  environment = { ...(envFile ? parseEnvFile(envFile) : process.env), NODE_ENV: 'production' };
} catch (error) {
  if (error instanceof UsageError) fail(error.message);
  throw error;
}

const set = CHECKED.filter((name) => environment[name] !== undefined && environment[name] !== '');
const unset = CHECKED.filter((name) => !set.includes(name));

console.log(`Source: ${source}`);
console.log(`Set: ${set.length > 0 ? set.join(', ') : '(nothing this check reads)'}`);
console.log(`Not set: ${unset.length > 0 ? unset.join(', ') : '(nothing)'}`);

try {
  assertProductionSecurity(environment);
} catch (error) {
  fail((error as Error).message);
}

console.log('Security check passed: this environment is safe to deploy to production.');
