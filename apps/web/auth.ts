import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb, schema, seedOwner } from '@budget-bot/db';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
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
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,

  adapter: DrizzleAdapter(getDb(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),

  session: { strategy: 'database' },

  // Vercel and every self-hosted target put the app behind a proxy, so the
  // forwarded host is the only host there is.
  trustHost: true,

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
}));
