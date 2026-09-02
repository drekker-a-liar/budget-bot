import 'server-only';
import { cache } from 'react';
import {
  calculateBusinessSummary,
  calculateProjectKPIs,
  type BusinessFinancialSummary,
  type CardProfile,
  type ExpenseTransaction,
  type Project,
  type ProjectFinancialKPIs,
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
import { calculateWeeklyCashFlow } from './weeks';

/**
 * Everything the overview page draws, in one read.
 *
 * `now` is a parameter rather than a `new Date()` inside: every figure here
 * that has a period in it - this week's cash flow, the four-week waterfall -
 * is a function of when it was asked, and a query that decides that for itself
 * cannot be tested against a boundary. The owner's time zone is read here at
 * the query edge, as `/margin` does, so the summary can say which calendar day
 * `now` falls on for them: an invoice due today is not overdue at 9pm just
 * because it is already tomorrow in UTC.
 */

export interface DashboardData {
  summary: BusinessFinancialSummary;
  projects: Project[];
  projectKPIs: ProjectFinancialKPIs[];
  transactions: ExpenseTransaction[];
  weeks: WeeklyCashFlow[];
  cardProfile: CardProfile | null;
  unassignedCount: number;
}

export const getDashboardData = cache(
  async (ownerId: string, now: Date): Promise<DashboardData> => {
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
      projects,
      projectKPIs: projects.map((project) =>
        calculateProjectKPIs(project, transactions, laborEntries, invoices)
      ),
      transactions,
      weeks: calculateWeeklyCashFlow({ transactions, invoices }, now),
      cardProfile,
      unassignedCount: countUnassigned(transactions),
    };
  }
);
