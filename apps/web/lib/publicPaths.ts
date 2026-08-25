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
 *
 * `api/internal/sync` (spec §4) is excluded for a different reason than the
 * rest: it does not authenticate by session at all. The cron safety net
 * checks a bearer token itself, so a redirect-to-login from this middleware
 * would only ever be in its way.
 */
const MIDDLEWARE_EXCLUSIONS = [
  '_next/static',
  '_next/image',
  'favicon.ico',
  'api/auth',
  'api/webhooks/plaid',
  'api/internal/sync',
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
  '/api/internal/sync',
  '/api/health',
] as const;

/**
 * A path reduced to the one form worth comparing against.
 *
 * A pathname is text the caller chooses, and Next's router normalises it
 * before it matches a route while the middleware matcher does not. So
 * `/API/data`, `//api/data`, `/api%2Fdata` and `/login/../api/data` all reach
 * this file spelled differently from the route they will actually hit. Every
 * decision here is about *which* path was asked for, so every one of them
 * makes that comparison on this form: decoded once, dot segments resolved,
 * empty segments dropped, and lower-cased.
 *
 * Only the comparison. Next's own routing and the redirect this app sends a
 * visitor back to both keep the path exactly as it arrived.
 */
export function normalizePathname(pathname: string): string {
  let decoded = pathname;
  try {
    // Once, not until it stops changing: `%252F` is a literal `%2F` in a path,
    // not a separator, and unwrapping it twice would invent one.
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is not a path this app serves. Compare what arrived
    // rather than throwing at the front door.
  }

  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join('/')}`.toLowerCase();
}

export function isPublicPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return PUBLIC_PATHS.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}
