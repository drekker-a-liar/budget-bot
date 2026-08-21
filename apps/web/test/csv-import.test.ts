import { beforeEach, describe, expect, it, vi } from 'vitest';

// The JSON store is stubbed at the module boundary; every assertion is on the
// route's response or on the rows it decided to import.
vi.mock('@/lib/db', () => ({
  db: {
    bulkImportTransactions: vi.fn((items) =>
      items.map((item: object, i: number) => ({ ...item, id: `tx-${i}`, createdAt: 'now' }))
    ),
  },
}));

const { db } = await import('@/lib/db');
const { POST: importTransactions } = await import('@/app/api/transactions/import/route');

const post = (body: unknown) =>
  new Request('http://localhost/api/transactions/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const importCsv = async (rawCsv: string) => {
  const response = await importTransactions(post({ rawCsv }));
  return { status: response.status, body: await response.json() };
};

const importedRows = () =>
  (db.bulkImportTransactions as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? [];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CSV import', () => {
  // The defect: parseMoney throws on garbage, the throw reached the route's
  // outer catch, and one unreadable cell turned the whole file into a 500.
  it('imports the readable rows and skips the rest instead of failing the batch', async () => {
    const { status, body } = await importCsv(
      [
        'Date,Description,Amount',
        '2026-08-18,THE HOME DEPOT #0421,114.75',
        '2026-08-18,BROKEN ROW,N/A',
        '2026-08-19,SHERWIN-WILLIAMS,146.30',
      ].join('\n')
    );

    expect(status).toBe(200);
    expect(body.inserted).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.errors).toEqual([
      { row: 3, reason: expect.stringContaining('amount') },
    ]);
    expect(importedRows().map((r: { amountCents: number }) => r.amountCents)).toEqual([
      11475, 14630,
    ]);
  });

  it('reads the accounting negatives banks export, as a magnitude', async () => {
    await importCsv('2026-08-18,THE HOME DEPOT #0421,(114.75)');
    expect(importedRows()[0].amountCents).toBe(11475);
  });

  it('reports every row it dropped, with the row number and the reason', async () => {
    const { body } = await importCsv(
      [
        '2026-08-18,GOOD ROW,10.00',
        '08/18/2026,BAD DATE,10.00',
        '2026-08-18,ZERO AMOUNT,0.00',
        '2026-08-18',
      ].join('\n')
    );

    expect(body.inserted).toBe(1);
    expect(body.skipped).toBe(3);
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4]);
    expect(body.errors[0].reason).toMatch(/date/i);
    expect(body.errors[1].reason).toMatch(/zero/i);
    expect(body.errors[2].reason).toMatch(/description/i);
  });

  it('does not count the header row as a skipped row', async () => {
    const { body } = await importCsv('Date,Description,Amount\n2026-08-18,A VENDOR,10.00');
    expect(body).toMatchObject({ inserted: 1, skipped: 0, errors: [] });
  });

  it('reports a file it could read nothing from rather than erroring', async () => {
    const { status, body } = await importCsv('2026-08-18,NOTHING,nope\n2026-08-19,ALSO,N/A');

    expect(status).toBe(200);
    expect(body).toMatchObject({ inserted: 0, skipped: 2 });
    expect(db.bulkImportTransactions).not.toHaveBeenCalled();
  });

  it('still categorises what it imports', async () => {
    await importCsv('2026-08-18,BP #4471 UNLEADED,64.37');
    expect(importedRows()[0]).toMatchObject({
      category: 'mileage_fuel',
      vendor: 'Fuel & Vehicle Transit',
      status: 'unassigned',
    });
  });

  // KNOWN LIMITATION, deliberately pinned: rows are split on every comma with
  // no quoting rules, so a thousands-separated amount is read as the column
  // before it. A real CSV field parser is Task 5's job; this test is here so
  // that whoever writes it knows this is the behaviour being replaced.
  it('KNOWN LIMITATION: splits on every comma, so 1,234.56 reads as $1.00', async () => {
    await importCsv('2026-08-18,ACE HARDWARE,1,234.56');
    expect(importedRows()[0].amountCents).toBe(100);
  });

  it('reports the same counts for the simulated card feed', async () => {
    const response = await importTransactions(post({ simulatedType: 'home_depot_run' }));
    expect(await response.json()).toMatchObject({ inserted: 2, skipped: 0, errors: [] });
  });
});
