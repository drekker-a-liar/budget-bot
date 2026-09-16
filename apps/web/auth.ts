import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb, schema, seedOwner } from '@budget-bot/db';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import { isE2eSignInEnabled } from '@/lib/e2eProvider';
import { mintE2eDatabaseSession } from '@/lib/e2eSession';
import { stripAccountTokens } from '@/lib/stripAccountTokens';
import { env } from '@/src/env';

/**
 * The half of Auth.js that needs Postgres (ADR 0003).
 *
 * Sessions live in the database rather than in a JWT: revoking one is a delete,
 * an allow-list change takes effect on the next request instead of whenever the
 * last token expires, and the cost - one query per request - is nothing at one
 * user.
 *
 * The configuration is built per request rather than at module load so that
 * importing `auth()` never opens a connection. A build, and every test that
 * mocks this module, would otherwise need a reachable database.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const drizzleAdapter = DrizzleAdapter(getDb(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  });

  // The GitHub token is used once, transiently, to fetch the verified
  // profile during sign-in; nothing ever reads it back from `accounts`, so
  // it is stripped before the row is written - a database dump must not
  // hand over a live GitHub credential (Phase 5 audit; ADR 0002 makes the
  // same argument for bank tokens).
  const adapter = {
    ...drizzleAdapter,
    linkAccount: (account: Parameters<typeof stripAccountTokens>[0]) =>
      drizzleAdapter.linkAccount!(stripAccountTokens(account)),
  };

  return {
    ...authConfig,

    adapter,

    session: { strategy: 'database' },

    // Vercel and every self-hosted target put the app behind a proxy, so the
    // forwarded host is the only host there is.
    trustHost: true,

    /**
     * Only ever reached by the E2E credentials sign-in, and only when that door
     * is open at all: with a database strategy nothing else in Auth.js encodes a
     * JWT. It writes a real `sessions` row and puts its token in the cookie, so
     * the test suite exercises the same session mechanism GitHub produces rather
     * than a JWT the app cannot read. See lib/e2eSession.ts.
     */
    ...(isE2eSignInEnabled() && {
      jwt: { encode: ({ token }) => mintE2eDatabaseSession(adapter, token?.email) },
    }),

    events: {
      /**
       * A fresh deployment signs in to an empty dashboard, which is a poor way
       * to find out whether anything works. `SEED_DEMO=1` fills the first
       * sign-in with the demo fixtures; it is off unless someone asks for it,
       * and it only ever runs for a user Auth.js has just created.
       */
      async createUser({ user }) {
        if (env.SEED_DEMO !== '1' || !user.id) return;
        await seedOwner(getDb(), user.id);
      },
    },
  };
});
