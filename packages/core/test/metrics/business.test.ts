import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBusinessSummary } from '../../src/metrics/business';
import {
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '../fixtures';

// CHARACTERIZATION: calculateBusinessSummary reads `new Date()` internally, so
// its weekly cash-flow numbers can only be pinned by freezing the clock. That
// hidden dependency is exactly what this task removes.

const FROZEN_NOW = new Date('2026-08-20T12:00:00.000Z');

const summarize = () =>
  calculateBusinessSummary(SEED_PROJECTS, SEED_TRANSACTIONS, SEED_LABOR, SEED_INVOICES);

afterEach(() => {
  vi.useRealTimers();
});

describe('calculateBusinessSummary (characterization)', () => {
  it('aggregates the seed book of business at a frozen clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);

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

  it('reads the wall clock, so the weekly window moves on its own', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));

    const summary = summarize();
    expect(summary.weeklyCashInflow).toBe(0);
    expect(summary.weeklyCashOutflow).toBe(0);
    expect(summary.weeklyNetCashFlow).toBe(0);
  });

  // The defects this task fixes.
  it('BUG 2: business realization subtracts materials only, unlike the per-project figure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);

    const summary = summarize();
    // (18250 - 4321.40) / 90 hrs. Labour, subs and other direct costs are all
    // left in, so the business number is far rosier than any project's.
    expect(summary.averageHourlyRealization).toBe(154.76);
    expect(summary.averageHourlySeverity).toBe('healthy');
  });

  it('BUG 2: with no projects at all, realization is the fabricated $85/hr sentinel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);

    const summary = calculateBusinessSummary([], [], [], []);
    expect(summary.averageHourlyRealization).toBe(85);
    expect(summary.averageHourlySeverity).toBe('healthy');
  });
});
