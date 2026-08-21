import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { fetchGithubProfile, type VerifiedGithubProfile } from '@/lib/githubProfile';
import { env } from '@/src/env';

/**
 * Everything about signing in that does not need a database (ADR 0003).
 *
 * Split out from `auth.ts` because the adapter drags Postgres in with it, and
 * this half has to stay importable from anywhere. GitHub is the only provider:
 * every self-hoster of this repository already has an account there.
 *
 * `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are not read here - Auth.js fills
 * a provider's credentials from those exact names itself, at request time,
 * which keeps this module importable in a build that has no secrets.
 */
export const authConfig = {
  providers: [
    GitHub({
      userinfo: {
        url: 'https://api.github.com/user',
        async request({ tokens }: { tokens: { access_token?: string } }) {
          return fetchGithubProfile(tokens.access_token ?? '');
        },
      },
      profile(raw) {
        // `userinfo.request` above is what produced this object, so the two
        // fields the stock GitHub profile does not have are there.
        const profile = raw as VerifiedGithubProfile;
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          // Only ever a date when GitHub said the address was verified; the
          // adapter writes it to `users.email_verified`.
          emailVerified: profile.email_verified ? new Date() : null,
        };
      },
    }),
  ],

  // Both point at the one page this app has: an error is something the visitor
  // reads on their way to trying again, not a separate destination.
  pages: { signIn: '/login', error: '/login' },

  callbacks: {
    /**
     * The allow list, checked before Auth.js creates anything. Returning false
     * here means a stranger who completes the GitHub handshake still leaves no
     * `users` row, no `accounts` row and no session behind - Auth.js turns it
     * into `AccessDenied` and sends them back to `/login`.
     *
     * The address comes from `profile`, not `user`: `profile` is what GitHub
     * said this time round, so removing someone from `ALLOWED_EMAILS` locks
     * out the account they already have rather than only new ones.
     */
    signIn({ profile }) {
      const github = profile as VerifiedGithubProfile | undefined;
      if (!github?.email || !github.email_verified) return false;
      return env.ALLOWED_EMAILS.includes(github.email.toLowerCase());
    },

    /**
     * What `/api/auth/session` serves to the browser.
     *
     * Rebuilt rather than spread: for a database session Auth.js hands this
     * callback the whole `sessions` row - session token included - and the
     * whole `users` row, and returning that as-is would put the session token
     * somewhere script can read it, along with every column added to `users`
     * from now on. The user id is set explicitly because every query
     * downstream scopes itself by it.
     */
    session({ session, user }) {
      return {
        expires: new Date(session.expires).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
      };
    },
  },
} satisfies NextAuthConfig;
