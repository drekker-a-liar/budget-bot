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

/**
 * The four variables a live Plaid deployment has to have together. Spread into
 * a case and then taken apart one at a time, so each test says which single
 * missing variable it is about.
 */
function livePlaid(): RawEnv {
  return {
    PLAID_ENV: 'production',
    PLAID_CLIENT_ID: 'plaid-client-id',
    PLAID_SECRET: 'plaid-secret',
    CRON_SECRET: 'cron-shared-secret-of-32-or-more-chars',
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
      { ...livePlaid(), CRON_SECRET: undefined },
      /CRON_SECRET/,
    ],
    [
      'the cron secret is too short to resist guessing',
      { CRON_SECRET: 'x'.repeat(31) },
      /CRON_SECRET/,
    ],
    ['there is no database', { DATABASE_URL: undefined }, /DATABASE_URL/],
    [
      'Plaid is live but has no client id',
      { ...livePlaid(), PLAID_CLIENT_ID: undefined },
      /PLAID_CLIENT_ID/,
    ],
    [
      'Plaid is live but has no secret',
      { ...livePlaid(), PLAID_SECRET: undefined },
      /PLAID_SECRET/,
    ],
    /**
     * The one Plaid check that is about a value being *present and wrong*
     * rather than absent. A production deployment pointed at Sandbox shows
     * fabricated transactions as if they were the owner's money, and every
     * other check here would pass while it did.
     */
    ['Plaid is pointed at Sandbox', { PLAID_ENV: 'sandbox' }, /PLAID_ENV/],
    /**
     * The same rule from the other side. The provider factory builds a
     * Sandbox client whenever `PLAID_ENV` does not say `production`, so
     * credentials with no `PLAID_ENV` would reach Sandbox from production
     * without ever tripping the check above.
     */
    [
      'Plaid has credentials but no environment',
      { PLAID_ENV: undefined, PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' },
      /PLAID_ENV/,
    ],
    [
      'Plaid has half a credential pair and no environment',
      { PLAID_ENV: undefined, PLAID_CLIENT_ID: 'id' },
      /PLAID_ENV/,
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

  /**
   * The three states `PLAID_ENV` can be in, and what each one means here.
   *
   * Unset is "Plaid is not configured", which is a real deployment: the
   * connections screen degrades to its not-configured state rather than
   * throwing (spec §7), so nothing about banking is required. `production` is
   * "Plaid is live", which drags in the credentials and the cron secret. And
   * `sandbox` in production is refused outright, previews included (they boot
   * with `NODE_ENV=production` and get no exemption): a preview leaves the
   * Plaid variables unset, and Sandbox is for local development only.
   */
  it('accepts a production deployment that is not using Plaid at all', () => {
    const raw = safeProduction();
    expect(raw.PLAID_ENV).toBeUndefined();
    expect(() => assertProductionSecurity(raw)).not.toThrow();
  });

  it('accepts a production deployment with Plaid fully configured', () => {
    expect(() =>
      assertProductionSecurity({ ...safeProduction(), ...livePlaid() })
    ).not.toThrow();
  });

  it('refuses Sandbox in production, and says why in the message', () => {
    const message = failureFor({ PLAID_ENV: 'sandbox' });

    expect(message).toMatch(/PLAID_ENV/);
    expect(message).toMatch(/must not talk to Plaid Sandbox/i);
  });

  it('refuses Sandbox even when everything else about Plaid is present', () => {
    // The credentials being there is not a reason to let it through: a
    // Sandbox client id and secret are exactly what a misconfigured
    // production deployment would have.
    expect(failureFor({ ...livePlaid(), PLAID_ENV: 'sandbox' })).toMatch(/PLAID_ENV/);
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
