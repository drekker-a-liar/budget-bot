import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, Session, User } from 'next-auth';
import type { AdapterUser } from 'next-auth/adapters';
import { authConfig } from '@/auth.config';
import { fetchGithubProfile } from '@/lib/githubProfile';
import { resetEnvCache } from '@/src/env';

/**
 * Who is allowed in (ADR 0003).
 *
 * The allow list is the whole access control model for this deployment, and it
 * is checked in the `signIn` callback specifically because that runs *before*
 * Auth.js creates the user row - a rejected sign-in must leave nothing behind.
 */

function githubProfile(overrides: Record<string, unknown> = {}): Profile {
  return {
    id: 42,
    login: 'mike',
    name: 'Mike',
    avatar_url: 'https://avatars.example.com/mike.png',
    email: 'mike@example.com',
    email_verified: true,
    ...overrides,
  } as unknown as Profile;
}

const signIn = authConfig.callbacks.signIn;

async function allows(profile: Profile): Promise<boolean> {
  const verdict = await signIn({
    user: { id: 'user-1' } as User,
    account: null,
    profile,
  });
  return verdict === true;
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:5433/budget_bot');
  vi.stubEnv('ALLOWED_EMAILS', 'mike@example.com, bookkeeper@example.com');
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

describe('the sign-in callback', () => {
  it('lets in an address on the allow list', async () => {
    await expect(allows(githubProfile())).resolves.toBe(true);
  });

  it('lets in the second address on the list, not just the first', async () => {
    await expect(
      allows(githubProfile({ email: 'bookkeeper@example.com' }))
    ).resolves.toBe(true);
  });

  it('turns away an address nobody put on the list', async () => {
    await expect(allows(githubProfile({ email: 'stranger@example.com' }))).resolves.toBe(false);
  });

  it('turns away an address GitHub has not verified', async () => {
    await expect(
      allows(githubProfile({ email: 'mike@example.com', email_verified: false }))
    ).resolves.toBe(false);
  });

  it('turns away a GitHub account with no usable address at all', async () => {
    await expect(
      allows(githubProfile({ email: null, email_verified: false }))
    ).resolves.toBe(false);
  });

  it('ignores the casing GitHub happens to send', async () => {
    await expect(allows(githubProfile({ email: 'Mike@Example.COM' }))).resolves.toBe(true);
  });

  it('ignores the casing and spacing the allow list was written in', async () => {
    vi.stubEnv('ALLOWED_EMAILS', '  MIKE@example.com ,, bookkeeper@Example.com  ');
    resetEnvCache();

    await expect(allows(githubProfile())).resolves.toBe(true);
  });

  it('turns everyone away when the allow list is empty', async () => {
    vi.stubEnv('ALLOWED_EMAILS', '');
    resetEnvCache();

    await expect(allows(githubProfile())).resolves.toBe(false);
  });
});

describe('the session callback', () => {
  /** What a database session really hands the callback: two whole rows. */
  const rows = {
    session: {
      sessionToken: 'a-session-token',
      userId: 'user-1',
      expires: new Date('2026-09-01T00:00:00.000Z'),
    } as unknown as Session,
    user: {
      id: 'user-1',
      name: 'Mike',
      email: 'mike@example.com',
      image: null,
      emailVerified: null,
      settings: { timeZone: 'America/Los_Angeles' },
    } as unknown as AdapterUser,
  };

  it('puts the user id on the session, which is what scopes every query', async () => {
    const session = await authConfig.callbacks.session(rows as never);

    expect(session.user.id).toBe('user-1');
    expect(session.user.email).toBe('mike@example.com');
    expect(session.expires).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not hand the session token back to the browser', async () => {
    // `/api/auth/session` serves this as JSON. The token lives in an httpOnly
    // cookie precisely so that script cannot read it.
    const session = await authConfig.callbacks.session(rows as never);

    expect(JSON.stringify(session)).not.toContain('a-session-token');
  });

  it('carries only the user columns the client needs', async () => {
    const session = await authConfig.callbacks.session(rows as never);

    expect(Object.keys(session.user).sort()).toEqual(['email', 'id', 'image', 'name']);
  });
});

describe('resolving the GitHub address to check', () => {
  /**
   * GitHub's `/user` returns the *public* profile address, which may be absent
   * and never says whether it was verified. Auth.js's stock provider only
   * falls back to the address list when the public one is missing, and takes
   * the primary one whether or not it is verified - so this deployment asks
   * for the list every time and insists on both.
   */
  function stubGithub(user: unknown, emails: unknown, emailsOk = true) {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/user/emails')
        ? { ok: emailsOk, json: async () => emails }
        : { ok: true, json: async () => user }
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('takes the primary verified address, not the public profile one', async () => {
    stubGithub({ id: 42, login: 'mike', email: 'public@example.com' }, [
      { email: 'noise@example.com', primary: false, verified: true },
      { email: 'mike@example.com', primary: true, verified: true },
    ]);

    const profile = await fetchGithubProfile('gho_token');

    expect(profile.email).toBe('mike@example.com');
    expect(profile.email_verified).toBe(true);
  });

  it('asks for the address list even when the public profile has one', async () => {
    const fetchMock = stubGithub({ id: 42, login: 'mike', email: 'public@example.com' }, [
      { email: 'mike@example.com', primary: true, verified: true },
    ]);

    await fetchGithubProfile('gho_token');

    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
      'https://api.github.com/user/emails'
    );
  });

  it('reports no address when the primary one is unverified', async () => {
    stubGithub({ id: 42, login: 'mike', email: null }, [
      { email: 'mike@example.com', primary: true, verified: false },
    ]);

    const profile = await fetchGithubProfile('gho_token');

    expect(profile.email).toBeNull();
    expect(profile.email_verified).toBe(false);
  });

  it('reports no address when GitHub refuses the list, rather than guessing', async () => {
    stubGithub({ id: 42, login: 'mike', email: 'public@example.com' }, [], false);

    const profile = await fetchGithubProfile('gho_token');

    expect(profile.email).toBeNull();
    expect(profile.email_verified).toBe(false);
  });

  it('never sends the access token anywhere but api.github.com', async () => {
    const fetchMock = stubGithub({ id: 42, login: 'mike', email: null }, []);

    await fetchGithubProfile('gho_token');

    for (const [url] of fetchMock.mock.calls) {
      expect(url.startsWith('https://api.github.com/')).toBe(true);
    }
  });
});
