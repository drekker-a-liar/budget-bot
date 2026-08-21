import { beforeEach, describe, expect, it, vi } from 'vitest';

// The session and the store are stubbed at the module boundary: these tests
// are about how a route reads money out of a request body, not about who is
// signed in or about persistence. Every assertion is on the route's response
// or on the cents value handed to the store, both of which are real behaviour.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1' }, expires: '2026-09-01' })),
}));

const db = vi.hoisted(() => ({
  createLaborEntry: vi.fn((input: object) => ({ ...input, id: 'lab-1', createdAt: 'now' })),
  createTransaction: vi.fn((input: object) => ({ ...input, id: 'tx-1', createdAt: 'now' })),
}));

vi.mock('@/lib/db', () => ({ storeFor: () => db }));
const { POST: createLabor } = await import('@/app/api/labor/route');
const { POST: createTransaction } = await import('@/app/api/transactions/route');

const post = (body: unknown) =>
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('money fields in API routes', () => {
  it.each([
    [
      'labor',
      createLabor,
      { projectId: 'proj-1', hours: 4, hourlyRate: 'eighty five' },
      'Invalid amount for hourlyRate',
    ],
    [
      'transactions',
      createTransaction,
      { description: 'HOME DEPOT', amount: '' },
      'Invalid amount for amount',
    ],
  ])(
    '%s: an unparseable amount is a 400 naming the field, not a 500 and not a silent zero',
    async (_name, handler, body, message) => {
      const response = await handler(post(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: message });
    }
  );

  // The regression this contract exists to stop: every route but one wrapped
  // the value in `Number(...)` first, so a comma-formatted amount became NaN
  // and then `|| 0` stored it as $0 with no complaint.
  it('reads a comma-formatted amount instead of storing zero', async () => {
    const response = await createTransaction(
      post({ description: 'ACE HARDWARE', amount: '1,234.56' })
    );

    expect(response.status).toBe(201);
    expect(db.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 123456 })
    );
  });

  it('keeps the existing defaults for absent optional amounts', async () => {
    await createLabor(post({ projectId: 'proj-1', hours: 6 }));
    expect(db.createLaborEntry).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRateCents: 8500 })
    );
  });

  it('stores an expense as a magnitude, however the bank signed it', async () => {
    await createTransaction(post({ description: 'HOME DEPOT #0421', amount: '(114.75)' }));
    expect(db.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 11475 })
    );
  });
});
