import type { z } from 'zod';
import type { Cents } from './money';
import type {
  ProjectStatus,
  InvoiceInput,
  LaborEntryInput,
  ProjectInput,
  TransactionInput,
} from './schemas';

// types.ts is the single export surface for the domain's shapes; the zod
// schemas the entity types are inferred from come through here too.
export * from './schemas';

export type SeverityLevel = 'healthy' | 'caution' | 'critical';

/** What persistence adds to every user-supplied input. */
interface Persisted {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

export type Project = z.infer<typeof ProjectInput> & Persisted;
export type ExpenseTransaction = z.infer<typeof TransactionInput> & Persisted;
export type LaborEntry = z.infer<typeof LaborEntryInput> & Persisted;
export type Invoice = z.infer<typeof InvoiceInput> & Persisted;

export interface CardProfile {
  id: string;
  cardName: string;
  issuer: string;
  last4: string;
  cardType: 'credit' | 'debit';
  currentBalanceCents: Cents;
  creditLimitCents: Cents;
  cycleResetDay: number;
  lastSyncedAt: string;
}

export interface ProjectFinancialKPIs {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  revenueCents: Cents;
  quotedTotalCents: Cents;
  actualMaterialsCostCents: Cents;
  actualLaborCostCents: Cents;
  subcontractorCostCents: Cents;
  otherDirectCostsCents: Cents;
  totalDirectCostCents: Cents;
  actualLaborHours: number;
  quotedLaborHours: number;
  grossProfitCents: Cents;
  /** Revenue less every non-labour direct cost; the numerator of realization. */
  netEarningsCents: Cents;
  grossMarginPct: number;
  grossMarginSeverity: SeverityLevel;
  netHourlyRealizationCents: Cents;
  hourlySeverity: SeverityLevel;
  /** Null when no materials have been bought, or none were quoted. */
  materialsMarkupPct: number | null;
  materialsMarkupSeverity: SeverityLevel | null;
  budgetVariancePct: number;
  budgetSeverity: SeverityLevel;
  isOverBudget: boolean;
}

export interface BusinessFinancialSummary {
  totalRevenueYTDCents: Cents;
  totalMaterialsYTDCents: Cents;
  totalLaborYTDCents: Cents;
  totalGrossProfitYTDCents: Cents;
  averageMarginPct: number;
  averageMarginSeverity: SeverityLevel;
  /** Null when no hours have been logged anywhere in the book of business. */
  averageHourlyRealizationCents: Cents | null;
  averageHourlySeverity: SeverityLevel | null;
  openProjectsCount: number;
  unassignedTransactionsCount: number;
  unassignedTransactionsTotalCents: Cents;
  outstandingReceivablesCents: Cents;
  overdueReceivablesCents: Cents;
  receivablesSeverity: SeverityLevel;
  weeklyCashInflowCents: Cents;
  weeklyCashOutflowCents: Cents;
  weeklyNetCashFlowCents: Cents;
  cashFlowSeverity: SeverityLevel;
}
