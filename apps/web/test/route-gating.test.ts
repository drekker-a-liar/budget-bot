import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Session } from 'next-auth';
import { apiRoutes } from './helpers/appRoutes';
import { isPublicPath } from '@/lib/publicPaths';

/**
 * Every route handler asks `auth()`, not the middleware (ADR 0003).
 *
 * Middleware is a cookie check on the Edge and could be bypassed by anything
 * that reaches a function directly - another Vercel deployment alias, a
 * misconfigured matcher, a future `rewrite`. So the rule this pins is: with no
 * session, no handler in `app/api` returns anything but a 401. It walks the
 * exported methods rather than a list written by hand, because the way this
 * breaks is somebody adding a handler and not thinking about it.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

const emptySnapshot = {
  projects: [],
  transactions: [],
  laborEntries: [],
  invoices: [],
  cardProfile: null,
  version: 1,
};

const store = {
  getAll: vi.fn(async () => emptySnapshot),
  getProjects: vi.fn(async () => []),
  getProjectById: vi.fn(async () => undefined),
  getTransactions: vi.fn(async () => []),
  getLaborEntries: vi.fn(async () => []),
  getInvoices: vi.fn(async () => []),
};

vi.mock('@/lib/db', () => ({ storeFor: vi.fn(() => store) }));

const { auth } = await import('@/auth');

/**
 * `auth()` is overloaded - a session lookup and a middleware wrapper - and the
 * mock only ever stands in for the first, so it is narrowed once here rather
 * than at each call.
 */
type AuthMock = Mock<() => Promise<Session | null>>;
const authMock = auth as unknown as AuthMock;

const SIGNED_IN: Session = {
  user: { id: 'user-1', email: 'mike@example.com' },
  expires: '2026-09-01',
};

type Handler = (request: Request, context: { params: { id: string } }) => Promise<Response>;

/**
 * Every route on disk, split by whether it is public on purpose.
 *
 * Derived rather than listed: a list somebody types is exactly what a new
 * `app/api/export/route.ts` would not appear on, and that route would then be
 * the one nothing here asserts calls `auth()`.
 */
const routes = apiRoutes();
const publicRoutes = routes.filter((route) => isPublicPath(route.path));
const gatedRoutes = routes.filter((route) => !isPublicPath(route.path));

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function requestFor(method: string, path: string): Request {
  const hasBody = method !== 'GET' && method !== 'DELETE';
  return new Request(`http://localhost${path}?id=x`, {
    method,
    ...(hasBody && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    }),
  });
}

const handlers: Array<[string, Handler, Request]> = [];
for (const route of gatedRoutes) {
  const module: Record<string, unknown> = await import(/* @vite-ignore */ route.file);
  for (const method of METHODS) {
    const handler = module[method];
    if (typeof handler === 'function') {
      handlers.push([`${method} ${route.path}`, handler as Handler, requestFor(method, route.path)]);
    }
  }
}

beforeEach(() => {
  authMock.mockResolvedValue(null);
  for (const method of Object.values(store)) method.mockClear();
});

describe('the route list this test walks', () => {
  it('came off disk, and is not empty', () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.map((route) => route.path)).toContain('/api/import/csv');
  });

  it('accounts for every route.ts under app/api, with none skipped', () => {
    expect(publicRoutes.length + gatedRoutes.length).toBe(routes.length);
  });

  it('treats exactly two routes as reachable without a session', () => {
    // Auth.js's own endpoints are how a session is made, and the health check
    // exists to be asked by something that has none. Anything else appearing
    // here is a new hole, and this is where it gets noticed.
    expect(publicRoutes.map((route) => route.path)).toEqual([
      '/api/auth/sample',
      '/api/health',
    ]);
  });

  it('found a handler for every gated route, and several methods', () => {
    const covered = new Set(handlers.map(([name]) => name.split(' ')[1]));
    expect([...covered].sort()).toEqual(gatedRoutes.map((route) => route.path));
    expect(handlers.length).toBeGreaterThan(gatedRoutes.length);
  });
});

describe('with no session', () => {

  it.each(handlers)('%s answers 401', async (_name, handler, request) => {
    const response = await handler(request.clone(), { params: { id: 'p1' } });

    expect(response.status).toBe(401);
  });

  it.each(handlers)('%s reads nothing before refusing', async (_name, handler, request) => {
    await handler(request.clone(), { params: { id: 'p1' } });

    for (const method of Object.values(store)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});

describe('with a session', () => {
  it('a read reaches the store, scoped to the signed-in user', async () => {
    authMock.mockResolvedValue(SIGNED_IN);
    const { storeFor } = await import('@/lib/db');
    const { GET } = await import('@/app/api/labor/route');

    const response = await GET(requestFor('GET', '/api/labor'));

    expect(response.status).toBe(200);
    expect(storeFor).toHaveBeenCalledWith('user-1');
    expect(store.getLaborEntries).toHaveBeenCalled();
  });
});

describe('the health endpoint', () => {
  it('answers without a session, because that is what it is for', async () => {
    const { GET } = await import('@/app/api/health/route');

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it('says whether sign-in is configured without saying what with', async () => {
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(32));
    vi.stubEnv('AUTH_GITHUB_ID', 'Iv1.abc');
    vi.stubEnv('AUTH_GITHUB_SECRET', 'shhh');
    vi.stubEnv('ALLOWED_EMAILS', 'mike@example.com');
    const { GET } = await import('@/app/api/health/route');

    const body = await GET().json();

    expect(body).toEqual({ ok: true, authConfigured: true });
    vi.unstubAllEnvs();
  });
});
