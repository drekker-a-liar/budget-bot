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
      'USE_PG',
      // Conditional on PLAID_ENV, but conditional in preview too.
      'CRON_SECRET',
    ];

    for (const key of enforced) {
      const line = requiredInFor(key);
      expect(line, `${key} has no "Required in:" line`).not.toBeUndefined();
      expect(line, `${key}: ${line}`).toMatch(/preview/);
      expect(line, `${key}: ${line}`).toMatch(/prod/);
    }
  });

  it('leaves every secret blank', () => {
    const values = readFileSync(EXAMPLE, 'utf8')
      .split('\n')
      .map((line) => /^(AUTH_SECRET|AUTH_GITHUB_SECRET|CRON_SECRET|BANK_TOKEN_ENCRYPTION_KEY[A-Z_]*)=(.*)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match));

    expect(values.length).toBe(5);
    for (const [, name, value] of values) {
      expect(value, `${name} has a value in .env.example`).toBe('');
    }
  });
});
