import { describe, expect, it } from 'vitest';
import { calculateProjectKPIs } from '../../src/metrics/project';
import {
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '../fixtures';

// CHARACTERIZATION: pins calculateProjectKPIs against the prototype seed data
// exactly as it behaved when packages/core was extracted, float dollars and
// all. Values with visible binary drift (268.0500000000002) are deliberate:
// they are the evidence that motivates the integer-cents conversion.

const kpiFor = (projectId: string) => {
  const project = SEED_PROJECTS.find((p) => p.id === projectId)!;
  return calculateProjectKPIs(project, SEED_TRANSACTIONS, SEED_LABOR, SEED_INVOICES);
};

describe('calculateProjectKPIs (characterization)', () => {
  it('proj-1: invoiced project, revenue comes from invoices', () => {
    expect(kpiFor('proj-1')).toEqual({
      projectId: 'proj-1',
      projectName: 'Master Bath Tile & Double Vanity Remodel',
      status: 'completed',
      revenue: 6800,
      quotedTotal: 6800,
      actualMaterialsCost: 1450.75,
      actualLaborCost: 3230,
      subcontractorCost: 0,
      otherDirectCosts: 310,
      totalDirectCost: 4990.75,
      actualLaborHours: 38,
      quotedLaborHours: 42,
      grossProfit: 1809.25,
      netEarnings: 5039.25,
      grossMarginPct: 26.6,
      grossMarginSeverity: 'caution',
      netHourlyRealization: 132.61,
      hourlySeverity: 'healthy',
      materialsMarkupPct: 51.6,
      materialsMarkupSeverity: 'healthy',
      budgetVariancePct: 73.4,
      budgetSeverity: 'healthy',
      isOverBudget: false,
    });
  });

  it('proj-2: float drift is visible in gross profit', () => {
    const kpi = kpiFor('proj-2');
    expect(kpi.grossProfit).toBe(268.0500000000002);
    expect(kpi.grossMarginPct).toBe(6);
    expect(kpi.grossMarginSeverity).toBe('critical');
    expect(kpi.materialsMarkupPct).toBe(-5.5);
    expect(kpi.budgetVariancePct).toBe(94);
    expect(kpi.budgetSeverity).toBe('caution');
  });

  it('proj-3: float drift is visible in materials cost', () => {
    const kpi = kpiFor('proj-3');
    expect(kpi.actualMaterialsCost).toBe(338.20000000000005);
    expect(kpi.grossProfit).toBe(471.79999999999995);
    expect(kpi.grossMarginPct).toBe(24.2);
    expect(kpi.netHourlyRealization).toBe(134.32);
  });

  it('proj-4: partially invoiced work uses the invoiced amount, not the quote', () => {
    const kpi = kpiFor('proj-4');
    expect(kpi.revenue).toBe(1800);
    expect(kpi.quotedTotal).toBe(3600);
    expect(kpi.budgetVariancePct).toBe(48.9);
  });

  it('proj-5: with no invoices, revenue falls back to the quoted total', () => {
    const kpi = kpiFor('proj-5');
    expect(kpi.revenue).toBe(3200);
    expect(kpi.grossMarginPct).toBe(100);
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
    expect(kpi.actualMaterialsCost).toBe(0);
    expect(kpi.materialsMarkupPct).toBeNull();
    expect(kpi.materialsMarkupSeverity).toBeNull();
  });

  it('reports net earnings per project, the input to business-wide realization', () => {
    expect(SEED_PROJECTS.map((p) => kpiFor(p.id).netEarnings)).toEqual([
      5039.25, 2648.05, 1611.8, 1119.5, 3200,
    ]);
  });

  // Deliberately unchanged: with no hours logged, per-project realization still
  // falls back to the project's own target rate. That is the rate the estimate
  // was priced at, not an invented constant, so it stays until a later task
  // decides what an hours-less project should display.
  it('per-project realization still falls back to the project target rate', () => {
    const kpi = kpiFor('proj-5');
    expect(kpi.actualLaborHours).toBe(0);
    expect(kpi.netHourlyRealization).toBe(85);
  });
});
