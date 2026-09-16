import { describe, expect, it } from 'vitest';
import { calculateMonthlyMargins } from '../../src/metrics/monthly';
import { parseMoney } from '../../src/money';
import { THRESHOLDS } from '../../src/metrics/thresholds';
import type { ExpenseTransaction, Invoice, InvoiceStatus, LaborEntry } from '../../src/types';

const invoice = (
  status: InvoiceStatus,
  dollars: number,
  paidDate?: string
): Invoice => ({
  id: `inv-${status}-${dollars}-${paidDate ?? 'none'}`,
  projectId: 'proj-x',
  invoiceNumber: 'INV-TEST',
  amountCents: parseMoney(dollars),
  depositAmountCents: parseMoney(0),
  dateIssued: '2026-01-01',
  dueDate: '2026-01-15',
  status,
  paidDate,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const expense = (
  dollars: number,
  date: string,
  overrides: Partial<ExpenseTransaction> = {}
): ExpenseTransaction => ({
  id: `tx-${date}-${dollars}-${Math.random()}`,
  date,
  description: 'A PURCHASE',
  vendor: 'A Vendor',
  amountCents: parseMoney(dollars),
  category: 'materials',
  paymentMethod: 'card',
  status: 'matched',
  taxDeductible: true,
  createdAt: `${date}T00:00:00.000Z`,
  postedAt: null,
  pending: false,
  source: 'manual',
  provider: null,
  externalId: null,
  bankAccountId: null,
  removedAt: null,
  userEditedAt: null,
  ...overrides,
});

const labor = (
  dollarsPerHour: number,
  hours: number,
  date: string
): LaborEntry => ({
  id: `lab-${date}-${dollarsPerHour}-${hours}`,
  projectId: 'proj-x',
  date,
  hours,
  hourlyRateCents: parseMoney(dollarsPerHour),
  workerName: 'A Worker',
  createdAt: `${date}T00:00:00.000Z`,
});

describe('calculateMonthlyMargins', () => {
  it('zero-fills every month in range with null marginPct and severity none when there is no data', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-02-28' },
      timeZone: 'UTC',
    });

    expect(result).toEqual([
      {
        month: '2026-01',
        revenueCents: 0,
        cogs: { materials: 0, labor: 0, subcontractor: 0, otherDirect: 0, total: 0 },
        marginCents: 0,
        marginPct: null,
        severity: 'none',
        counts: { invoices: 0, transactions: 0, laborEntries: 0 },
      },
      {
        month: '2026-02',
        revenueCents: 0,
        cogs: { materials: 0, labor: 0, subcontractor: 0, otherDirect: 0, total: 0 },
        marginCents: 0,
        marginPct: null,
        severity: 'none',
        counts: { invoices: 0, transactions: 0, laborEntries: 0 },
      },
    ]);
  });

  it('counts a paid invoice as revenue but not an unpaid one', () => {
    const result = calculateMonthlyMargins({
      invoices: [
        invoice('paid', 1000, '2026-01-15'),
        invoice('sent', 500, undefined),
        invoice('draft', 200, undefined),
        invoice('overdue', 300, undefined),
      ],
      transactions: [],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].revenueCents).toBe(100_000);
    expect(result[0].counts.invoices).toBe(1);
  });

  it('excludes pending transactions from cogs', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [expense(200, '2026-01-10', { pending: true })],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].cogs.total).toBe(0);
    expect(result[0].counts.transactions).toBe(0);
  });

  it('excludes ignored transactions from cogs', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [expense(200, '2026-01-10', { status: 'ignored' })],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].cogs.total).toBe(0);
    expect(result[0].counts.transactions).toBe(0);
  });

  it('excludes a negative-amount row because it defaults to ignored, not because of its sign', () => {
    // A negative-amount transaction that is NOT ignored still contributes
    // (with its negative value) - there is no special-casing on sign here.
    // What actually keeps refunds and reversals out of cogs is that they
    // default to status: 'ignored' upstream, and that status filter is what
    // this test proves.
    const resultIgnored = calculateMonthlyMargins({
      invoices: [],
      transactions: [expense(-200, '2026-01-10', { status: 'ignored' })],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });
    expect(resultIgnored[0].cogs.total).toBe(0);
    expect(resultIgnored[0].counts.transactions).toBe(0);

    const resultMatched = calculateMonthlyMargins({
      invoices: [],
      transactions: [expense(-200, '2026-01-10', { status: 'matched' })],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });
    expect(resultMatched[0].cogs.total).toBe(-20_000);
    expect(resultMatched[0].counts.transactions).toBe(1);
  });

  it('excludes overhead-categorized transactions from cogs entirely', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [expense(150, '2026-01-10', { category: 'overhead' })],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].cogs.total).toBe(0);
    expect(result[0].counts.transactions).toBe(0);
  });

  it('splits cogs into materials, labor, subcontractor, and otherDirect', () => {
    const result = calculateMonthlyMargins({
      invoices: [invoice('paid', 5000, '2026-01-20')],
      transactions: [
        expense(1000, '2026-01-05', { category: 'materials' }),
        expense(400, '2026-01-06', { category: 'subcontractor' }),
        expense(75, '2026-01-07', { category: 'tools' }),
        expense(50, '2026-01-08', { category: 'mileage_fuel' }),
      ],
      laborEntries: [labor(85, 8, '2026-01-09')],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].cogs).toEqual({
      materials: 100_000,
      labor: 68_000,
      subcontractor: 40_000,
      otherDirect: 12_500,
      total: 220_500,
    });
    expect(result[0].counts).toEqual({ invoices: 1, transactions: 4, laborEntries: 1 });
  });

  it.each([
    [45, 'healthy'],
    [44.9, 'caution'],
    [25, 'caution'],
    [24.9, 'critical'],
  ])('grades a %s%% margin as %s, using the shared thresholds', (marginPct, expected) => {
    expect(THRESHOLDS.GROSS_MARGIN).toEqual({ HEALTHY: 45, CAUTION: 25 });

    // revenue $1000, cogs chosen so margin comes out to exactly marginPct.
    const revenue = 100_000;
    const cogs = Math.round(revenue * (1 - marginPct / 100));
    const result = calculateMonthlyMargins({
      invoices: [invoice('paid', 1000, '2026-01-15')],
      transactions: [expense(cogs / 100, '2026-01-15', { category: 'materials' })],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].marginPct).toBe(marginPct);
    expect(result[0].severity).toBe(expected);
  });

  it('buckets a postedAt timestamp by the owner time zone, not UTC', () => {
    const transaction = expense(100, '2026-02-15', {
      date: '2026-02-15',
      postedAt: '2026-03-01T02:00:00.000Z',
      category: 'materials',
    });

    const utcResult = calculateMonthlyMargins({
      invoices: [],
      transactions: [transaction],
      laborEntries: [],
      range: { start: '2026-02-01', end: '2026-03-31' },
      timeZone: 'UTC',
    });
    const laResult = calculateMonthlyMargins({
      invoices: [],
      transactions: [transaction],
      laborEntries: [],
      range: { start: '2026-02-01', end: '2026-03-31' },
      timeZone: 'America/Los_Angeles',
    });

    const marchUtc = utcResult.find((m) => m.month === '2026-03')!;
    const februaryUtc = utcResult.find((m) => m.month === '2026-02')!;
    expect(marchUtc.cogs.materials).toBe(10_000);
    expect(februaryUtc.cogs.materials).toBe(0);

    const marchLa = laResult.find((m) => m.month === '2026-03')!;
    const februaryLa = laResult.find((m) => m.month === '2026-02')!;
    expect(marchLa.cogs.materials).toBe(0);
    expect(februaryLa.cogs.materials).toBe(10_000);
  });

  it('excludes a transaction dated the day before range.start', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [
        expense(50, '2026-01-14', { category: 'materials' }),
        expense(75, '2026-01-15', { category: 'materials' }),
      ],
      laborEntries: [],
      range: { start: '2026-01-15', end: '2026-01-31' },
      timeZone: 'UTC',
    });

    expect(result[0].cogs.materials).toBe(7_500);
    expect(result[0].counts.transactions).toBe(1);
  });

  it('excludes a transaction dated the day after range.end', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [
        expense(75, '2026-01-15', { category: 'materials' }),
        expense(50, '2026-01-16', { category: 'materials' }),
      ],
      laborEntries: [],
      range: { start: '2026-01-01', end: '2026-01-15' },
      timeZone: 'UTC',
    });

    expect(result[0].cogs.materials).toBe(7_500);
    expect(result[0].counts.transactions).toBe(1);
  });

  // The trailing-12-month window /margin asks for crosses a year boundary for
  // eleven months of every year; a month counter that never wrapped would
  // hand back `2025-13` and drop January.
  it('zero-fills every month across a year boundary, in order', () => {
    const result = calculateMonthlyMargins({
      invoices: [],
      transactions: [],
      laborEntries: [],
      range: { start: '2025-11-01', end: '2026-02-28' },
      timeZone: 'UTC',
    });

    expect(result.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(result.every((m) => m.revenueCents === 0 && m.marginPct === null)).toBe(true);
  });
});
