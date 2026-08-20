export type ProjectStatus = 'estimating' | 'in_progress' | 'completed' | 'on_hold';
export type PricingType = 'fixed' | 'time_and_materials';

export type ExpenseCategory =
  | 'materials'
  | 'tools'
  | 'subcontractor'
  | 'mileage_fuel'
  | 'permits_fees'
  | 'overhead';

export type PaymentMethod = 'card' | 'cash' | 'check' | 'transfer';
export type TransactionStatus = 'matched' | 'unassigned' | 'ignored';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
export type SeverityLevel = 'healthy' | 'caution' | 'critical';

export interface Project {
  id: string;
  name: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  description: string;
  status: ProjectStatus;
  pricingType: PricingType;
  quotedTotal: number;
  quotedMaterials: number;
  quotedLaborHours: number;
  targetHourlyRate: number; // e.g. $85/hr
  targetMarginPct: number; // e.g. 45%
  startDate: string;
  deadlineDate?: string;
  completedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseTransaction {
  id: string;
  date: string;
  description: string;
  vendor: string;
  amount: number;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  cardLast4?: string;
  status: TransactionStatus;
  projectId?: string;
  receiptNumber?: string;
  taxDeductible: boolean;
  notes?: string;
  createdAt: string;
}

export interface LaborEntry {
  id: string;
  projectId: string;
  date: string;
  hours: number;
  hourlyRate: number;
  workerName: string; // e.g. "Mike (Owner)" or "Helper (Jake)"
  notes?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  projectId: string;
  invoiceNumber: string;
  amount: number;
  depositAmount: number;
  dateIssued: string;
  dueDate: string;
  status: InvoiceStatus;
  paidDate?: string;
  notes?: string;
  createdAt: string;
}

export interface CardProfile {
  id: string;
  cardName: string;
  issuer: string;
  last4: string;
  cardType: 'credit' | 'debit';
  currentBalance: number;
  creditLimit: number;
  cycleResetDay: number;
  lastSyncedAt: string;
}

export interface ProjectFinancialKPIs {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  revenue: number;
  quotedTotal: number;
  actualMaterialsCost: number;
  actualLaborCost: number;
  subcontractorCost: number;
  otherDirectCosts: number;
  totalDirectCost: number;
  actualLaborHours: number;
  quotedLaborHours: number;
  grossProfit: number;
  grossMarginPct: number;
  grossMarginSeverity: SeverityLevel;
  netHourlyRealization: number;
  hourlySeverity: SeverityLevel;
  materialsMarkupPct: number;
  materialsMarkupSeverity: SeverityLevel;
  budgetVariancePct: number;
  budgetSeverity: SeverityLevel;
  isOverBudget: boolean;
  unassignedExpenseCount: number;
}

export interface BusinessFinancialSummary {
  totalRevenueYTD: number;
  totalMaterialsYTD: number;
  totalLaborYTD: number;
  totalGrossProfitYTD: number;
  averageMarginPct: number;
  averageMarginSeverity: SeverityLevel;
  averageHourlyRealization: number;
  averageHourlySeverity: SeverityLevel;
  openProjectsCount: number;
  unassignedTransactionsCount: number;
  unassignedTransactionsTotal: number;
  outstandingReceivables: number;
  overdueReceivables: number;
  receivablesSeverity: SeverityLevel;
  weeklyCashInflow: number;
  weeklyCashOutflow: number;
  weeklyNetCashFlow: number;
  cashFlowSeverity: SeverityLevel;
}
