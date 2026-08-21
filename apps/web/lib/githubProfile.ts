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
  const userResponse = await fetch(`${GITHUB_API}/user`, { headers });
  const profile = (userResponse.ok ? await userResponse.json() : {}) as GitHubProfile;

  const emailsResponse = userResponse.ok
    ? await fetch(`${GITHUB_API}/user/emails`, { headers })
    : undefined;
  const emails = (emailsResponse?.ok ? await emailsResponse.json() : []) as GithubEmail[];
  const primary = emails.find((entry) => entry.primary && entry.verified);

  return { ...profile, email: primary?.email ?? null, email_verified: Boolean(primary) };
}
