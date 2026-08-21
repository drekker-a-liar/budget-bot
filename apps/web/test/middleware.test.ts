import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from '@/middleware';
import { MIDDLEWARE_MATCHER, isPublicPath, normalizePathname } from '@/lib/publicPaths';

/**
 * The outer half of the locked door (ADR 0003).
 *
 * Middleware runs on the Edge, where the database is out of reach, so all it
 * can honestly say is "there is no session cookie, do not bother". That is a
 * hint, not the check - `auth()` in each route handler is the authority - but
 * it is what decides whether a browser gets a sign-in page or a REST client
 * gets a 401 it can act on.
 */

const SESSION_COOKIE = 'authjs.session-token';
const SECURE_SESSION_COOKIE = '__Secure-authjs.session-token';

const ORIGIN = 'https://books.example.com';

/**
 * Concatenated rather than resolved against a base: `new URL('//api/data',
 * origin)` is a protocol-relative URL and would quietly become host `api`,
 * which is not the doubled separator these cases are about.
 */
function request(path: string, cookie?: string): NextRequest {
  const req = new NextRequest(new URL(`${ORIGIN}${path}`));
  if (cookie) req.cookies.set(cookie, 'a-session-token');
  return req;
}

describe('a request with no session cookie', () => {
  it('sends a browser to the sign-in page', () => {
    const response = middleware(request('/projects'));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
  });

  it('tells the sign-in page where the visitor was heading', () => {
    const response = middleware(request('/projects/abc?tab=labor'));

    const location = new URL(response.headers.get('location') as string);
    expect(location.searchParams.get('callbackUrl')).toBe('/projects/abc?tab=labor');
  });

  it('answers an API call with 401 JSON rather than a redirect a fetch cannot follow', async () => {
    const response = middleware(request('/api/projects'));

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});

describe('a request that carries a session cookie', () => {
  it.each([SESSION_COOKIE, SECURE_SESSION_COOKIE])('is passed through (%s)', (cookie) => {
    const response = middleware(request('/projects', cookie));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

/**
 * The 302-vs-401 split and the allow list are both decisions about *which*
 * path was asked for, and a path arrives as text a caller chooses. Next's
 * router normalises before it matches; the matcher regex does not, so all of
 * these reach the middleware spelled differently from the route they hit.
 *
 * Getting this wrong is not a hole on its own - every handler calls `auth()`
 * regardless - but it hands a machine caller a 302 to an HTML page, which a
 * `fetch` follows and reports as success.
 */
describe('a path spelled unusually', () => {
  it.each([
    ['/API/data', 'upper case'],
    ['/apI/data', 'mixed case'],
    ['//api/data', 'a doubled separator'],
    ['/api%2Fdata', 'an encoded separator'],
    ['/api/./data', 'a dot segment'],
    ['/login/../api/data', 'a parent segment climbing out of a public path'],
    ['/api/health/../data', 'a parent segment climbing out of the health check'],
  ])('%s (%s) is still an API call, so it gets 401 rather than a redirect', async (path) => {
    const response = middleware(request(path));

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it.each([
    ['/login/../api/data', '/api/data'],
    ['/api/health/../data', '/api/data'],
    ['/API/HEALTH/../DATA', '/api/data'],
  ])('%s is not public, however it is spelled', (path, resolved) => {
    expect(normalizePathname(path)).toBe(resolved);
    expect(isPublicPath(path)).toBe(false);
  });

  it('leaves a genuinely public path public', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('//login')).toBe(true);
    expect(isPublicPath('/api/auth/callback/github')).toBe(true);
  });

  it('survives a malformed escape rather than throwing at the door', () => {
    expect(() => normalizePathname('/api/%ZZ')).not.toThrow();
    expect(middleware(request('/api/%ZZ')).status).toBe(401);
  });
});

describe('the split between a redirect and a 401', () => {
  it('is decided by the path, not by what the caller says it accepts', () => {
    // Documented on purpose: a browser navigating to `/projects` and a script
    // fetching it with `Accept: application/json` get the same 302. The path
    // is the only thing the Edge can trust to mean "this is a machine call".
    const req = new NextRequest(new URL(`${ORIGIN}/projects`), {
      headers: { Accept: 'application/json' },
    });

    expect(middleware(req).status).toBe(302);
  });
});

describe('the public paths', () => {
  it.each(['/login', '/privacy', '/api/health', '/api/auth/signin', '/api/webhooks/plaid'])(
    '%s is reachable without a session',
    (path) => {
      const response = middleware(request(path));

      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  );

  it('are excluded by the matcher too, so middleware is not even invoked', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    for (const path of ['/login', '/privacy', '/api/health', '/api/auth/callback/github']) {
      expect(matcher.test(path)).toBe(false);
    }
    expect(matcher.test('/')).toBe(true);
    expect(matcher.test('/projects')).toBe(true);
  });

  it('are the only thing the matcher and the allow list disagree about', () => {
    // Next reads `config.matcher` by parsing this file at build time, so the
    // pattern has to be a literal there rather than an import. This is what
    // stops the literal and the list it was built from drifting apart.
    expect(config.matcher).toEqual([MIDDLEWARE_MATCHER]);
  });
});
