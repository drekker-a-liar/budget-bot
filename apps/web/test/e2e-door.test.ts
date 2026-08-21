import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, User } from 'next-auth';
import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';
import { authConfig } from '@/auth.config';
import {
  E2E_PROVIDER_ID,
  E2eProviderInProductionError,
  authorizeE2eSignIn,
  e2eCredentialsProvider,
  isE2eEmailAllowed,
  isE2eSignInEnabled,
} from '@/lib/e2eProvider';
import { mintE2eDatabaseSession } from '@/lib/e2eSession';

/**
 * The test-only sign-in door (spec §7).
 *
 * A provider that signs someone in without a password is the one thing in this
 * repository that must be impossible to reach in production, so what is
 * asserted here is mostly the ways it refuses: with the flag off, with an
 * address nobody allow-listed, and - twice over, by two mechanisms that do not
 * depend on each other - in production.
 *
 * The boot assertion, which is the other guard, is in `test/env.test.ts`.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const ALLOWED = 'mike@example.com';

/** A development environment with the door open. */
function doorOpen(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'development',
    E2E: '1',
    ALLOWED_EMAILS: `${ALLOWED}, bookkeeper@example.com`,
    ...overrides,
  };
}

describe('whether the door exists at all', () => {
  it.each([
    ['1', true],
    ['0', false],
    [undefined, false],
    ['true', false],
    ['', false],
  ])('E2E=%s opens it: %s', (value, expected) => {
    expect(isE2eSignInEnabled({ E2E: value })).toBe(expected);
  });

  it('does not consult NODE_ENV, so the production guard below can still fire', () => {
    // If this returned false in production the throw would be unreachable, and
    // a guard that cannot fire is not a guard.
    expect(isE2eSignInEnabled({ E2E: '1', NODE_ENV: 'production' })).toBe(true);
  });
});

describe('who may come through it', () => {
  it('lets in an address on the allow list', () => {
    expect(isE2eEmailAllowed(ALLOWED, doorOpen())).toBe(true);
  });

  it('ignores casing and spacing on both sides', () => {
    expect(isE2eEmailAllowed('  MIKE@Example.COM ', doorOpen({ ALLOWED_EMAILS: ' mike@EXAMPLE.com ' }))).toBe(
      true
    );
  });

  it('turns away an address nobody allow-listed', () => {
    expect(isE2eEmailAllowed('stranger@example.com', doorOpen())).toBe(false);
  });

  it('turns away an empty allow list', () => {
    expect(isE2eEmailAllowed(ALLOWED, doorOpen({ ALLOWED_EMAILS: '' }))).toBe(false);
  });

  it.each([undefined, null, '', '   '])('turns away %o as an address', (email) => {
    expect(isE2eEmailAllowed(email, doorOpen())).toBe(false);
  });

  it('turns everyone away when the door is shut', () => {
    expect(isE2eEmailAllowed(ALLOWED, doorOpen({ E2E: '0' }))).toBe(false);
  });

  it('turns everyone away in production, flag or no flag', () => {
    expect(isE2eEmailAllowed(ALLOWED, doorOpen({ NODE_ENV: 'production' }))).toBe(false);
  });
});

describe('building the provider', () => {
  it('refuses outright in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('E2E', '1');

    expect(() => e2eCredentialsProvider()).toThrow(E2eProviderInProductionError);
  });

  it('says why, in a message an operator can act on', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => e2eCredentialsProvider()).toThrow(/Unset E2E/);
  });

  it('builds outside production, carrying the id and the decision above', () => {
    vi.stubEnv('NODE_ENV', 'development');

    // `Credentials()` returns a stub whose top-level `id` is always
    // "credentials" and puts what was asked for in `options`, which is where
    // Auth.js reads it back from. So that is what is asserted.
    const provider = e2eCredentialsProvider() as unknown as {
      options: { id: string; authorize: unknown };
    };

    expect(provider.options.id).toBe(E2E_PROVIDER_ID);
    expect(provider.options.authorize).toBe(authorizeE2eSignIn);
  });
});

describe('the provider authorizing a sign-in', () => {
  function authorize(email: unknown) {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('E2E', '1');
    vi.stubEnv('ALLOWED_EMAILS', ALLOWED);
    return authorizeE2eSignIn({ email });
  }

  it('returns the allow-listed address, folded, as the user to sign in', () => {
    expect(authorize('MIKE@Example.com')).toEqual({
      id: ALLOWED,
      email: ALLOWED,
      name: ALLOWED,
    });
  });

  it('returns nothing for an address nobody allow-listed', () => {
    expect(authorize('stranger@example.com')).toBeNull();
  });

  it('returns nothing when no email was posted at all', () => {
    expect(authorizeE2eSignIn(undefined)).toBeNull();
  });

  it('returns nothing for a value that is not a string', () => {
    expect(authorize({ toString: () => ALLOWED })).toBeNull();
  });
});

