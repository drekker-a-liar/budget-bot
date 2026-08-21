import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  ProjectFinancialKPIs,
} from '../types';
import { addCents, multiplyCents, percent, subtractCents } from '../money';
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
  const actualMaterialsCostCents = addCents(
    ...projectExpenses.filter((t) => t.category === 'materials').map((t) => t.amountCents)
  );

  const subcontractorCostCents = addCents(
    ...projectExpenses
      .filter((t) => t.category === 'subcontractor')
      .map((t) => t.amountCents)
  );

  const otherDirectCostsCents = addCents(
    ...projectExpenses
      .filter((t) => t.category !== 'materials' && t.category !== 'subcontractor')
      .map((t) => t.amountCents)
  );

  // Labor Costs & Hours
  const actualLaborHours = projectLabor.reduce((sum, l) => sum + l.hours, 0);
  const actualLaborCostCents = addCents(
    ...projectLabor.map((l) => multiplyCents(l.hourlyRateCents, l.hours))
  );

  const totalDirectCostCents = addCents(
    actualMaterialsCostCents,
    subcontractorCostCents,
    otherDirectCostsCents,
    actualLaborCostCents
  );

  // Revenue Billed / Collected
  const totalInvoicedCents = addCents(...projectInvoices.map((inv) => inv.amountCents));
  const revenueCents =
    totalInvoicedCents > 0 ? totalInvoicedCents : project.quotedTotalCents;

  // Gross Profit & Margins
  const grossProfitCents = subtractCents(revenueCents, totalDirectCostCents);
  const grossMarginPct = percent(grossProfitCents, revenueCents) ?? 0;

  // Net Hourly Realization (True earnings per hour after materials and sub
  // costs). Null when nobody has worked on the project: there is no rate to
  // report, and the business-level figure this feeds is null for the same
  // reason.
  const netEarningsCents = subtractCents(
    revenueCents,
    addCents(actualMaterialsCostCents, subcontractorCostCents, otherDirectCostsCents)
  );
  const netHourlyRealizationCents =
    actualLaborHours > 0 ? multiplyCents(netEarningsCents, 1 / actualLaborHours) : null;

  // Materials Markup % (Difference between quoted materials vs actual).
  // Null when there is nothing to compare: a project that has not bought
  // materials yet has no markup, healthy or otherwise.
  const materialsMarkupPct =
    actualMaterialsCostCents > 0 && project.quotedMaterialsCents > 0
      ? percent(
          subtractCents(project.quotedMaterialsCents, actualMaterialsCostCents),
          actualMaterialsCostCents
        )
      : null;

  // Budget Variance
  const budgetVariancePct = percent(totalDirectCostCents, project.quotedTotalCents) ?? 0;

  return {
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    revenueCents,
    quotedTotalCents: project.quotedTotalCents,
    actualMaterialsCostCents,
    actualLaborCostCents,
    subcontractorCostCents,
    otherDirectCostsCents,
    totalDirectCostCents,
    actualLaborHours,
    quotedLaborHours: project.quotedLaborHours,
    grossProfitCents,
    netEarningsCents,
    grossMarginPct,
    grossMarginSeverity: getGrossMarginSeverity(grossMarginPct),
    netHourlyRealizationCents,
    hourlySeverity:
      netHourlyRealizationCents === null
        ? null
        : getHourlySeverity(netHourlyRealizationCents),
    materialsMarkupPct,
    materialsMarkupSeverity:
      materialsMarkupPct === null ? null : getMaterialMarkupSeverity(materialsMarkupPct),
    budgetVariancePct,
    budgetSeverity: getBudgetSeverity(budgetVariancePct),
    isOverBudget: totalDirectCostCents > project.quotedTotalCents,
  };
}
