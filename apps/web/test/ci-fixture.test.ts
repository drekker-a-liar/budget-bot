import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertProductionSecurity, type RawEnv } from '@/src/env';

/**
 * `ci/env.production.fixture` is a committed file full of values that look like
 * secrets, which is a thing worth being nervous about.
 *
 * It has to look like that: CI feeds it to the boot assertion to prove the
 * assertion *accepts* a complete production environment, and an assertion
 * nobody has watched accept anything might be refusing everything. So the file
 * needs a client id shaped like GitHub's and base64 that really is 32 bytes.
 *
 * What keeps it honest is two things that do not depend on each other.
 * `.gitleaks.toml` exempts exactly two literals by value and no file by path,
 * so anything else secret-shaped pasted in here is still a finding. And this
 * file pins every value: change one and the test says so, whether or not
 * gitleaks would have recognised what it changed into.
 */

const FIXTURE = fileURLToPath(new URL('../../../ci/env.production.fixture', import.meta.url));

/** `KEY=value` lines, comments and blanks dropped. */
function parseFixture(): RawEnv {
  const entries = readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match): [string, string] => [match[1], match[2]]);
  return Object.fromEntries(entries);
}

const fixture = parseFixture();

/** Anything whose name says it holds a credential. */
const SECRET_SHAPED = /SECRET|KEY|TOKEN|PASSWORD/i;

/**
 * The documented dummies, in full. Written out rather than pattern-matched:
 * the point is that these exact strings are what is in the file, so a real
 * value replacing one of them fails here even if it happens to be the same
 * shape.
 */
const EXPECTED_DUMMIES: Record<string, string> = {
  AUTH_SECRET: 'notnotnotnotnotnotnotnotnotnotnot',
  AUTH_GITHUB_SECRET: 'notarealgithuboauthclientsecret0',
  BANK_TOKEN_ENCRYPTION_KEY: 'bm90LWEtcmVhbC1rZXktLW5vdC1hLXJlYWwta2V5MzI=',
};

/** Not secret-shaped by name, but exempted in `.gitleaks.toml`, so pinned too. */
const GITHUB_CLIENT_ID = 'Iv1.0123456789abcdef';

describe('the CI production fixture', () => {
  it('was parsed, rather than read as an empty file', () => {
    expect(Object.keys(fixture).length).toBeGreaterThan(5);
  });

  it('holds the documented dummy for every secret-shaped variable, and no others', () => {
    const secrets = Object.keys(fixture).filter((name) => SECRET_SHAPED.test(name));

    // A new secret-shaped variable has to be added to EXPECTED_DUMMIES on
    // purpose, which is a moment for somebody to look at what it contains.
    expect(secrets.sort()).toEqual(Object.keys(EXPECTED_DUMMIES).sort());

    for (const [name, value] of Object.entries(EXPECTED_DUMMIES)) {
      expect(fixture[name], `${name} is not the documented dummy`).toBe(value);
    }
  });

  it('pins the GitHub client id that gitleaks is told to ignore', () => {
    // `.gitleaks.toml` exempts this literal by value. If the fixture stopped
    // using it, the exemption would be pointing at nothing - and worse, this
    // key would be scanned without anyone noticing it had changed.
    expect(fixture.AUTH_GITHUB_ID).toBe(GITHUB_CLIENT_ID);
    expect(GITHUB_CLIENT_ID).toMatch(/^Iv1\.0123456789abcdef$/);
  });

  it('carries an encryption key that is demonstrably a sentence, not entropy', () => {
    // The strongest thing that can be said about a committed base64 blob: it
    // decodes to readable English that says what it is. A generated key would
    // not survive this.
    const decoded = Buffer.from(fixture.BANK_TOKEN_ENCRYPTION_KEY ?? '', 'base64');

    expect(decoded.toString('utf8')).toBe('not-a-real-key--not-a-real-key32');
    // And it is still exactly what the boot assertion measures.
    expect(decoded.length).toBe(32);
  });

  it('never turns the end-to-end door on', () => {
    expect(fixture.E2E).toBe('0');
  });

  it('keeps Plaid in sandbox, so no cron secret is implied', () => {
    expect(fixture.PLAID_ENV).toBe('sandbox');
    expect(fixture.CRON_SECRET).toBeUndefined();
  });
});

/**
 * The same two runs CI makes of `pnpm check:security`, as a unit test.
 *
 * Worth having here as well as in CI: this calls the assertion directly with
 * the fixture and nothing else, so it says something about the fixture even on
 * a machine whose shell has half a production environment exported into it.
 * What the *script* judges - and that it never quietly adds a `.env` of its
 * own to it - is pinned separately, in `check-security.test.ts`.
 */
describe('the boot assertion, judging the fixture', () => {
  const production: RawEnv = { ...fixture, NODE_ENV: 'production' };

  it('accepts it, which is what proves the assertion accepts anything', () => {
    expect(() => assertProductionSecurity(production)).not.toThrow();
  });

  it('refuses it with the allow list taken away', () => {
    expect(() =>
      assertProductionSecurity({ ...production, ALLOWED_EMAILS: undefined })
    ).toThrow(/ALLOWED_EMAILS/);
  });

  it('refuses it with the test door propped open', () => {
    expect(() => assertProductionSecurity({ ...production, E2E: '1' })).toThrow(/E2E/);
  });
});
