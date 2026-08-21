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
