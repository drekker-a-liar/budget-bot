import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBusinessSummary } from '../../src/metrics/business';
import type { ExpenseTransaction, Invoice, InvoiceStatus } from '../../src/types';
import { parseMoney } from '../../src/money';
import {
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '../fixtures';

const invoice = (status: InvoiceStatus, dollars: number, paidDate?: string): Invoice => ({
  id: `inv-${status}-${dollars}`,
  projectId: 'proj-x',
  invoiceNumber: 'INV-TEST',
  amountCents: parseMoney(dollars),
  depositAmountCents: parseMoney(0),
  dateIssued: '2026-08-18',
  dueDate: '2026-08-19',
  status,
  paidDate,
  createdAt: '2026-08-18T00:00:00.000Z',
});

const expense = (dollars: number, date: string): ExpenseTransaction => ({
  id: `tx-${dollars}-${date}`,
  date,
  description: 'A PURCHASE',
  vendor: 'A Vendor',
  amountCents: parseMoney(dollars),
  category: 'materials',
  paymentMethod: 'card',
  status: 'matched',
  taxDeductible: true,
  createdAt: `${date}T00:00:00.000Z`,
});

// CHARACTERIZATION of the aggregate figures, except where a test is marked
// CHANGED: those pin behaviour this task deliberately altered.

const NOW = new Date('2026-08-20T12:00:00.000Z');

const summarize = (now: Date = NOW) =>
  calculateBusinessSummary(
    SEED_PROJECTS,
    SEED_TRANSACTIONS,
    SEED_LABOR,
    SEED_INVOICES,
    now
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('calculateBusinessSummary', () => {
  it('aggregates the seed book of business at a given instant', () => {
    expect(summarize()).toEqual({
      totalRevenueYTDCents: 1_825_000,
      totalMaterialsYTDCents: 432_140,
      totalLaborYTDCents: 783_000,
      totalGrossProfitYTDCents: 578_860,
      averageMarginPct: 31.7,
      averageMarginSeverity: 'caution',
      averageHourlyRealizationCents: 15_132,
      averageHourlySeverity: 'healthy',
      openProjectsCount: 2,
      unassignedTransactionsCount: 3,
      unassignedTransactionsTotalCents: 37_285,
      outstandingReceivablesCents: 450_000,
      overdueReceivablesCents: 0,
      receivablesSeverity: 'healthy',
      weeklyCashInflowCents: 375_000,
      weeklyCashOutflowCents: 139_155,
      weeklyNetCashFlowCents: 235_845,
      cashFlowSeverity: 'healthy',
    });
  });

  // CHANGED: in float dollars these two totals came out as 372.84999999999997
  // and 1391.5500000000002. Sums of cents are exact.
  it('CHANGED: totals that used to drift in float are exact', () => {
    const summary = summarize();
    expect(summary.unassignedTransactionsTotalCents).toBe(37_285);
    expect(summary.weeklyCashOutflowCents).toBe(139_155);
  });

  // CHANGED: `now` used to be read from the wall clock inside the function.
  it('CHANGED: takes `now` as a required parameter and never reads the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-05-05T00:00:00.000Z'));

    const summary = summarize(NOW);
    expect(summary.weeklyCashInflowCents).toBe(375_000);
    expect(summary.weeklyCashOutflowCents).toBe(139_155);
    expect(summary.weeklyNetCashFlowCents).toBe(235_845);
  });

  it('CHANGED: a different `now` moves the weekly cash-flow window', () => {
    const summary = summarize(new Date('2027-01-01T00:00:00.000Z'));
    expect(summary.weeklyCashInflowCents).toBe(0);
    expect(summary.weeklyCashOutflowCents).toBe(0);
    expect(summary.weeklyNetCashFlowCents).toBe(0);
    expect(summary.cashFlowSeverity).toBe('healthy');
  });

  // CHANGED (bug 2): the business figure used to be
  // (totalRevenue - totalMaterials) / totalHours, subtracting materials only
  // and leaving subcontractor and other direct costs in, so it disagreed with
  // the per-project netHourlyRealization it was supposed to summarise. It is
  // now sum(kpi.netEarningsCents) / totalHours, the same definition scaled up.
  it('CHANGED: business realization sums the same net earnings the projects report', () => {
    // $13,618.60 net earnings / 90 hrs. The old materials-only formula reported
    // $154.76/hr by leaving $1,690 of subs and disposal costs in.
    expect(summarize().averageHourlyRealizationCents).toBe(15_132);
    expect(summarize().averageHourlySeverity).toBe('healthy');
  });

  it.each([
    [0, 'healthy'],
    [500, 'healthy'],
    [500.01, 'caution'],
    [2000, 'caution'],
    [2000.01, 'critical'],
  ])('$%s of overdue receivables is %s', (dollars, expected) => {
    const invoices = dollars > 0 ? [invoice('overdue', dollars)] : [];
    expect(calculateBusinessSummary([], [], [], invoices, NOW).receivablesSeverity).toBe(
      expected
    );
  });

  it.each([
    [1000, 'healthy'],
    [0, 'healthy'],
    [-0.01, 'caution'],
    [-500, 'caution'],
    [-500.01, 'critical'],
  ])('a weekly net cash flow of $%s is %s', (net, expected) => {
    // One paid invoice in, one expense out, both inside the seven-day window.
    const invoices = [invoice('paid', 1000, '2026-08-19')];
    const transactions = [expense(1000 - net, '2026-08-19')];
    const summary = calculateBusinessSummary([], transactions, [], invoices, NOW);
    expect(summary.weeklyNetCashFlowCents).toBe(parseMoney(net));
    expect(summary.cashFlowSeverity).toBe(expected);
  });

  // CHANGED (bug 2): with no hours logged there is no realization to report,
  // and the old code answered 85 - exactly the HOURLY_REALIZATION.HEALTHY
  // threshold - so an empty book of business rendered as green.
  it('CHANGED: realization is null, not $85/hr, when no hours have been logged', () => {
    const summary = calculateBusinessSummary([], [], [], [], NOW);
    expect(summary.averageHourlyRealizationCents).toBeNull();
    expect(summary.averageHourlySeverity).toBeNull();
  });
});
