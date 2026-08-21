import Credentials from 'next-auth/providers/credentials';
import { splitEmails, type RawEnv } from '@/src/env';

/**
 * The test-only sign-in door.
 *
 * The Playwright suite has to get past the locked door to test anything behind
 * it, and it cannot complete a GitHub OAuth handshake. So `E2E=1` adds a
 * second provider that takes an email address, no password, and signs it in if
 * - and only if - it is on `ALLOWED_EMAILS`. A door with no lock on it, which
 * is why every line below is about where it may not exist.
 *
 * Two independent guards, either of which alone is enough:
 *
 * 1. `assertProductionSecurity` (src/env.ts) refuses to boot a production
 *    deployment with `E2E` set, so the process never serves a request.
 * 2. `e2eCredentialsProvider()` throws when `NODE_ENV=production`, so even a
 *    build that somehow skipped the boot assertion cannot assemble the
 *    provider.
 *
 * They are independent on purpose: the first is a check on the environment and
 * the second is a check on the runtime, and the ways of defeating one are not
 * ways of defeating the other.
 */

/** The provider id. `signIn(E2E_PROVIDER_ID, ...)` and nothing else uses it. */
export const E2E_PROVIDER_ID = 'e2e';

/**
 * Whether the door is asked for. Deliberately *not* also checking `NODE_ENV`:
 * if this returned false in production then the throw below would be
 * unreachable, and a guard that cannot fire is not a guard.
 */
export function isE2eSignInEnabled(raw: RawEnv = process.env): boolean {
  return raw.E2E === '1';
}

/**
 * Whether this address may come through the test door: the door has to be
 * open, this has to not be production, and the address has to be on the same
 * allow list a GitHub sign-in is checked against. The allow list is not
 * relaxed for tests - an E2E run configures `ALLOWED_EMAILS` like any other
 * deployment.
 */
export function isE2eEmailAllowed(
  email: string | null | undefined,
  raw: RawEnv = process.env
): boolean {
  if (!isE2eSignInEnabled(raw)) return false;
  if (raw.NODE_ENV === 'production') return false;

  const address = email?.trim().toLowerCase();
  if (!address) return false;

  return splitEmails(raw.ALLOWED_EMAILS).includes(address);
}

/** Guard 2. Thrown, not returned: there is no sensible way to carry on. */
export class E2eProviderInProductionError extends Error {
  constructor() {
    super(
      'Refusing to build the E2E sign-in provider: NODE_ENV is production. ' +
        'It signs in an allow-listed address with no password and exists only for the Playwright suite. ' +
        'Unset E2E.'
    );
    this.name = 'E2eProviderInProductionError';
  }
}

/** What `authorize` hands back: the address, folded, as a user-shaped object. */
export interface E2eSignInUser {
  id: string;
  email: string;
  name: string;
}

/**
 * The whole of the door's decision, as a function, so a test can ask it
 * directly rather than reaching into a provider object.
 *
 * It returns the address rather than a user row: this module has no database
 * (it is imported from `auth.config.ts`, which must stay importable where
 * Postgres is not). Turning the address into a real user and a real database
 * session is `lib/e2eSession.ts`'s job.
 */
export function authorizeE2eSignIn(
  credentials: Partial<Record<string, unknown>> | undefined
): E2eSignInUser | null {
  const email = typeof credentials?.email === 'string' ? credentials.email : '';
  if (!isE2eEmailAllowed(email)) return null;

  const address = email.trim().toLowerCase();
  return { id: address, email: address, name: address };
}

/** The provider itself. Call it only when `isE2eSignInEnabled()` is true. */
export function e2eCredentialsProvider() {
  if (process.env.NODE_ENV === 'production') throw new E2eProviderInProductionError();

  return Credentials({
    id: E2E_PROVIDER_ID,
    name: 'End-to-end test sign-in',
    credentials: { email: { label: 'Email', type: 'email' } },
    authorize: authorizeE2eSignIn,
  });
}
