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
      averageHourlyRealization: 154.76,
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

  // The defects this task fixes.
  it('BUG 2: business realization subtracts materials only, unlike the per-project figure', () => {
    // (18250 - 4321.40) / 90 hrs. Labour, subs and other direct costs are all
    // left in, so the business number is far rosier than any project's.
    expect(summarize().averageHourlyRealization).toBe(154.76);
    expect(summarize().averageHourlySeverity).toBe('healthy');
  });

  it('BUG 2: with no projects at all, realization is the fabricated $85/hr sentinel', () => {
    const summary = calculateBusinessSummary([], [], [], [], NOW);
    expect(summary.averageHourlyRealization).toBe(85);
    expect(summary.averageHourlySeverity).toBe('healthy');
  });
});
