import { beforeEach, describe, expect, it, vi } from 'vitest';

// The JSON store is stubbed at the module boundary: these tests are about how
// a route reads money out of a request body, not about persistence. Every
// assertion is on the route's response or on the cents value handed to the
// store, both of which are real behaviour.
vi.mock('@/lib/db', () => ({
  db: {
    createProject: vi.fn((input) => ({ ...input, id: 'proj-1', createdAt: 'now' })),
    createInvoice: vi.fn((input) => ({ ...input, id: 'inv-1', createdAt: 'now' })),
    createLaborEntry: vi.fn((input) => ({ ...input, id: 'lab-1', createdAt: 'now' })),
    createTransaction: vi.fn((input) => ({ ...input, id: 'tx-1', createdAt: 'now' })),
  },
}));

const { db } = await import('@/lib/db');
const { POST: createProject } = await import('@/app/api/projects/route');
const { POST: createInvoice } = await import('@/app/api/invoices/route');
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
      'projects',
      createProject,
      { name: 'Deck', clientName: 'R Henderson', quotedTotal: 'not a number' },
      'Invalid amount for quotedTotal',
    ],
    [
      'invoices',
      createInvoice,
      { projectId: 'proj-1', invoiceNumber: 'INV-1', amount: 'N/A' },
      'Invalid amount for amount',
    ],
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
  it('reads a comma-formatted quoted total instead of storing zero', async () => {
    const response = await createProject(
      post({ name: 'Deck', clientName: 'R Henderson', quotedTotal: '1,234.56' })
    );

    expect(response.status).toBe(201);
    expect(db.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ quotedTotalCents: 123456 })
    );
  });

  it('keeps the existing defaults for absent optional amounts', async () => {
    await createProject(post({ name: 'Deck', clientName: 'R Henderson', quotedTotal: 4500 }));
    expect(db.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        quotedTotalCents: 450000,
        quotedMaterialsCents: 0, // absent -> $0
        targetHourlyRateCents: 8500, // absent -> the $85/hr default
      })
    );

    await createInvoice(post({ projectId: 'proj-1', invoiceNumber: 'INV-1', amount: 1950 }));
    expect(db.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 195000, depositAmountCents: 0 })
    );

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
