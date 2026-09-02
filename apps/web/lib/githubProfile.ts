import type { GitHubProfile } from 'next-auth/providers/github';

/**
 * Resolving the GitHub identity the allow list is checked against.
 *
 * `GET /user` returns the *public* profile address: it is often null, it can
 * be one the account holder never proved they own, and it never says which.
 * Auth.js's stock GitHub provider only reaches for the address list when the
 * public one is missing, and then takes the primary address whether or not it
 * is verified. An allow list checked against an unverified address is not an
 * allow list, so this asks for the list every time and insists on both flags.
 *
 * @see https://docs.github.com/en/rest/users/emails
 */

const GITHUB_API = 'https://api.github.com';

/**
 * How long either GitHub call may take before it counts as failed.
 *
 * This runs inside the OAuth callback, and a `fetch` with no signal waits on
 * a stalled connection for as long as the platform lets the function live -
 * on Vercel, a sign-in that spins until the function is killed and the owner
 * sees a bare error page with nothing to act on (Phase 5 audit). Ten seconds
 * is generous for two small JSON responses from api.github.com and well
 * inside the function's own budget.
 */
const GITHUB_TIMEOUT_MS = 10_000;

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * GitHub's profile with two fields this application owns: `email` narrowed to
 * the primary *verified* address, and the flag saying whether there was one.
 */
export type VerifiedGithubProfile = GitHubProfile & {
  email: string | null;
  email_verified: boolean;
};

/**
 * One GitHub call, or `null` when it did not succeed: a non-2xx answer, a
 * connection that failed, or the timeout above. All three land on the same
 * `null` on purpose. The caller's rule is that either call failing means "no
 * verified address" - a refusal the allow list already handles - and a
 * timeout that surfaced as a thrown `TimeoutError` instead would be a second,
 * different failure for the sign-in flow to render, with nothing more useful
 * to say.
 */
async function githubGet(path: string, headers: HeadersInit): Promise<Response | null> {
  try {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

export async function fetchGithubProfile(accessToken: string): Promise<VerifiedGithubProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'budget-bot',
  };

  // Either call failing means "no verified address", never a fall back to the
  // public profile one - that fallback is the case this function exists to
  // close. A revoked or throttled token answers 401 here with a JSON error
  // body, and parsing it anyway would hand the allow-list check an object to
  // guess at, so the status is what decides.
  const userResponse = await githubGet('/user', headers);
  const profile = (userResponse ? await userResponse.json() : {}) as GitHubProfile;

  const emailsResponse = userResponse ? await githubGet('/user/emails', headers) : null;
  const emails = (emailsResponse ? await emailsResponse.json() : []) as GithubEmail[];
  const primary = emails.find((entry) => entry.primary && entry.verified);

  return { ...profile, email: primary?.email ?? null, email_verified: Boolean(primary) };
}
