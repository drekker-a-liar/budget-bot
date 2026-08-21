import type { Adapter } from 'next-auth/adapters';

/**
 * Turning an authorized E2E sign-in into a real database session.
 *
 * Auth.js issues a *JWT* for a credentials sign-in - unconditionally, whatever
 * `session.strategy` says - and this deployment reads sessions from Postgres
 * (ADR 0003). A credentials cookie would therefore be a cookie the session
 * lookup does not recognise, and the test suite would sign in to nothing.
 *
 * So the `jwt.encode` hook is replaced for E2E runs with this: it writes a
 * `sessions` row and returns its token, and the token is what lands in the
 * cookie. From that point the app is exercising exactly the session mechanism
 * a GitHub sign-in produces - same table, same lookup, same `auth()` - which
 * is the whole point of testing against it.
 *
 * With `strategy: 'database'`, `jwt.encode` is reached by the credentials
 * branch of the callback endpoint and by nothing else; OAuth's state, PKCE and
 * nonce cookies are sealed with `@auth/core`'s own encoder, not this one.
 */

/** Matches Auth.js's default session lifetime. */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The Auth.js adapter methods this needs. Spelled out because `Adapter`'s are
 * all optional, and a missing one here should say which rather than be a
 * "not a function" at sign-in.
 */
type SessionMintingAdapter = Required<Pick<Adapter, 'getUserByEmail' | 'createUser' | 'createSession'>>;

function requireMethods(adapter: Adapter): SessionMintingAdapter {
  const { getUserByEmail, createUser, createSession } = adapter;
  if (!getUserByEmail || !createUser || !createSession) {
    throw new Error('The E2E sign-in needs an adapter with getUserByEmail, createUser and createSession.');
  }
  return { getUserByEmail, createUser, createSession };
}

/**
 * Finds or creates the user for `email` and opens a session for them.
 *
 * The user is created here rather than left to Auth.js because Auth.js only
 * creates one on an OAuth sign-in, and a first E2E run has no user yet. It is
 * the same row a GitHub sign-in would have made: the seed script, which
 * refuses to invent a user of its own, finds it by address afterwards.
 */
export async function mintE2eDatabaseSession(
  adapter: Adapter,
  email: string | null | undefined,
  now: Date = new Date()
): Promise<string> {
  const { getUserByEmail, createUser, createSession } = requireMethods(adapter);

  const address = email?.trim().toLowerCase();
  if (!address) throw new Error('The E2E sign-in produced no email address to sign in.');

  const user =
    (await getUserByEmail(address)) ??
    (await createUser({
      // The `users` table generates its own id; the adapter drops this one.
      id: crypto.randomUUID(),
      email: address,
      emailVerified: null,
      name: address,
    }));

  const sessionToken = crypto.randomUUID();
  await createSession({
    sessionToken,
    userId: user.id,
    expires: new Date(now.getTime() + SESSION_MAX_AGE_MS),
  });

  return sessionToken;
}
