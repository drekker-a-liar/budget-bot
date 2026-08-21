import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from '@/lib/publicPaths';

/**
 * The cheap half of the locked door (ADR 0003, spec §7).
 *
 * This runs on the Edge, where the database is unreachable, so it cannot tell
 * a valid session from a stale cookie - only that there is no point sending
 * someone further without one. The authoritative check is `auth()`, which
 * every route handler calls; nothing here is load-bearing for authorization.
 *
 * It is hand-written rather than `NextAuth(authConfig).auth` because an API
 * caller needs a 401 it can act on and a browser needs a redirect it can
 * follow, and that is two lines here against a wrapper to argue with.
 */

/**
 * Auth.js names the session cookie after the deployment's scheme: the
 * `__Secure-` prefix over HTTPS, bare over plain HTTP in development.
 */
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // The matcher already excludes these; checking again means a mistake in that
  // one regex cannot put the sign-in page behind a redirect to itself.
  if (isPublicPath(pathname) || hasSessionCookie(request)) {
    return NextResponse.next();
  }

  // A `fetch` cannot do anything useful with a 302 to an HTML page - it
  // follows it and reports success - so machine callers get a status instead.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signIn = new URL('/login', request.nextUrl);
  signIn.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(signIn, 302);
}

export const config = {
  // Kept in step with lib/publicPaths.ts by test/middleware.test.ts: Next
  // parses this file at build time and cannot follow an import to get here.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth|api/webhooks/plaid|api/health|privacy|login).*)'],
};
