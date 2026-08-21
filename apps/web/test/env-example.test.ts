import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUNTIME_PROVIDED_ENV_KEYS, envSchema } from '@/src/env';

/**
 * `.env.example` is the only documentation of what a self-hoster has to set,
 * and it rots the moment a variable is added to the schema without a line
 * here - or removed from the schema and left in the file, sending someone off
 * to configure something nothing reads.
 */

const EXAMPLE = fileURLToPath(new URL('../../../.env.example', import.meta.url));

function keysIn(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((key): key is string => Boolean(key))
    .sort();
}

/**
 * The `# Required in: ...` line nearest above a variable's assignment. The
 * file is comment-then-key throughout, so "nearest above" is what a reader
 * takes it to mean too.
 */
function requiredInFor(key: string): string | undefined {
  const lines = readFileSync(EXAMPLE, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index === -1) return undefined;
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (/^([A-Z][A-Z0-9_]*)=/.test(line)) return undefined;
    if (line.startsWith('# Required in:')) return line;
  }
  return undefined;
}

const documented = keysIn(EXAMPLE);
const declared = Object.keys(envSchema.shape)
  .filter((key) => !RUNTIME_PROVIDED_ENV_KEYS.includes(key as 'NODE_ENV'))
  .sort();

describe('.env.example', () => {
  it('found variables to compare, rather than an unreadable file', () => {
    expect(documented.length).toBeGreaterThan(5);
  });

  it('documents every variable the schema declares', () => {
    expect(declared.filter((key) => !documented.includes(key))).toEqual([]);
  });

  it('documents nothing the schema does not declare', () => {
    expect(documented.filter((key) => !declared.includes(key))).toEqual([]);
  });

  /**
   * `assertProductionSecurity` fires on `NODE_ENV === 'production'`, and a
   * Vercel *preview* deployment is built and run with exactly that. So every
   * unconditional check applies to previews too, and a variable annotated
   * "Required in: prod" alone sends a self-hoster to a preview that refuses to
   * boot with no idea why.
   */
  it('says preview as well as prod for everything the boot assertion insists on', () => {
    const enforced = [
      'AUTH_SECRET',
      'AUTH_GITHUB_ID',
      'AUTH_GITHUB_SECRET',
      'ALLOWED_EMAILS',
      'BANK_TOKEN_ENCRYPTION_KEY',
      // Conditional on PLAID_ENV, but conditional in preview too.
      'CRON_SECRET',
      'PLAID_CLIENT_ID',
      'PLAID_SECRET',
    ];

    for (const key of enforced) {
      const line = requiredInFor(key);
      expect(line, `${key} has no "Required in:" line`).not.toBeUndefined();
      expect(line, `${key}: ${line}`).toMatch(/preview/);
      expect(line, `${key}: ${line}`).toMatch(/prod/);
    }
  });

  /**
   * Nothing in this file may hold a secret, and the rule is applied by *shape
   * of name* rather than to a list somebody typed - a list is exactly what a
   * new `STRIPE_API_KEY=sk_live_...` would not be on.
   *
   * This is also the compensating control for `.gitleaks.toml`, which exempts
   * two literals by value and no file by path: the scanner catches anything
   * secret-shaped, and this catches a documented placeholder quietly acquiring
   * a value.
   */
  const SECRET_SHAPED = /SECRET|KEY|TOKEN|PASSWORD/i;

  function assignmentsIn(path: string): Array<[string, string]> {
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match): [string, string] => [match[1], match[2]]);
  }

  it('leaves every secret-shaped variable blank', () => {
    const secrets = assignmentsIn(EXAMPLE).filter(([name]) => SECRET_SHAPED.test(name));

    // Guards against the filter quietly matching nothing.
    expect(secrets.map(([name]) => name)).toEqual([
      'AUTH_SECRET',
      'AUTH_GITHUB_SECRET',
      'BANK_TOKEN_ENCRYPTION_KEY',
      'BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS',
      'PLAID_SECRET',
      'CRON_SECRET',
    ]);

    for (const [name, value] of secrets) {
      expect(value, `${name} has a value in .env.example`).toBe('');
    }
  });

  /**
   * The variables that are *not* secret-shaped still get looked at, because
   * "secret-shaped" is a heuristic and a connection string is a credential
   * whatever it is called. These are the four that carry a value, and each one
   * is a local default or a placeholder address.
   */
  it('carries nothing but local defaults in the variables that do have values', () => {
    const filled = assignmentsIn(EXAMPLE).filter(([, value]) => value !== '');

    expect(Object.fromEntries(filled)).toEqual({
      DATABASE_URL: 'postgres://budget_bot:budget_bot@localhost:5433/budget_bot',
      DATABASE_URL_TEST: 'postgres://budget_bot:budget_bot@localhost:5433/budget_bot_test',
      ALLOWED_EMAILS: 'you@example.com',
      SEED_DEMO: '0',
      E2E: '0',
    });
  });
});
