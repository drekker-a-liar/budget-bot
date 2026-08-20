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
      grossMarginPct: 26.6,
      grossMarginSeverity: 'caution',
      netHourlyRealization: 132.61,
      hourlySeverity: 'healthy',
      materialsMarkupPct: 51.6,
      materialsMarkupSeverity: 'healthy',
      budgetVariancePct: 73.4,
      budgetSeverity: 'healthy',
      isOverBudget: false,
      unassignedExpenseCount: 3,
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

  // The defects this task fixes.
  it('BUG 1: unassignedExpenseCount is the global count, repeated on every project', () => {
    const counts = SEED_PROJECTS.map((p) => kpiFor(p.id).unassignedExpenseCount);
    expect(counts).toEqual([3, 3, 3, 3, 3]);
    // ...even though no unassigned transaction is attached to any project.
    expect(
      SEED_TRANSACTIONS.filter((t) => t.status === 'unassigned' && t.projectId)
    ).toEqual([]);
  });

  it('BUG 2: with no data, sentinels fabricate healthy-looking KPIs', () => {
    const kpi = kpiFor('proj-5');
    expect(kpi.actualLaborHours).toBe(0);
    expect(kpi.netHourlyRealization).toBe(85); // = project.targetHourlyRate
    expect(kpi.actualMaterialsCost).toBe(0);
    expect(kpi.materialsMarkupPct).toBe(20); // = the MATERIAL_MARKUP.HEALTHY line
    expect(kpi.materialsMarkupSeverity).toBe('healthy');
  });
});
