import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the API routes refuse to do.
 *
 * Two things in the Postgres path are development scaffolding, and both would
 * be dangerous if they ever reached a deployed environment: the owner is
 * resolved from a plain environment variable rather than a session, and the
 * reset action deletes every row that owner has. Neither should be reachable
 * in production, and neither is guarded by anything but these checks until
 * Auth.js replaces the first and the reset action is deleted with the second.
 *
 * The last case is the other half of the cross-owner fix: the database refuses
 * the write, and the route has to report that as the caller's mistake.
 */

vi.mock('@/lib/db', () => ({
  db: {
    resetToSeed: vi.fn(async () => ({
      projects: [],
      transactions: [],
      laborEntries: [],
      invoices: [],
      cardProfile: null,
      version: 1,
    })),
    getAll: vi.fn(async () => ({
      projects: [],
      transactions: [],
      laborEntries: [],
      invoices: [],
      cardProfile: null,
      version: 1,
    })),
  },
}));

const { db } = await import('@/lib/db');
const { POST: postData } = await import('@/app/api/data/route');
const { pgStore } = await import('@/lib/pgStore');

const resetRequest = () =>
  new Request('http://localhost/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the reset action', () => {
  it('is refused in production rather than deleting real rows', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await postData(resetRequest());

    expect(response.status).toBe(403);
    expect(db.resetToSeed).not.toHaveBeenCalled();
  });

  it('still works in development, where the data is demo data', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await postData(resetRequest());

    expect(response.status).toBe(200);
    expect(db.resetToSeed).toHaveBeenCalledOnce();
  });
});

describe('DEV_OWNER_EMAIL owner resolution', () => {
  it('refuses to resolve an owner in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_OWNER_EMAIL', 'someone@example.com');

    await expect(pgStore.getProjects()).rejects.toThrow(/disabled in production/i);
  });

  it('refuses even when the reset path is the caller', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_OWNER_EMAIL', 'someone@example.com');

    await expect(pgStore.resetToSeed()).rejects.toThrow(/disabled in production/i);
  });
});

describe('a write naming another owner’s project', () => {
  it('is a 400 rather than a 500, because the caller sent something wrong', async () => {
    const { UnknownProjectError } = await import('@budget-bot/db');
    const { POST: createLabor } = await import('@/app/api/labor/route');
    (db as unknown as { createLaborEntry: unknown }).createLaborEntry = vi.fn(async () => {
      throw new UnknownProjectError('11111111-1111-4111-8111-111111111111');
    });

    const response = await createLabor(
      new Request('http://localhost/api/labor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: '11111111-1111-4111-8111-111111111111',
          hours: 4,
        }),
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not belong|No project/);
  });
});
