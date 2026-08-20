import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  ProjectFinancialKPIs,
  BusinessFinancialSummary,
  SeverityLevel,
} from './types';

// Severity Threshold Constants
export const THRESHOLDS = {
  GROSS_MARGIN: {
    HEALTHY: 45, // >= 45% is green
    CAUTION: 25, // 25% - 44% is yellow, < 25% is red
  },
  HOURLY_REALIZATION: {
    HEALTHY: 85, // >= $85/hr is green
    CAUTION: 50, // $50 - $84/hr is yellow, < $50 is red
  },
  MATERIAL_MARKUP: {
    HEALTHY: 20, // >= 20% is green
    CAUTION: 10, // 10% - 19% is yellow, < 10% is red
  },
  BUDGET_VARIANCE: {
    HEALTHY: 90, // <= 90% is green
    CAUTION: 100, // 91% - 100% is yellow, > 100% is red
  },
  RECEIVABLES_OVERDUE_DAYS: {
    HEALTHY: 14,
    CAUTION: 30,
  },
};

export function getGrossMarginSeverity(marginPct: number): SeverityLevel {
  if (marginPct >= THRESHOLDS.GROSS_MARGIN.HEALTHY) return 'healthy';
  if (marginPct >= THRESHOLDS.GROSS_MARGIN.CAUTION) return 'caution';
  return 'critical';
}

export function getHourlySeverity(hourlyRate: number): SeverityLevel {
  if (hourlyRate >= THRESHOLDS.HOURLY_REALIZATION.HEALTHY) return 'healthy';
  if (hourlyRate >= THRESHOLDS.HOURLY_REALIZATION.CAUTION) return 'caution';
  return 'critical';
}

export function getMaterialMarkupSeverity(markupPct: number): SeverityLevel {
  if (markupPct >= THRESHOLDS.MATERIAL_MARKUP.HEALTHY) return 'healthy';
  if (markupPct >= THRESHOLDS.MATERIAL_MARKUP.CAUTION) return 'caution';
  return 'critical';
}

export function getBudgetSeverity(spentRatioPct: number): SeverityLevel {
  if (spentRatioPct <= THRESHOLDS.BUDGET_VARIANCE.HEALTHY) return 'healthy';
  if (spentRatioPct <= THRESHOLDS.BUDGET_VARIANCE.CAUTION) return 'caution';
  return 'critical';
}

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

export function calculateBusinessSummary(
  projects: Project[],
  transactions: ExpenseTransaction[],
  laborEntries: LaborEntry[],
  invoices: Invoice[]
): BusinessFinancialSummary {
  const kpis = projects.map((p) =>
    calculateProjectKPIs(p, transactions, laborEntries, invoices)
  );

  const totalRevenueYTD = kpis.reduce((sum, k) => sum + k.revenue, 0);
  const totalMaterialsYTD = kpis.reduce((sum, k) => sum + k.actualMaterialsCost, 0);
  const totalLaborYTD = kpis.reduce((sum, k) => sum + k.actualLaborCost, 0);
  const totalGrossProfitYTD = kpis.reduce((sum, k) => sum + k.grossProfit, 0);

  const averageMarginPct =
    totalRevenueYTD > 0
      ? Math.round((totalGrossProfitYTD / totalRevenueYTD) * 1000) / 10
      : 0;

  const totalHours = kpis.reduce((sum, k) => sum + k.actualLaborHours, 0);
  const totalNetEarnings = totalRevenueYTD - totalMaterialsYTD;
  const averageHourlyRealization =
    totalHours > 0 ? Math.round((totalNetEarnings / totalHours) * 100) / 100 : 85;

  const openProjectsCount = projects.filter(
    (p) => p.status === 'in_progress' || p.status === 'estimating'
  ).length;

  const unassigned = transactions.filter((t) => t.status === 'unassigned');
  const unassignedTransactionsCount = unassigned.length;
  const unassignedTransactionsTotal = unassigned.reduce((s, t) => s + t.amount, 0);

  // Invoices & Receivables
  const unpaidInvoices = invoices.filter(
    (i) => i.status === 'sent' || i.status === 'overdue'
  );
  const outstandingReceivables = unpaidInvoices.reduce((s, i) => s + i.amount, 0);
  const overdueInvoices = invoices.filter((i) => i.status === 'overdue');
  const overdueReceivables = overdueInvoices.reduce((s, i) => s + i.amount, 0);

  let receivablesSeverity: SeverityLevel = 'healthy';
  if (overdueReceivables > 2000) receivablesSeverity = 'critical';
  else if (overdueReceivables > 500) receivablesSeverity = 'caution';

  // Weekly Cash Flow (Current Week)
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const weeklyCashInflow = invoices
    .filter((i) => i.status === 'paid' && i.paidDate && new Date(i.paidDate) >= oneWeekAgo)
    .reduce((s, i) => s + i.amount, 0);

  const weeklyCashOutflow = transactions
    .filter((t) => new Date(t.date) >= oneWeekAgo)
    .reduce((s, t) => s + t.amount, 0);

  const weeklyNetCashFlow = weeklyCashInflow - weeklyCashOutflow;

  let cashFlowSeverity: SeverityLevel = 'healthy';
  if (weeklyNetCashFlow < -500) cashFlowSeverity = 'critical';
  else if (weeklyNetCashFlow < 0) cashFlowSeverity = 'caution';

  return {
    totalRevenueYTD,
    totalMaterialsYTD,
    totalLaborYTD,
    totalGrossProfitYTD,
    averageMarginPct,
    averageMarginSeverity: getGrossMarginSeverity(averageMarginPct),
    averageHourlyRealization,
    averageHourlySeverity: getHourlySeverity(averageHourlyRealization),
    openProjectsCount,
    unassignedTransactionsCount,
    unassignedTransactionsTotal,
    outstandingReceivables,
    overdueReceivables,
    receivablesSeverity,
    weeklyCashInflow,
    weeklyCashOutflow,
    weeklyNetCashFlow,
    cashFlowSeverity,
  };
}
