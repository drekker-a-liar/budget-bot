/**
 * What is reachable without a session, in one place (spec §7).
 *
 * The middleware matcher and the allow list the middleware itself checks are
 * built from the same array, because the failure mode of them disagreeing is
 * an unprotected page rather than a broken build.
 */

/**
 * Path prefixes the middleware matcher excludes, written the way Next wants
 * them: no leading slash, and `favicon.ico`'s dot left as a regex wildcard,
 * which is how the framework's own example writes it.
 *
 * `privacy` and `api/webhooks/plaid` have no route yet. They are excluded now
 * so that adding them in a later phase is not a change to this boundary, which
 * is the kind of change that deserves review.
 */
const MIDDLEWARE_EXCLUSIONS = [
  '_next/static',
  '_next/image',
  'favicon.ico',
  'api/auth',
  'api/webhooks/plaid',
  'api/health',
  'privacy',
  'login',
] as const;

/**
 * The paths the middleware never runs on. Every other request needs a session
 * cookie to get past it.
 */
export const MIDDLEWARE_MATCHER = `/((?!${MIDDLEWARE_EXCLUSIONS.join('|')}).*)`;

/**
 * The application surface that is public - the static-asset exclusions above
 * are not part of it. Middleware checks this as well as relying on the
 * matcher, so a mistake in one regex is not the only thing standing between a
 * visitor and the sign-in page.
 */
export const PUBLIC_PATHS = [
  '/login',
  '/privacy',
  '/api/auth',
  '/api/webhooks/plaid',
  '/api/health',
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
