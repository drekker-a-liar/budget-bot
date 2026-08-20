import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  ProjectFinancialKPIs,
} from '../types';
import {
  getGrossMarginSeverity,
  getHourlySeverity,
  getMaterialMarkupSeverity,
  getBudgetSeverity,
} from './thresholds';

export function calculateProjectKPIs(
  project: Project,
  transactions: ExpenseTransaction[],
  laborEntries: LaborEntry[],
  invoices: Invoice[]
): ProjectFinancialKPIs {
  const projectExpenses = transactions.filter(
    (t) => t.projectId === project.id && t.status === 'matched'
  );
  const projectLabor = laborEntries.filter((l) => l.projectId === project.id);
  const projectInvoices = invoices.filter((i) => i.projectId === project.id);

  // Direct Cost Breakdowns
  const actualMaterialsCost = projectExpenses
    .filter((t) => t.category === 'materials')
    .reduce((sum, t) => sum + t.amount, 0);

  const subcontractorCost = projectExpenses
    .filter((t) => t.category === 'subcontractor')
    .reduce((sum, t) => sum + t.amount, 0);

  const otherDirectCosts = projectExpenses
    .filter((t) => t.category !== 'materials' && t.category !== 'subcontractor')
    .reduce((sum, t) => sum + t.amount, 0);

  // Labor Costs & Hours
  const actualLaborHours = projectLabor.reduce((sum, l) => sum + l.hours, 0);
  const actualLaborCost = projectLabor.reduce(
    (sum, l) => sum + l.hours * l.hourlyRate,
    0
  );

  const totalDirectCost =
    actualMaterialsCost + subcontractorCost + otherDirectCosts + actualLaborCost;

  // Revenue Billed / Collected
  const totalInvoiced = projectInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const revenue = totalInvoiced > 0 ? totalInvoiced : project.quotedTotal;

  // Gross Profit & Margins
  const grossProfit = revenue - totalDirectCost;
  const grossMarginPct =
    revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

  // Net Hourly Realization (True earnings per hour after materials and sub costs)
  const netEarnings = revenue - actualMaterialsCost - subcontractorCost - otherDirectCosts;
  const netHourlyRealization =
    actualLaborHours > 0
      ? Math.round((netEarnings / actualLaborHours) * 100) / 100
      : project.targetHourlyRate;

  // Materials Markup % (Difference between quoted materials vs actual)
  const materialsMarkupPct =
    actualMaterialsCost > 0 && project.quotedMaterials > 0
      ? Math.round(
          ((project.quotedMaterials - actualMaterialsCost) /
            actualMaterialsCost) *
            1000
        ) / 10
      : 20;

  // Budget Variance
  const budgetVariancePct =
    project.quotedTotal > 0
      ? Math.round((totalDirectCost / project.quotedTotal) * 1000) / 10
      : 0;

  const unassignedExpenseCount = transactions.filter(
    (t) => t.status === 'unassigned'
  ).length;

  return {
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    revenue,
    quotedTotal: project.quotedTotal,
    actualMaterialsCost,
    actualLaborCost,
    subcontractorCost,
    otherDirectCosts,
    totalDirectCost,
    actualLaborHours,
    quotedLaborHours: project.quotedLaborHours,
    grossProfit,
    grossMarginPct,
    grossMarginSeverity: getGrossMarginSeverity(grossMarginPct),
    netHourlyRealization,
    hourlySeverity: getHourlySeverity(netHourlyRealization),
    materialsMarkupPct,
    materialsMarkupSeverity: getMaterialMarkupSeverity(materialsMarkupPct),
    budgetVariancePct,
    budgetSeverity: getBudgetSeverity(budgetVariancePct),
    isOverBudget: totalDirectCost > project.quotedTotal,
    unassignedExpenseCount,
  };
}
