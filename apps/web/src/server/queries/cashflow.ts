import 'server-only';
import { cache } from 'react';
import {
  calculateBusinessSummary,
  type BusinessFinancialSummary,
  type CardProfile,
  type Invoice,
  type Project,
  type WeeklyCashFlow,
} from '@budget-bot/core';
import {
  bankRepo,
  getDb,
  invoicesRepo,
  laborRepo,
  ownersRepo,
  projectsRepo,
  transactionsRepo,
} from '@budget-bot/db';
import { countUnassigned } from './projects';
import { spendByCategory, type SpendBreakdown } from './spend';
import { calculateWeeklyCashFlow } from './weeks';

/**
 * What the liquidity page reads: the four-week waterfall, the receivables
 * ledger, and the spend split by category.
 *
 * `now` is a parameter for the same reason it is on the dashboard: the window
 * is part of the answer. The owner's time zone travels with it so "overdue"
 * is judged against their calendar day, not UTC's.
 */

export interface CashflowPageData {
  summary: BusinessFinancialSummary;
  weeks: WeeklyCashFlow[];
  spend: SpendBreakdown;
  invoices: Invoice[];
  projects: Project[];
  cardProfile: CardProfile | null;
  unassignedCount: number;
}

export const getCashflowPage = cache(
  async (ownerId: string, now: Date): Promise<CashflowPageData> => {
    const db = getDb();
    const [projects, transactions, laborEntries, invoices, cardProfile, timeZone] =
      await Promise.all([
        projectsRepo.listProjects(db, ownerId),
        transactionsRepo.listTransactions(db, ownerId),
        laborRepo.listLaborEntries(db, ownerId),
        invoicesRepo.listInvoices(db, ownerId),
        bankRepo.getCardProfile(db, ownerId),
        ownersRepo.getTimeZone(db, ownerId),
      ]);

    return {
      summary: calculateBusinessSummary(
        projects,
        transactions,
        laborEntries,
        invoices,
        now,
        timeZone
      ),
      weeks: calculateWeeklyCashFlow({ transactions, invoices }, now),
      spend: spendByCategory(transactions),
      invoices,
      projects,
      cardProfile,
      unassignedCount: countUnassigned(transactions),
    };
  }
);
