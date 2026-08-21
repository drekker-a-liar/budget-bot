import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Session } from 'next-auth';

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

/** Every `app/api` route, with a request each of its methods will accept. */
const routes: Array<[string, Promise<Record<string, unknown>>, string]> = [
  ['/api/data', import('@/app/api/data/route'), 'http://localhost/api/data'],
  ['/api/projects', import('@/app/api/projects/route'), 'http://localhost/api/projects'],
  [
    '/api/projects/[id]',
    import('@/app/api/projects/[id]/route'),
    'http://localhost/api/projects/p1',
  ],
  [
    '/api/transactions',
    import('@/app/api/transactions/route'),
    'http://localhost/api/transactions?id=t1',
  ],
  [
    '/api/transactions/import',
    import('@/app/api/transactions/import/route'),
    'http://localhost/api/transactions/import',
  ],
  ['/api/labor', import('@/app/api/labor/route'), 'http://localhost/api/labor?id=l1'],
  ['/api/invoices', import('@/app/api/invoices/route'), 'http://localhost/api/invoices'],
];

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function requestFor(method: string, url: string): Request {
  const hasBody = method !== 'GET' && method !== 'DELETE';
  return new Request(url, {
    method,
    ...(hasBody && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    }),
  });
}

const handlers: Array<[string, Handler, Request]> = [];
for (const [path, moduleImport, url] of routes) {
  const module = await moduleImport;
  for (const method of METHODS) {
    const handler = module[method];
    if (typeof handler === 'function') {
      handlers.push([`${method} ${path}`, handler as Handler, requestFor(method, url)]);
    }
  }
}

beforeEach(() => {
  authMock.mockResolvedValue(null);
  store.getAll.mockClear();
  store.getProjects.mockClear();
});

describe('with no session', () => {
  it('found the handlers, so this test is not checking an empty list', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(13);
  });

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
    const { GET } = await import('@/app/api/projects/route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(storeFor).toHaveBeenCalledWith('user-1');
    expect(store.getProjects).toHaveBeenCalled();
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
