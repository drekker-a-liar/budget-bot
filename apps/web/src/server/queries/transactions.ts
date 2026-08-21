import 'server-only';
import { cache } from 'react';
import type { CardProfile, ExpenseTransaction, Project } from '@budget-bot/core';
import { bankRepo, getDb, projectsRepo, transactionsRepo } from '@budget-bot/db';
import { countUnassigned } from './projects';

/**
 * What the card inbox reads: the charges, and the jobs they can be filed
 * against. No metrics - this page is triage, not measurement.
 */

export interface TransactionsPageData {
  transactions: ExpenseTransaction[];
  projects: Project[];
  /** Null until a bank account is linked, which is Phase 2. */
  cardProfile: CardProfile | null;
  unassignedCount: number;
}

export const getTransactionsPage = cache(
  async (ownerId: string): Promise<TransactionsPageData> => {
    const db = getDb();
    const [transactions, projects, cardProfile] = await Promise.all([
      transactionsRepo.listTransactions(db, ownerId),
      projectsRepo.listProjects(db, ownerId),
      bankRepo.getCardProfile(db, ownerId),
    ]);

    return {
      transactions,
      projects,
      cardProfile,
      unassignedCount: countUnassigned(transactions),
    };
  }
);
