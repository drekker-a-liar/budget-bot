import {
  parseMoney,
  type BusinessFinancialSummary,
  type ExpenseTransaction,
  type Invoice,
  type LaborEntry,
  type Project,
  type ProjectFinancialKPIs,
} from '@budget-bot/core';

/**
 * Prop builders for the component tests.
 *
 * Every component in `components/` renders from props alone, so the tests need
 * whole domain objects and care about two or three fields of each. These
 * builders give a coherent default and take an override, which keeps the
 * interesting value visible at the call site instead of buried in a wall of
 * fields nobody is asserting on.
 */

export function aProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Cedar Deck Reconstruction',
    clientName: 'Robert Henderson',
    clientPhone: '(555) 876-5432',
    clientAddress: '1204 Pine Valley Way',
    description: 'Tear out and rebuild a 16x20 deck.',
    status: 'in_progress',
    pricingType: 'fixed',
    quotedTotalCents: parseMoney(4500),
    quotedMaterialsCents: parseMoney(1750),
    quotedLaborHours: 32,
    targetHourlyRateCents: parseMoney(85),
    targetMarginPct: 45,
    startDate: '2026-08-02',
    createdAt: '2026-08-01T09:15:00.000Z',
    ...overrides,
  };
}

export function aTransaction(
  overrides: Partial<ExpenseTransaction> = {}
): ExpenseTransaction {
  return {
    id: 'tx-1',
    date: '2026-08-18',
    description: 'THE HOME DEPOT #0421 - Deck screws',
    vendor: 'The Home Depot',
    amountCents: parseMoney(88.65),
    category: 'materials',
    paymentMethod: 'card',
    status: 'unassigned',
    taxDeductible: true,
    createdAt: '2026-08-18T14:30:00.000Z',
    postedAt: null,
    pending: false,
    source: 'manual',
    provider: null,
    externalId: null,
    bankAccountId: null,
    removedAt: null,
    userEditedAt: null,
    ...overrides,
  };
}

export function aLaborEntry(overrides: Partial<LaborEntry> = {}): LaborEntry {
  return {
    id: 'lab-1',
    projectId: 'proj-1',
    date: '2026-08-17',
    hours: 6,
    hourlyRateCents: parseMoney(85),
    workerName: 'Mike (Lead)',
    createdAt: '2026-08-17T15:00:00.000Z',
    ...overrides,
  };
}

export function anInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    projectId: 'proj-1',
    invoiceNumber: 'INV-2026-042',
    amountCents: parseMoney(4500),
    depositAmountCents: parseMoney(1500),
    dateIssued: '2026-08-13',
    dueDate: '2026-08-20',
    status: 'sent',
    createdAt: '2026-08-13T17:00:00.000Z',
    ...overrides,
  };
}

export function aKpi(
  overrides: Partial<ProjectFinancialKPIs> = {}
): ProjectFinancialKPIs {
  return {
    projectId: 'proj-1',
    projectName: 'Cedar Deck Reconstruction',
    status: 'in_progress',
    revenueCents: parseMoney(4500),
    quotedTotalCents: parseMoney(4500),
    actualMaterialsCostCents: parseMoney(1000),
    actualLaborCostCents: parseMoney(1000),
    subcontractorCostCents: parseMoney(0),
    otherDirectCostsCents: parseMoney(0),
    totalDirectCostCents: parseMoney(2000),
    actualLaborHours: 20,
    quotedLaborHours: 32,
    grossProfitCents: parseMoney(2500),
    netEarningsCents: parseMoney(3500),
    grossMarginPct: 55.6,
    grossMarginSeverity: 'healthy',
    netHourlyRealizationCents: parseMoney(175),
    hourlySeverity: 'healthy',
    materialsMarkupPct: 75,
    materialsMarkupSeverity: 'healthy',
    budgetVariancePct: 62.5,
    budgetSeverity: 'healthy',
    isOverBudget: false,
    ...overrides,
  };
}

export function aSummary(
  overrides: Partial<BusinessFinancialSummary> = {}
): BusinessFinancialSummary {
  return {
    totalRevenueYTDCents: parseMoney(13250),
    totalMaterialsYTDCents: parseMoney(3500),
    totalLaborYTDCents: parseMoney(4200),
    totalGrossProfitYTDCents: parseMoney(5550),
    averageMarginPct: 41.9,
    averageMarginSeverity: 'caution',
    averageHourlyRealizationCents: parseMoney(96.5),
    averageHourlySeverity: 'healthy',
    openProjectsCount: 2,
    unassignedTransactionsCount: 3,
    unassignedTransactionsTotalCents: parseMoney(372.85),
    outstandingReceivablesCents: parseMoney(4500),
    overdueReceivablesCents: parseMoney(0),
    receivablesSeverity: 'healthy',
    weeklyCashInflowCents: parseMoney(1800),
    weeklyCashOutflowCents: parseMoney(1188.75),
    weeklyNetCashFlowCents: parseMoney(611.25),
    cashFlowSeverity: 'healthy',
    ...overrides,
  };
}
