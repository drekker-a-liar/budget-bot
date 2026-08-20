import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  BusinessFinancialSummary,
  SeverityLevel,
} from '../types';
import { getGrossMarginSeverity, getHourlySeverity } from './thresholds';
import { calculateProjectKPIs } from './project';

export function calculateBusinessSummary(
  projects: Project[],
  transactions: ExpenseTransaction[],
  laborEntries: LaborEntry[],
  invoices: Invoice[],
  now: Date
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

  // Realization uses the same net earnings each project reports, so the
  // business figure is the per-project figure scaled up rather than a second,
  // rosier definition. Null when there are no hours to divide by.
  const totalHours = kpis.reduce((sum, k) => sum + k.actualLaborHours, 0);
  const totalNetEarnings = kpis.reduce((sum, k) => sum + k.netEarnings, 0);
  const averageHourlyRealization =
    totalHours > 0 ? Math.round((totalNetEarnings / totalHours) * 100) / 100 : null;

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

  // Weekly Cash Flow (the seven days ending at `now`)
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
    averageHourlySeverity:
      averageHourlyRealization === null
        ? null
        : getHourlySeverity(averageHourlyRealization),
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
