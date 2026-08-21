import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the API routes refuse to do.
 *
 * The two development shortcuts this file used to pin - resolving the owner
 * from `DEV_OWNER_EMAIL`, and a reset action that deleted every row an owner
 * had - are both gone, replaced by the Auth.js session and `pnpm db:seed`.
 * What is left is the other half of the cross-owner fix: the database refuses
 * a write that names someone else's project, and the route has to report that
 * as the caller's mistake rather than as a fault of its own.
 *
 * Whether a route needs a session at all is `test/route-gating.test.ts`.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1' }, expires: '2026-09-01' })),
}));

const db = vi.hoisted(() => ({ createLaborEntry: vi.fn() }));

vi.mock('@/lib/db', () => ({ storeFor: () => db }));

const { POST: createLabor } = await import('@/app/api/labor/route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a write naming another owner’s project', () => {
  it('is a 400 rather than a 500, because the caller sent something wrong', async () => {
    const { UnknownProjectError } = await import('@budget-bot/db');
    db.createLaborEntry.mockImplementation(async () => {
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
