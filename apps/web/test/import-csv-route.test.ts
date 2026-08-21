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
  importCsvBatch: vi.fn(
    async (
      _db: unknown,
      ownerId: string,
      input: { batch: object; rows: object[] }
    ) => ({
      batch: { id: 'batch-1', ownerId, createdAt: 'now', ...input.batch },
      inserted: input.rows,
    })
  ),
}));

vi.mock('@budget-bot/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budget-bot/db')>()),
  getDb: () => ({}),
  importsRepo: { importCsvBatch: db.importCsvBatch },
}));

const { auth } = await import('@/auth');
const { POST } = await import('@/app/api/import/csv/route');

const CSV = [
  'Date,Description,Amount',
  '2026-08-18,THE HOME DEPOT #0421 DECK SCREWS,114.75',
  '18-Aug-2026,BAD DATE,10.00',
  '2026-08-19,AUTOPAY PAYMENT THANK YOU,-1250.00',
].join('\n');

/**
 * A real client always sends a length; the `Request` constructor does not add
 * one, so the helpers do. The route refuses an unmeasured body (411), and a
 * test that forgot the header would be testing that refusal by accident.
 */
function textCsv(body: string): Request {
  return new Request('http://localhost/api/import/csv', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/csv',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  });
}

/** What a pre-Phase-2 client, or any browser posting a `<form>`, still sends. */
function multipart(body: string, filename = 'august.csv'): Request {
  const form = new FormData();
  form.set('file', new File([body], filename, { type: 'text/csv' }));
  const request = new Request('http://localhost/api/import/csv', {
    method: 'POST',
    body: form,
  });
  // The multipart envelope is a few hundred bytes more than the file.
  request.headers.set('Content-Length', String(Buffer.byteLength(body) + 512));
  return request;
}

async function post(request: Request) {
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
}

/** The rows the route decided to write. */
function written(): Array<Record<string, unknown>> {
  return (db.importCsvBatch.mock.calls.at(-1)?.[2]?.rows ?? []) as Array<
    Record<string, unknown>
  >;
}

/** The batch row the route decided to write. */
function batchWritten(): Record<string, unknown> {
  return (db.importCsvBatch.mock.calls.at(-1)?.[2]?.batch ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/import/csv', () => {
  it('refuses multipart now that the client sends text/csv', async () => {
    const { status, body } = await post(multipart(CSV));

    expect(status).toBe(415);
    expect(body.error).toMatch(/text\/csv/i);
    expect(db.importCsvBatch).not.toHaveBeenCalled();
  });

  it('imports an uploaded file and reports what it could not read', async () => {
    const { status, body } = await post(textCsv(CSV));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      inserted: 2,
      skipped: 1,
      batchId: 'batch-1',
      errors: [{ line: 3, reason: expect.stringMatching(/date/i) }],
    });
  });

  it('imports a US-dated statement, which is what a self-hoster will upload first', async () => {
    // The dates a Chase or Capital One export carries. Before the provider
    // normalised them, *every* row of one came back skipped, which made the
    // first thing a new self-hoster does look like a broken product.
    const { status, body } = await post(
      textCsv(
        [
          'Transaction Date,Description,Amount',
          '08/18/2026,THE HOME DEPOT #0421,114.75',
          '8/19/2026,SHERWIN-WILLIAMS,146.30',
        ].join('\n')
      )
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ inserted: 2, skipped: 0 });
    expect(written().map((row) => row.date)).toEqual(['2026-08-18', '2026-08-19']);
  });

  it('says which date formats it understands when a row has none of them', async () => {
    const { body } = await post(textCsv(CSV));

    expect(body).toMatchObject({
      errors: [{ line: 3, reason: expect.stringMatching(/YYYY-MM-DD or MM\/DD\/YYYY/) }],
    });
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

  it('records the batch under the signed-in owner', async () => {
    await post(textCsv(CSV));

    expect(db.importCsvBatch).toHaveBeenCalledWith({}, 'user-1', expect.any(Object));
    expect(batchWritten()).toEqual({
      source: 'csv',
      // A raw text/csv body carries no filename - there is no form field to
      // read one from, unlike the multipart upload this replaced.
      filename: null,
      rowCount: 3,
      insertedCount: 2,
      skippedCount: 1,
    });
  });

  it('writes the batch and its rows as one call, so neither can land alone', async () => {
    await post(textCsv(CSV));

    expect(db.importCsvBatch).toHaveBeenCalledOnce();
    expect(db.importCsvBatch).toHaveBeenCalledWith({}, 'user-1', {
      batch: expect.any(Object),
      rows: expect.any(Array),
      provider: 'csv',
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
      textCsv('Date,Description,Amount\n18-Aug-2026,BAD DATE,10.00')
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ inserted: 0, skipped: 1 });
    expect(db.importCsvBatch).toHaveBeenCalled();
  });

  describe('the size cap', () => {
    // An App Router route handler has no body limit of its own, and a
    // self-hoster's box has no platform limit in front of it either, so
    // `req.text()` would happily buffer whatever arrived. A year of card
    // statements is well under 1 MiB.
    const CAP = 5 * 1024 * 1024;

    function withLength(bytes: number, body: string): Request {
      return new Request('http://localhost/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', 'Content-Length': String(bytes) },
        body,
      });
    }

    it('refuses a body that says it is over the cap, before reading it', async () => {
      const { status, body } = await post(withLength(CAP + 1, CSV));

      expect(status).toBe(413);
      expect(body.error).toMatch(/5 MiB|too large/i);
      expect(db.importCsvBatch).not.toHaveBeenCalled();
      expect(db.importCsvBatch).not.toHaveBeenCalled();
    });

    it('refuses a body that will not say how big it is', async () => {
      // 411 rather than 413: nothing is known to be too large, only unmeasured,
      // and the caller can fix it by sending a length.
      const request = new Request('http://localhost/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: CSV,
      });
      request.headers.delete('Content-Length');

      const { status, body } = await post(request);

      expect(status).toBe(411);
      expect(body.error).toMatch(/length/i);
      expect(db.importCsvBatch).not.toHaveBeenCalled();
    });

    it('accepts a body under the cap', async () => {
      const { status } = await post(withLength(Buffer.byteLength(CSV), CSV));

      expect(status).toBe(200);
    });

    it('stops reading a body that lied about its length', async () => {
      // Content-Length is the caller's word for it. The read is capped too, so
      // a stream that keeps going past the cap is cut off rather than buffered.
      const oversized = `Date,Description,Amount\n${'2026-08-18,PADDING,1.00\n'.repeat(
        250_000
      )}`;
      expect(Buffer.byteLength(oversized)).toBeGreaterThan(CAP);

      const { status } = await post(withLength(10, oversized));

      expect(status).toBe(413);
      expect(db.importCsvBatch).not.toHaveBeenCalled();
    });
  });

  it('refuses a request with no file at all', async () => {
    const { status, body } = await post(textCsv(''));

    expect(status).toBe(400);
    expect(body.error).toMatch(/no csv file/i);
    expect(db.importCsvBatch).not.toHaveBeenCalled();
  });

  it('explains a file whose columns it cannot identify', async () => {
    const { status, body } = await post(textCsv('Column A,Column B\n1,2'));

    expect(status).toBe(400);
    expect(body.error).toMatch(/date|description|amount/i);
    expect(db.importCsvBatch).not.toHaveBeenCalled();
  });

  it('turns a write that names a foreign project into a 400, not a 500', async () => {
    const { UnknownProjectError } = await import('@budget-bot/db');
    db.importCsvBatch.mockRejectedValueOnce(new UnknownProjectError('proj-x'));

    const { status, body } = await post(textCsv(CSV));

    expect(status).toBe(400);
    expect(body.error).toMatch(/proj-x/);
  });

  it('reports no batch id when the write was rolled back', async () => {
    // The batch and its rows are one transaction, so a failure leaves nothing
    // behind - and the response must not name an import that does not exist.
    // packages/db asserts the rollback itself against real Postgres.
    const { UnknownProjectError } = await import('@budget-bot/db');
    db.importCsvBatch.mockRejectedValueOnce(new UnknownProjectError('proj-x'));

    const { body } = await post(textCsv(CSV));

    expect(body.batchId).toBeUndefined();
  });

  it('refuses without a session, before it reads the body', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const { status } = await post(multipart(CSV));

    expect(status).toBe(401);
    expect(db.importCsvBatch).not.toHaveBeenCalled();
  });
});
