import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAuthConfig } from 'next-auth';
import { resetEnvCache } from '@/src/env';

/**
 * What happens the first time somebody signs in.
 *
 * A fresh deployment lands on an empty dashboard, which is a poor way to find
 * out whether anything works, so `SEED_DEMO=1` fills the new account with the
 * demo fixtures. It writes to the database, so what matters is that it is off
 * unless asked for, and that it only ever runs for a user Auth.js has just
 * created - never for one signing in again.
 *
 * `NextAuth` and `@budget-bot/db` are stubbed at the module boundary; the
 * configuration under test is the real one this app hands to Auth.js.
 */

const captured: { config?: NextAuthConfig } = {};

vi.mock('next-auth', () => ({
  default: vi.fn((factory: () => NextAuthConfig) => {
    captured.config = factory();
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
}));

vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: vi.fn(() => ({})) }));

const db = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ handle: true })),
  seedOwner: vi.fn(async () => undefined),
  schema: { users: {}, accounts: {}, sessions: {}, verificationTokens: {} },
}));

vi.mock('@budget-bot/db', () => db);

await import('@/auth');

const createUser = captured.config?.events?.createUser;

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:5433/budget_bot');
  db.seedOwner.mockClear();
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('the first sign-in', () => {
  it('is a hook Auth.js was actually given', () => {
    expect(createUser).toBeTypeOf('function');
  });

  it('seeds the new account when SEED_DEMO asks for it', async () => {
    vi.stubEnv('SEED_DEMO', '1');
    resetEnvCache();

    await createUser?.({ user: { id: 'user-1', email: 'mike@example.com' } });

    expect(db.seedOwner).toHaveBeenCalledWith({ handle: true }, 'user-1');
  });

  it('writes nothing when it does not', async () => {
    vi.stubEnv('SEED_DEMO', '0');
    resetEnvCache();

    await createUser?.({ user: { id: 'user-1', email: 'mike@example.com' } });

    expect(db.seedOwner).not.toHaveBeenCalled();
  });

  it('writes nothing when SEED_DEMO was never set at all', async () => {
    await createUser?.({ user: { id: 'user-1', email: 'mike@example.com' } });

    expect(db.seedOwner).not.toHaveBeenCalled();
  });
});

describe('the Auth.js configuration this app hands over', () => {
  it('keeps sessions in the database, so revoking one is a delete', () => {
    expect(captured.config?.session?.strategy).toBe('database');
  });

  it('trusts the forwarded host, because every target is behind a proxy', () => {
    expect(captured.config?.trustHost).toBe(true);
  });

  it('sends both sign-in and errors to the one page a stranger may see', () => {
    expect(captured.config?.pages).toEqual({ signIn: '/login', error: '/login' });
  });
});
