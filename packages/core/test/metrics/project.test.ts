import { describe, expect, it } from 'vitest';
import { calculateProjectKPIs } from '../../src/metrics/project';
import { parseMoney } from '../../src/money';
import type { ExpenseTransaction } from '../../src/types';
import {
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '../fixtures';

// CHARACTERIZATION of calculateProjectKPIs against the prototype seed data,
// except where a test is marked CHANGED. Every money figure is integer cents.

const kpiFor = (projectId: string) => {
  const project = SEED_PROJECTS.find((p) => p.id === projectId)!;
  return calculateProjectKPIs(project, SEED_TRANSACTIONS, SEED_LABOR, SEED_INVOICES);
};

describe('calculateProjectKPIs', () => {
  it('proj-1: invoiced project, revenue comes from invoices', () => {
    expect(kpiFor('proj-1')).toEqual({
      projectId: 'proj-1',
      projectName: 'Master Bath Tile & Double Vanity Remodel',
      status: 'completed',
      revenueCents: 680_000,
      quotedTotalCents: 680_000,
      actualMaterialsCostCents: 145_075,
      actualLaborCostCents: 323_000,
      subcontractorCostCents: 0,
      otherDirectCostsCents: 31_000,
      totalDirectCostCents: 499_075,
      actualLaborHours: 38,
      quotedLaborHours: 42,
      grossProfitCents: 180_925,
      netEarningsCents: 503_925,
      grossMarginPct: 26.6,
      grossMarginSeverity: 'caution',
      netHourlyRealizationCents: 13_261,
      hourlySeverity: 'healthy',
      materialsMarkupPct: 51.6,
      materialsMarkupSeverity: 'healthy',
      budgetVariancePct: 73.4,
      budgetSeverity: 'healthy',
      isOverBudget: false,
    });
  });

  // CHANGED: in float dollars this gross profit was 268.0500000000002 and this
  // materials cost was 338.20000000000005. Sums of cents are exact.
  it('CHANGED: sums that used to drift in float are exact', () => {
    expect(kpiFor('proj-2').grossProfitCents).toBe(26_805);
    expect(kpiFor('proj-3').actualMaterialsCostCents).toBe(33_820);
    expect(kpiFor('proj-3').grossProfitCents).toBe(47_180);
  });

  it('proj-2: a job whose lumber overran the quote', () => {
    const kpi = kpiFor('proj-2');
    expect(kpi.grossMarginPct).toBe(6);
    expect(kpi.grossMarginSeverity).toBe('critical');
    expect(kpi.materialsMarkupPct).toBe(-5.5);
    expect(kpi.budgetVariancePct).toBe(94);
    expect(kpi.budgetSeverity).toBe('caution');
  });

  it('proj-3: emergency callout billed at the higher rate', () => {
    const kpi = kpiFor('proj-3');
    expect(kpi.grossMarginPct).toBe(24.2);
    expect(kpi.netHourlyRealizationCents).toBe(13_432);
  });

  it('proj-4: partially invoiced work uses the invoiced amount, not the quote', () => {
    const kpi = kpiFor('proj-4');
    expect(kpi.revenueCents).toBe(180_000);
    expect(kpi.quotedTotalCents).toBe(360_000);
    expect(kpi.budgetVariancePct).toBe(48.9);
  });

  it('proj-5: with no invoices, revenue falls back to the quoted total', () => {
    const kpi = kpiFor('proj-5');
    expect(kpi.revenueCents).toBe(320_000);
    expect(kpi.grossMarginPct).toBe(100);
  });

  // CHANGED: `percent(...) ?? 0` on both. A job with no quote and nothing
  // invoiced showed a 0% margin graded 'critical' (a red badge for nothing
  // having happened) and 0% of budget spent graded 'healthy' (green whatever
  // had been bought). The averageMarginPct aggregate already answered null for
  // the same condition; the per-project figures now agree with it.
  it('CHANGED: margin and budget share are null, not 0%, when there is no revenue or quote to divide by', () => {
    const project = {
      ...SEED_PROJECTS.find((p) => p.id === 'proj-5')!,
      quotedTotalCents: parseMoney(0),
    };
    const kpi = calculateProjectKPIs(project, [], [], []);

    expect(kpi.revenueCents).toBe(0);
    expect(kpi.grossMarginPct).toBeNull();
    expect(kpi.grossMarginSeverity).toBeNull();
    expect(kpi.budgetVariancePct).toBeNull();
    expect(kpi.budgetSeverity).toBeNull();
  });

  it('still flags a zero-quote job as over budget once anything is spent on it', () => {
    // No quote means no percentage, not no problem: money went out against
    // nothing, and the boolean carries that without inventing a ratio.
    const project = {
      ...SEED_PROJECTS.find((p) => p.id === 'proj-4')!,
      quotedTotalCents: parseMoney(0),
    };
    const kpi = calculateProjectKPIs(project, SEED_TRANSACTIONS, SEED_LABOR, []);

    expect(kpi.totalDirectCostCents).toBeGreaterThan(0);
    expect(kpi.budgetVariancePct).toBeNull();
    expect(kpi.isOverBudget).toBe(true);
  });

  it('separates subcontractor cost from materials and other direct costs', () => {
    const project = SEED_PROJECTS.find((p) => p.id === 'proj-5')!;
    const subcontract: ExpenseTransaction = {
      id: 'tx-sub-1',
      date: '2026-08-26',
      description: 'VANCE ELECTRIC LLC - LED channel wiring',
      vendor: 'Vance Electric',
      amountCents: parseMoney(750),
      category: 'subcontractor',
      paymentMethod: 'check',
      status: 'matched',
      projectId: 'proj-5',
      taxDeductible: true,
      createdAt: '2026-08-26T00:00:00.000Z',
      postedAt: null,
      pending: false,
      source: 'manual',
      provider: null,
      externalId: null,
      bankAccountId: null,
      removedAt: null,
      userEditedAt: null,
    };
    const kpi = calculateProjectKPIs(project, [subcontract], [], []);

    expect(kpi.subcontractorCostCents).toBe(75_000);
    expect(kpi.actualMaterialsCostCents).toBe(0);
    expect(kpi.otherDirectCostsCents).toBe(0);
    expect(kpi.totalDirectCostCents).toBe(75_000);
    // Subs come out of net earnings, exactly as materials do.
    expect(kpi.netEarningsCents).toBe(245_000);
  });

  // CHANGED (bug 1): the KPI object used to carry `unassignedExpenseCount`,
  // which counted every unassigned transaction in the book and so reported the
  // same number on every project. Unassigned transactions belong to no project
  // by definition, so there is no per-project count to report: the field is
  // gone and only BusinessFinancialSummary.unassignedTransactionsCount remains.
  it('CHANGED: no longer reports a per-project unassigned expense count', () => {
    for (const project of SEED_PROJECTS) {
      expect(kpiFor(project.id)).not.toHaveProperty('unassignedExpenseCount');
    }
    // Nothing is lost: no unassigned transaction is attached to a project.
    expect(
      SEED_TRANSACTIONS.filter((t) => t.status === 'unassigned' && t.projectId)
    ).toEqual([]);
  });

  // CHANGED (bug 2): materialsMarkupPct used to fall back to 20 - exactly the
  // MATERIAL_MARKUP.HEALTHY threshold - whenever there were no materials to
  // measure, so a project that had bought nothing yet showed a healthy markup.
  // With nothing to measure the answer is null, not a healthy-looking number.
  it('CHANGED: materials markup is null when there is nothing to measure', () => {
    const kpi = kpiFor('proj-5');
    expect(kpi.actualMaterialsCostCents).toBe(0);
    expect(kpi.materialsMarkupPct).toBeNull();
    expect(kpi.materialsMarkupSeverity).toBeNull();
  });

  it('reports net earnings per project, the input to business-wide realization', () => {
    expect(SEED_PROJECTS.map((p) => kpiFor(p.id).netEarningsCents)).toEqual([
      503_925, 264_805, 161_180, 111_950, 320_000,
    ]);
  });

  // CHANGED (bug 2, second pass): with no hours logged, realization used to
  // fall back to project.targetHourlyRateCents - $85/hr, which is exactly
  // HOURLY_REALIZATION.HEALTHY - and was then graded, so an unstarted project
  // rendered green. It also disagreed with the business-level figure it feeds,
  // which was already null for the same condition. Nothing worked, so there is
  // no rate to report.
  it('CHANGED: realization and its severity are null when no hours are logged', () => {
    const kpi = kpiFor('proj-5');
    expect(kpi.actualLaborHours).toBe(0);
    expect(kpi.netHourlyRealizationCents).toBeNull();
    expect(kpi.hourlySeverity).toBeNull();
  });

  it('grades realization as soon as there are hours to divide by', () => {
    const kpi = kpiFor('proj-1');
    expect(kpi.actualLaborHours).toBe(38);
    expect(kpi.netHourlyRealizationCents).toBe(13_261);
    expect(kpi.hourlySeverity).toBe('healthy');
  });
});
