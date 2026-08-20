import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBusinessSummary } from '../../src/metrics/business';
import {
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '../fixtures';

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
      totalRevenueYTD: 18250,
      totalMaterialsYTD: 4321.4,
      totalLaborYTD: 7830,
      totalGrossProfitYTD: 5788.6,
      averageMarginPct: 31.7,
      averageMarginSeverity: 'caution',
      averageHourlyRealization: 151.32,
      averageHourlySeverity: 'healthy',
      openProjectsCount: 2,
      unassignedTransactionsCount: 3,
      unassignedTransactionsTotal: 372.84999999999997,
      outstandingReceivables: 4500,
      overdueReceivables: 0,
      receivablesSeverity: 'healthy',
      weeklyCashInflow: 3750,
      weeklyCashOutflow: 1391.5500000000002,
      weeklyNetCashFlow: 2358.45,
      cashFlowSeverity: 'healthy',
    });
  });

  // CHANGED: `now` used to be read from the wall clock inside the function.
  it('CHANGED: takes `now` as a required parameter and never reads the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-05-05T00:00:00.000Z'));

    const summary = summarize(NOW);
    expect(summary.weeklyCashInflow).toBe(3750);
    expect(summary.weeklyCashOutflow).toBe(1391.5500000000002);
    expect(summary.weeklyNetCashFlow).toBe(2358.45);
  });

  it('CHANGED: a different `now` moves the weekly cash-flow window', () => {
    const summary = summarize(new Date('2027-01-01T00:00:00.000Z'));
    expect(summary.weeklyCashInflow).toBe(0);
    expect(summary.weeklyCashOutflow).toBe(0);
    expect(summary.weeklyNetCashFlow).toBe(0);
    expect(summary.cashFlowSeverity).toBe('healthy');
  });

  // CHANGED (bug 2): the business figure used to be
  // (totalRevenue - totalMaterials) / totalHours, subtracting materials only
  // and leaving subcontractor and other direct costs in, so it disagreed with
  // the per-project netHourlyRealization it was supposed to summarise. It is
  // now sum(kpi.netEarnings) / totalHours, the same definition scaled up.
  it('CHANGED: business realization sums the same net earnings the projects report', () => {
    // 13618.60 net earnings / 90 hrs. The old materials-only formula reported
    // 154.76 by leaving $1,690 of subs and disposal costs in.
    expect(summarize().averageHourlyRealization).toBe(151.32);
    expect(summarize().averageHourlySeverity).toBe('healthy');
  });

  // CHANGED (bug 2): with no hours logged there is no realization to report,
  // and the old code answered 85 - exactly the HOURLY_REALIZATION.HEALTHY
  // threshold - so an empty book of business rendered as green.
  it('CHANGED: realization is null, not $85/hr, when no hours have been logged', () => {
    const summary = calculateBusinessSummary([], [], [], [], NOW);
    expect(summary.averageHourlyRealization).toBeNull();
    expect(summary.averageHourlySeverity).toBeNull();
  });
});
