import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  BusinessFinancialSummary,
  SeverityLevel,
} from '../types';
import { addCents, multiplyCents, percent, subtractCents } from '../money';
import { getGrossMarginSeverity, getHourlySeverity } from './thresholds';
import { calculateProjectKPIs } from './project';

/** $2,000 and $500 of overdue receivables, in cents. */
const OVERDUE_CRITICAL_CENTS = 200_000;
const OVERDUE_CAUTION_CENTS = 50_000;
/** A week $500 in the red, in cents. */
const WEEKLY_CASH_CRITICAL_CENTS = -50_000;

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

  const totalRevenueYTDCents = addCents(...kpis.map((k) => k.revenueCents));
  const totalMaterialsYTDCents = addCents(...kpis.map((k) => k.actualMaterialsCostCents));
  const totalLaborYTDCents = addCents(...kpis.map((k) => k.actualLaborCostCents));
  const totalGrossProfitYTDCents = addCents(...kpis.map((k) => k.grossProfitCents));

  const averageMarginPct =
    percent(totalGrossProfitYTDCents, totalRevenueYTDCents) ?? 0;

  // Realization uses the same net earnings each project reports, so the
  // business figure is the per-project figure scaled up rather than a second,
  // rosier definition. Null when there are no hours to divide by.
  const totalHours = kpis.reduce((sum, k) => sum + k.actualLaborHours, 0);
  const totalNetEarningsCents = addCents(...kpis.map((k) => k.netEarningsCents));
  const averageHourlyRealizationCents =
    totalHours > 0 ? multiplyCents(totalNetEarningsCents, 1 / totalHours) : null;

  const openProjectsCount = projects.filter(
    (p) => p.status === 'in_progress' || p.status === 'estimating'
  ).length;

  const unassigned = transactions.filter((t) => t.status === 'unassigned');
  const unassignedTransactionsCount = unassigned.length;
  const unassignedTransactionsTotalCents = addCents(
    ...unassigned.map((t) => t.amountCents)
  );

  // Invoices & Receivables
  const outstandingReceivablesCents = addCents(
    ...invoices
      .filter((i) => i.status === 'sent' || i.status === 'overdue')
      .map((i) => i.amountCents)
  );
  const overdueReceivablesCents = addCents(
    ...invoices.filter((i) => i.status === 'overdue').map((i) => i.amountCents)
  );

  let receivablesSeverity: SeverityLevel = 'healthy';
  if (overdueReceivablesCents > OVERDUE_CRITICAL_CENTS) receivablesSeverity = 'critical';
  else if (overdueReceivablesCents > OVERDUE_CAUTION_CENTS) receivablesSeverity = 'caution';

  // Weekly Cash Flow (the seven days ending at `now`)
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const weeklyCashInflowCents = addCents(
    ...invoices
      .filter(
        (i) => i.status === 'paid' && i.paidDate && new Date(i.paidDate) >= oneWeekAgo
      )
      .map((i) => i.amountCents)
  );

  // Money that actually went out, by the same rule the cash-flow waterfall
  // and the category breakdown use: not `ignored`, and not negative. A card
  // payment or a refund is both, and summing one here would *reduce* outflow
  // and make the KPI rosier than the waterfall drawn beside it on the same
  // page - two numbers about one week, from the same rows, disagreeing.
  const weeklyCashOutflowCents = addCents(
    ...transactions
      .filter(
        (t) =>
          t.status !== 'ignored' &&
          t.amountCents > 0 &&
          new Date(t.date) >= oneWeekAgo
      )
      .map((t) => t.amountCents)
  );

  const weeklyNetCashFlowCents = subtractCents(
    weeklyCashInflowCents,
    weeklyCashOutflowCents
  );

  let cashFlowSeverity: SeverityLevel = 'healthy';
  if (weeklyNetCashFlowCents < WEEKLY_CASH_CRITICAL_CENTS) cashFlowSeverity = 'critical';
  else if (weeklyNetCashFlowCents < 0) cashFlowSeverity = 'caution';

  return {
    totalRevenueYTDCents,
    totalMaterialsYTDCents,
    totalLaborYTDCents,
    totalGrossProfitYTDCents,
    averageMarginPct,
    averageMarginSeverity: getGrossMarginSeverity(averageMarginPct),
    averageHourlyRealizationCents,
    averageHourlySeverity:
      averageHourlyRealizationCents === null
        ? null
        : getHourlySeverity(averageHourlyRealizationCents),
    openProjectsCount,
    unassignedTransactionsCount,
    unassignedTransactionsTotalCents,
    outstandingReceivablesCents,
    overdueReceivablesCents,
    receivablesSeverity,
    weeklyCashInflowCents,
    weeklyCashOutflowCents,
    weeklyNetCashFlowCents,
    cashFlowSeverity,
  };
}
