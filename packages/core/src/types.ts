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

/**
 * What a bank feed adds to a transaction, on top of what the form sends
 * (`TransactionInput`) and what persistence adds to everything (`Persisted`).
 * A form never sends these - `TransactionInput` stays the form schema - so
 * they live here rather than growing the zod input.
 */
interface BankColumns {
  /** When the bank says it posted; null until it does, and for hand-entered rows. */
  postedAt: string | null;
  pending: boolean;
  source: 'manual' | 'csv' | 'plaid';
  provider: string | null;
  externalId: string | null;
  bankAccountId: string | null;
  removedAt: string | null;
  userEditedAt: string | null;
}

export type Project = z.infer<typeof ProjectInput> & Persisted;
export type ExpenseTransaction = z.infer<typeof TransactionInput> & Persisted & BankColumns;
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
  /** Null when no hours have been logged against the project. */
  netHourlyRealizationCents: Cents | null;
  hourlySeverity: SeverityLevel | null;
  /** Null when no materials have been bought, or none were quoted. */
  materialsMarkupPct: number | null;
  materialsMarkupSeverity: SeverityLevel | null;
  budgetVariancePct: number;
  budgetSeverity: SeverityLevel;
  isOverBudget: boolean;
}

/**
 * One week of cash in and cash out, on a cash basis (ADR 0006).
 *
 * The shape only; the aggregation that fills it is the application's for now
 * and moves into this package with the monthly margin work (sub-project 4),
 * which is where the calendar and time-zone questions get settled properly.
 */
export interface WeeklyCashFlow {
  /** The Monday the week starts on, as `YYYY-MM-DD`. */
  weekStart: string;
  /** Money in: invoices by the date they were paid. */
  inflowCents: Cents;
  /** Money out: non-ignored expenses by the date they posted. */
  outflowCents: Cents;
  /** `inflowCents - outflowCents`. Negative is a week that lost money. */
  netCents: Cents;
}

export interface BusinessFinancialSummary {
  totalRevenueYTDCents: Cents;
  totalMaterialsYTDCents: Cents;
  totalLaborYTDCents: Cents;
  totalGrossProfitYTDCents: Cents;
  /** Null when nothing has been invoiced — never a fabricated 0%. */
  averageMarginPct: number | null;
  averageMarginSeverity: SeverityLevel | null;
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
