import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one REST route this application keeps for a person's data (spec §6).
 *
 * The session and the two repositories are stubbed at the module boundary;
 * every assertion is on what the route answered or on the rows it decided to
 * write. The parsing itself belongs to `@budget-bot/bank-connectors` and is
 * tested there, so what is asserted here is the part that is about this
 * application: whose rows these are, how they get categorised, which side of
 * the sign convention they land on, and the batch that makes it undoable.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1' }, expires: '2026-09-01' })),
}));

const db = vi.hoisted(() => ({
  createImportBatch: vi.fn(async (_db: unknown, ownerId: string, input: object) => ({
    id: 'batch-1',
    ownerId,
    createdAt: 'now',
    ...input,
  })),
  bulkCreateImported: vi.fn(async (_db: unknown, _ownerId: string, items: object[]) => items),
}));

vi.mock('@budget-bot/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budget-bot/db')>()),
  getDb: () => ({}),
  importBatchesRepo: { createImportBatch: db.createImportBatch },
  transactionsRepo: { bulkCreateImported: db.bulkCreateImported },
}));

const { auth } = await import('@/auth');
const { POST } = await import('@/app/api/import/csv/route');

const CSV = [
  'Date,Description,Amount',
  '2026-08-18,THE HOME DEPOT #0421 DECK SCREWS,114.75',
  '08/18/2026,BAD DATE,10.00',
  '2026-08-19,AUTOPAY PAYMENT THANK YOU,-1250.00',
].join('\n');

function textCsv(body: string): Request {
  return new Request('http://localhost/api/import/csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body,
  });
}

function multipart(body: string, filename = 'august.csv'): Request {
  const form = new FormData();
  form.set('file', new File([body], filename, { type: 'text/csv' }));
  return new Request('http://localhost/api/import/csv', { method: 'POST', body: form });
}

async function post(request: Request) {
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
}

/** The rows the route decided to write. */
function written(): Array<Record<string, unknown>> {
  return (db.bulkCreateImported.mock.calls.at(-1)?.[2] ?? []) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/import/csv', () => {
  it('imports an uploaded file and reports what it could not read', async () => {
    const { status, body } = await post(multipart(CSV));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      inserted: 2,
      skipped: 1,
      batchId: 'batch-1',
      errors: [{ line: 3, reason: expect.stringMatching(/date/i) }],
    });
  });

  it('accepts a raw text/csv body as well, for a caller with no form to post', async () => {
    const { status, body } = await post(textCsv(CSV));

    expect(status).toBe(200);
    expect(body).toMatchObject({ inserted: 2, skipped: 1 });
  });

  it('categorises what it imports rather than filing everything as overhead', async () => {
    await post(textCsv('Date,Description,Amount\n2026-08-18,BP #4471 UNLEADED,64.37'));

    expect(written()[0]).toMatchObject({
      vendor: 'Fuel & Vehicle Transit',
      category: 'mileage_fuel',
      taxDeductible: true,
    });
  });

  it('keeps the bank text verbatim next to the vendor it inferred', async () => {
    await post(textCsv('Date,Description,Amount\n2026-08-18,THE HOME DEPOT #0421,10.00'));

    expect(written()[0]).toMatchObject({
      rawDescriptor: 'THE HOME DEPOT #0421',
      vendor: 'The Home Depot',
    });
  });

  it('files a charge for triage and a payment as ignored, per the sign convention', async () => {
    await post(textCsv(CSV));

    expect(written().map((row) => [row.amountCents, row.status])).toEqual([
      [11475, 'unassigned'],
      [-125000, 'ignored'],
    ]);
  });

  it('records the batch under the signed-in owner, with the file it came from', async () => {
    await post(multipart(CSV, 'capital-one-august.csv'));

    expect(db.createImportBatch).toHaveBeenCalledWith({}, 'user-1', {
      source: 'csv',
      filename: 'capital-one-august.csv',
      rowCount: 3,
      insertedCount: 2,
      skippedCount: 1,
    });
  });

  it('writes the rows against the same owner, and points them at the batch', async () => {
    await post(textCsv(CSV));

    expect(db.bulkCreateImported).toHaveBeenCalledWith({}, 'user-1', expect.any(Array), {
      source: 'csv',
      provider: 'csv',
      importBatchId: 'batch-1',
    });
  });

  it('keeps the bank’s word on whether a charge has settled', async () => {
    await post(
      textCsv(
        [
          'Date,Description,Amount,Status',
          '2026-08-18,SETTLED CHARGE,10.00,Posted',
          '2026-08-19,STILL AUTHORIZING,20.00,Pending',
        ].join('\n')
      )
    );

    expect(written().map((row) => row.pending)).toEqual([false, true]);
  });

  it('gives every row an identity, so a later sync can recognise it', async () => {
    await post(textCsv(CSV));

    for (const row of written()) {
      expect(row.externalId).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('still records the batch when a file had nothing readable in it', async () => {
    // The user needs to be told the upload happened and brought in nothing,
    // rather than being left wondering whether it was received at all.
    const { status, body } = await post(
      textCsv('Date,Description,Amount\n08/18/2026,BAD DATE,10.00')
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ inserted: 0, skipped: 1 });
    expect(db.createImportBatch).toHaveBeenCalled();
  });

  it('refuses a request with no file at all', async () => {
    const { status, body } = await post(textCsv(''));

    expect(status).toBe(400);
    expect(body.error).toMatch(/no csv file/i);
    expect(db.createImportBatch).not.toHaveBeenCalled();
  });

  it('refuses a form that carries no file field', async () => {
    const form = new FormData();
    form.set('notes', 'oops');
    const { status } = await post(
      new Request('http://localhost/api/import/csv', { method: 'POST', body: form })
    );

    expect(status).toBe(400);
  });

  it('explains a file whose columns it cannot identify', async () => {
    const { status, body } = await post(textCsv('Column A,Column B\n1,2'));

    expect(status).toBe(400);
    expect(body.error).toMatch(/date|description|amount/i);
    expect(db.createImportBatch).not.toHaveBeenCalled();
  });

  it('turns a write that names a foreign project into a 400, not a 500', async () => {
    const { UnknownProjectError } = await import('@budget-bot/db');
    db.bulkCreateImported.mockRejectedValueOnce(new UnknownProjectError('proj-x'));

    const { status, body } = await post(textCsv(CSV));

    expect(status).toBe(400);
    expect(body.error).toMatch(/proj-x/);
  });

  it('refuses without a session, before it reads the body', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const { status } = await post(multipart(CSV));

    expect(status).toBe(401);
    expect(db.createImportBatch).not.toHaveBeenCalled();
    expect(db.bulkCreateImported).not.toHaveBeenCalled();
  });
});
