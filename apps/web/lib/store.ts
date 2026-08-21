import {
  CardProfile,
  ExpenseTransaction,
  Invoice,
  LaborEntry,
  Project,
} from '@budget-bot/core';

/**
 * The storage contract the API routes are written against. Two implementations
 * satisfy it while the application moves off the prototype's JSON file:
 * `jsonStore` (the default) and `pgStore` (`USE_PG=1`). Both are async so that
 * the call sites do not change when the JSON one is deleted.
 *
 * TEMP: removed in the sub-project that moves reads into Server Components.
 */

export interface DatabaseSnapshot {
  projects: Project[];
  transactions: ExpenseTransaction[];
  laborEntries: LaborEntry[];
  invoices: Invoice[];
  /** Null once storage is Postgres and no bank account has been linked yet. */
  cardProfile: CardProfile | null;
  version: number;
}

export type NewProject = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
export type NewTransaction = Omit<ExpenseTransaction, 'id' | 'createdAt' | 'updatedAt'>;
export type NewLaborEntry = Omit<LaborEntry, 'id' | 'createdAt' | 'updatedAt'>;
export type NewInvoice = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;

export interface Store {
  getAll(): Promise<DatabaseSnapshot>;

  getProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | undefined>;
  createProject(project: NewProject): Promise<Project>;
  updateProject(id: string, updates: Partial<NewProject>): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;

  getTransactions(): Promise<ExpenseTransaction[]>;
  createTransaction(transaction: NewTransaction): Promise<ExpenseTransaction>;
  updateTransaction(
    id: string,
    updates: Partial<NewTransaction>
  ): Promise<ExpenseTransaction | null>;
  deleteTransaction(id: string): Promise<boolean>;
  bulkImportTransactions(items: NewTransaction[]): Promise<ExpenseTransaction[]>;

  getLaborEntries(projectId?: string): Promise<LaborEntry[]>;
  createLaborEntry(entry: NewLaborEntry): Promise<LaborEntry>;
  deleteLaborEntry(id: string): Promise<boolean>;

  getInvoices(projectId?: string): Promise<Invoice[]>;
  createInvoice(invoice: NewInvoice): Promise<Invoice>;
  updateInvoice(id: string, updates: Partial<NewInvoice>): Promise<Invoice | null>;

  getCardProfile(): Promise<CardProfile | null>;
  updateCardProfile(updates: Partial<CardProfile>): Promise<CardProfile | null>;
}
