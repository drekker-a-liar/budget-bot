import { describe, expect, it } from 'vitest';
import { assertProductionSecurity, type RawEnv } from '@/src/env';

/**
 * The boot assertion (ADR 0003, spec §7): a production deployment that is
 * missing any part of the locked door must refuse to start rather than serve
 * data. Every case below is one way to end up with an open door.
 *
 * The environment is passed in rather than stubbed on `process.env` so the
 * assertion is exercised as a function of its input, and so a case can leave a
 * variable *set* to something wrong (not just absent).
 */

const KEY_32_BYTES = Buffer.alloc(32, 7).toString('base64');
const KEY_31_BYTES = Buffer.alloc(31, 7).toString('base64');

/** A production environment with nothing wrong with it. */
function safeProduction(): RawEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:pw@db.example.com:5432/budget_bot',
    AUTH_SECRET: 'x'.repeat(32),
    AUTH_GITHUB_ID: 'Iv1.0123456789abcdef',
    AUTH_GITHUB_SECRET: 'github-oauth-client-secret',
    ALLOWED_EMAILS: 'mike@example.com',
    BANK_TOKEN_ENCRYPTION_KEY: KEY_32_BYTES,
  };
}

function failureFor(overrides: RawEnv): string {
  try {
    assertProductionSecurity({ ...safeProduction(), ...overrides });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the assertion accepted an environment it should have refused');
}

describe('assertProductionSecurity', () => {
  it('accepts a production environment that has everything', () => {
    expect(() => assertProductionSecurity(safeProduction())).not.toThrow();
  });

  it.each([
    ['AUTH_SECRET is absent', { AUTH_SECRET: undefined }, /AUTH_SECRET/],
    ['AUTH_SECRET is too short to be a real secret', { AUTH_SECRET: 'x'.repeat(31) }, /AUTH_SECRET/],
    ['the GitHub client id is absent', { AUTH_GITHUB_ID: undefined }, /AUTH_GITHUB_ID/],
    ['the GitHub client secret is absent', { AUTH_GITHUB_SECRET: undefined }, /AUTH_GITHUB_SECRET/],
    ['nobody is on the allow list', { ALLOWED_EMAILS: undefined }, /ALLOWED_EMAILS/],
    ['the allow list is only separators', { ALLOWED_EMAILS: ' , ' }, /ALLOWED_EMAILS/],
    [
      'the bank token key is absent',
      { BANK_TOKEN_ENCRYPTION_KEY: undefined },
      /BANK_TOKEN_ENCRYPTION_KEY/,
    ],
    [
      'the bank token key is 31 bytes rather than 32',
      { BANK_TOKEN_ENCRYPTION_KEY: KEY_31_BYTES },
      /BANK_TOKEN_ENCRYPTION_KEY/,
    ],
    [
      'the bank token key is not base64 at all',
      { BANK_TOKEN_ENCRYPTION_KEY: 'not base64 ***' },
      /BANK_TOKEN_ENCRYPTION_KEY/,
    ],
    [
      'a development owner override is still set',
      { DEV_OWNER_EMAIL: 'mike@example.com' },
      /DEV_OWNER_EMAIL/,
    ],
    [
      'Plaid is live but the cron endpoint has no shared secret',
      { PLAID_ENV: 'production' },
      /CRON_SECRET/,
    ],
    [
      'the end-to-end sign-in door is open',
      { E2E: '1' },
      /E2E/,
    ],
    [
      'the end-to-end door is set to something that is not an off switch',
      { E2E: 'true' },
      /E2E/,
    ],
  ])('refuses to start when %s', (_name, overrides, expected) => {
    expect(failureFor(overrides)).toMatch(expected);
  });

  /**
   * `.env.example` ships `E2E=0`, and a self-hoster who pastes that file into
   * a deployment's variables should get a running deployment rather than a
   * boot failure about a door that is shut.
   */
  it('lets an explicitly disabled E2E flag through', () => {
    expect(() => assertProductionSecurity({ ...safeProduction(), E2E: '0' })).not.toThrow();
  });

  it('lets Plaid sandbox run without a cron secret', () => {
    expect(() =>
      assertProductionSecurity({ ...safeProduction(), PLAID_ENV: 'sandbox' })
    ).not.toThrow();
  });

  it('names every failing check at once, so one restart shows the whole list', () => {
    const message = failureFor({
      AUTH_SECRET: undefined,
      ALLOWED_EMAILS: undefined,
      BANK_TOKEN_ENCRYPTION_KEY: undefined,
    });

    expect(message).toMatch(/AUTH_SECRET/);
    expect(message).toMatch(/ALLOWED_EMAILS/);
    expect(message).toMatch(/BANK_TOKEN_ENCRYPTION_KEY/);
  });

  it('never repeats a secret back in the failure message', () => {
    const message = failureFor({
      AUTH_SECRET: 'short-but-secret',
      AUTH_GITHUB_SECRET: undefined,
      BANK_TOKEN_ENCRYPTION_KEY: 'wrong-length-but-secret',
    });

    expect(message).not.toContain('short-but-secret');
    expect(message).not.toContain('wrong-length-but-secret');
  });

  it('does nothing in development, where none of this is configured yet', () => {
    expect(() => assertProductionSecurity({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('does nothing under test, so the suite does not need production secrets', () => {
    expect(() => assertProductionSecurity({ NODE_ENV: 'test' })).not.toThrow();
  });
});