describe('the sign-in callback, which every provider passes through', () => {
  function verdict(provider: string, email: string, env: Record<string, string | undefined> = {}) {
    for (const [key, value] of Object.entries(doorOpen(env))) vi.stubEnv(key, value);
    return authConfig.callbacks.signIn({
      user: { id: email, email } as User,
      account: { provider, type: 'credentials', providerAccountId: email } as Account,
      profile: undefined,
    });
  }

  it('lets an allow-listed address through the test door', async () => {
    expect(await verdict(E2E_PROVIDER_ID, ALLOWED)).toBe(true);
  });

  it('checks the allow list again here, not only in authorize', async () => {
    expect(await verdict(E2E_PROVIDER_ID, 'stranger@example.com')).toBe(false);
  });

  it('refuses the test door in production even for an allow-listed address', async () => {
    expect(await verdict(E2E_PROVIDER_ID, ALLOWED, { NODE_ENV: 'production' })).toBe(false);
  });

  it('refuses the test door when the flag is off', async () => {
    expect(await verdict(E2E_PROVIDER_ID, ALLOWED, { E2E: '0' })).toBe(false);
  });

  it('still refuses a GitHub sign-in that carries no verified profile', async () => {
    // The E2E branch must not have become an escape hatch for the other one.
    expect(await verdict('github', ALLOWED)).toBe(false);
  });
});

describe('minting the session the app can actually read', () => {
  /** Just the three methods `mintE2eDatabaseSession` uses, recording calls. */
  function fakeAdapter(existing: AdapterUser | null) {
    const created: AdapterUser[] = [];
    const sessions: AdapterSession[] = [];
    const adapter = {
      getUserByEmail: vi.fn(async () => existing),
      createUser: vi.fn(async (user: AdapterUser) => {
        const row = { ...user, id: 'generated-user-id' };
        created.push(row);
        return row;
      }),
      createSession: vi.fn(async (session: AdapterSession) => {
        sessions.push(session);
        return session;
      }),
    } as unknown as Adapter;
    return { adapter, created, sessions };
  }

  const existingUser = {
    id: 'user-1',
    email: ALLOWED,
    emailVerified: null,
    name: 'Mike',
  } as AdapterUser;

  /** Minting re-checks the door itself, so the door has to be open. */
  beforeEach(() => {
    for (const [key, value] of Object.entries(doorOpen())) vi.stubEnv(key, value);
  });

  it('opens a session for a user who already exists', async () => {
    const { adapter, created, sessions } = fakeAdapter(existingUser);

    const token = await mintE2eDatabaseSession(adapter, ALLOWED);

    expect(created).toEqual([]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('user-1');
    expect(sessions[0].sessionToken).toBe(token);
  });

  it('creates the user first when this is the first sign-in', async () => {
    const { adapter, created, sessions } = fakeAdapter(null);

    await mintE2eDatabaseSession(adapter, ALLOWED);

    expect(created).toHaveLength(1);
    expect(created[0].email).toBe(ALLOWED);
    expect(sessions[0].userId).toBe('generated-user-id');
  });

  it('looks the user up by the folded address, so casing cannot fork the books', async () => {
    const { adapter } = fakeAdapter(existingUser);

    await mintE2eDatabaseSession(adapter, '  MIKE@Example.COM  ');

    expect(adapter.getUserByEmail).toHaveBeenCalledWith(ALLOWED);
  });

  it('returns a token that is not guessable from the address', async () => {
    const { adapter } = fakeAdapter(existingUser);

    const token = await mintE2eDatabaseSession(adapter, ALLOWED);

    expect(token).not.toContain(ALLOWED);
    expect(token.length).toBeGreaterThan(20);
  });

  it('dates the session in the future', async () => {
    const { adapter, sessions } = fakeAdapter(existingUser);
    const now = new Date('2026-08-20T00:00:00.000Z');

    await mintE2eDatabaseSession(adapter, ALLOWED, now);

    expect(sessions[0].expires.getTime()).toBeGreaterThan(now.getTime());
  });

  it('refuses an empty address rather than inventing a user', async () => {
    const { adapter, created } = fakeAdapter(null);

    await expect(mintE2eDatabaseSession(adapter, '  ')).rejects.toThrow(/no email/i);
    expect(created).toEqual([]);
  });

  it('says which adapter methods it needed when they are missing', async () => {
    await expect(mintE2eDatabaseSession({} as Adapter, ALLOWED)).rejects.toThrow(/createSession/);
  });

  /**
   * This function creates a user and hands out a session, which is the whole of
   * what signing in means. It must therefore be safe read on its own, not only
   * safe because of who happens to call it - so it asks the same three
   * questions the provider asked, again.
   */
  describe('asking the door for itself', () => {
    it('refuses an address nobody allow-listed', async () => {
      const { adapter, created, sessions } = fakeAdapter(null);

      await expect(
        mintE2eDatabaseSession(adapter, 'stranger@example.com')
      ).rejects.toThrow(/ALLOWED_EMAILS/);
      expect(created).toEqual([]);
      expect(sessions).toEqual([]);
    });

    it('refuses when the flag is off, even for an allow-listed address', async () => {
      vi.stubEnv('E2E', '0');
      const { adapter, created, sessions } = fakeAdapter(existingUser);

      await expect(mintE2eDatabaseSession(adapter, ALLOWED)).rejects.toThrow(/E2E door/);
      expect(created).toEqual([]);
      expect(sessions).toEqual([]);
    });

    it('refuses in production, flag or no flag', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { adapter, sessions } = fakeAdapter(existingUser);

      await expect(mintE2eDatabaseSession(adapter, ALLOWED)).rejects.toThrow();
      expect(sessions).toEqual([]);
    });

    it('never quotes the address back, because this message reaches logs', async () => {
      const { adapter } = fakeAdapter(null);

      const error = await mintE2eDatabaseSession(adapter, 'stranger@example.com').catch(
        (thrown: Error) => thrown
      );

      expect((error as Error).message).not.toContain('stranger@example.com');
    });
  });
});
