import 'server-only';
import { cache } from 'react';
import {
  calculateProjectKPIs,
  type Invoice,
  type LaborEntry,
  type Project,
  type ProjectFinancialKPIs,
  type ExpenseTransaction,
} from '@budget-bot/core';
import { getDb, invoicesRepo, laborRepo, projectsRepo, transactionsRepo } from '@budget-bot/db';

/**
 * What the project pages read.
 *
 * Reads happen in Server Components (spec §6), so this is where a repository
 * meets a metric: `@budget-bot/db` supplies the rows, `@budget-bot/core`
 * turns them into KPIs, and the page gets one object it can render. Nothing
 * here writes, and nothing here decides who is asking - `ownerId` is an
 * argument, resolved from the session by the page.
 *
 * `import 'server-only'` is the compile-time half of that: a client component
 * that imported this file would fail the build rather than ship a database
 * driver to the browser.
 *
 * `cache()` deduplicates within one render. Two components on a page that both
 * need the projects cause one query, without either of them knowing about the
 * other.
 */

export interface ProjectsPageData {
  projects: Project[];
  projectKPIs: ProjectFinancialKPIs[];
  /** For the header badge, which every page carries. */
  unassignedCount: number;
}

export const getProjectsPage = cache(
  async (ownerId: string): Promise<ProjectsPageData> => {
    const db = getDb();
    const [projects, transactions, laborEntries, invoices] = await Promise.all([
      projectsRepo.listProjects(db, ownerId),
      transactionsRepo.listTransactions(db, ownerId),
      laborRepo.listLaborEntries(db, ownerId),
      invoicesRepo.listInvoices(db, ownerId),
    ]);

    return {
      projects,
      projectKPIs: projects.map((project) =>
        calculateProjectKPIs(project, transactions, laborEntries, invoices)
      ),
      unassignedCount: countUnassigned(transactions),
    };
  }
);

export interface ProjectDetailData {
  project: Project;
  kpi: ProjectFinancialKPIs;
  transactions: ExpenseTransaction[];
  laborEntries: LaborEntry[];
  invoices: Invoice[];
  unassignedCount: number;
}

export const getProjectDetail = cache(
  async (ownerId: string, projectId: string): Promise<ProjectDetailData | null> => {
    const db = getDb();
    const project = await projectsRepo.getProject(db, ownerId, projectId);
    if (!project) return null;

    // The KPIs are calculated over the whole book, not over this project's
    // rows: `calculateProjectKPIs` filters them itself, and handing it a
    // pre-filtered list would make the two call sites able to disagree.
    const [transactions, laborEntries, invoices] = await Promise.all([
      transactionsRepo.listTransactions(db, ownerId),
      laborRepo.listLaborEntries(db, ownerId),
      invoicesRepo.listInvoices(db, ownerId),
    ]);

    return {
      project,
      kpi: calculateProjectKPIs(project, transactions, laborEntries, invoices),
      transactions: transactions.filter((row) => row.projectId === project.id),
      laborEntries: laborEntries.filter((row) => row.projectId === project.id),
      invoices: invoices.filter((row) => row.projectId === project.id),
      unassignedCount: countUnassigned(transactions),
    };
  }
);

export function countUnassigned(transactions: ExpenseTransaction[]): number {
  return transactions.filter((row) => row.status === 'unassigned').length;
}
