import { CardProfile } from '@budget-bot/core';
import {
  bankRepo,
  getDb,
  invoicesRepo,
  laborRepo,
  ownersRepo,
  projectsRepo,
  seedOwner,
  transactionsRepo,
  type Database,
} from '@budget-bot/db';
import type {
  DatabaseSnapshot,
  NewInvoice,
  NewLaborEntry,
  NewProject,
  NewTransaction,
  Store,
} from './store';

/**
 * The Postgres implementation of the storage contract, reached with `USE_PG=1`.
 *
 * TEMP: `DEV_OWNER_EMAIL` stands in for the signed-in user until Auth.js lands
 * in the next sub-project, at which point the owner comes from `auth()` and
 * this whole file goes away with the JSON store.
 */

let cachedOwnerId: string | undefined;

async function owner(): Promise<[Database, string]> {
  // Checked before anything else, including the cache: an environment variable
  // naming the user is a development convenience, and in a deployed
  // environment it would be an unauthenticated way to read someone's books.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DEV_OWNER_EMAIL owner resolution is disabled in production; Task 4 replaces it with the session'
    );
  }

  const db = getDb();
  if (cachedOwnerId) return [db, cachedOwnerId];

  const email = process.env.DEV_OWNER_EMAIL;
  if (!email) {
    throw new Error('USE_PG=1 needs DEV_OWNER_EMAIL to know whose data to read.');
  }

  const ownerId = await ownersRepo.findOwnerIdByEmail(db, email);
  if (!ownerId) {
    throw new Error(
      `No user with the email "${email}". Create the row, or sign in once Auth.js is wired up.`
    );
  }

  cachedOwnerId = ownerId;
  return [db, ownerId];
}

export const pgStore: Store = {
  async resetToSeed(): Promise<DatabaseSnapshot> {
    const [db, ownerId] = await owner();
    await seedOwner(db, ownerId, { reset: true });
    return this.getAll();
  },

  async getAll(): Promise<DatabaseSnapshot> {
    const [db, ownerId] = await owner();
    const [projects, transactions, laborEntries, invoices, cardProfile] = await Promise.all([
      projectsRepo.listProjects(db, ownerId),
      transactionsRepo.listTransactions(db, ownerId),
      laborRepo.listLaborEntries(db, ownerId),
      invoicesRepo.listInvoices(db, ownerId),
      bankRepo.getCardProfile(db, ownerId),
    ]);
    return { projects, transactions, laborEntries, invoices, cardProfile, version: 1 };
  },

  async getProjects() {
    const [db, ownerId] = await owner();
    return projectsRepo.listProjects(db, ownerId);
  },

  async getProjectById(id: string) {
    const [db, ownerId] = await owner();
    return projectsRepo.getProject(db, ownerId, id);
  },

  async createProject(project: NewProject) {
    const [db, ownerId] = await owner();
    return projectsRepo.createProject(db, ownerId, project);
  },

  async updateProject(id: string, updates: Partial<NewProject>) {
    const [db, ownerId] = await owner();
    return projectsRepo.updateProject(db, ownerId, id, updates);
  },

  async deleteProject(id: string) {
    const [db, ownerId] = await owner();
    return projectsRepo.deleteProject(db, ownerId, id);
  },

  async getTransactions() {
    const [db, ownerId] = await owner();
    return transactionsRepo.listTransactions(db, ownerId);
  },

  async createTransaction(transaction: NewTransaction) {
    const [db, ownerId] = await owner();
    return transactionsRepo.createTransaction(db, ownerId, transaction);
  },

  async updateTransaction(id: string, updates: Partial<NewTransaction>) {
    const [db, ownerId] = await owner();
    return transactionsRepo.updateTransaction(db, ownerId, id, updates);
  },

  async deleteTransaction(id: string) {
    const [db, ownerId] = await owner();
    return transactionsRepo.deleteTransaction(db, ownerId, id);
  },

  async bulkImportTransactions(items: NewTransaction[]) {
    const [db, ownerId] = await owner();
    return transactionsRepo.bulkCreateTransactions(db, ownerId, items);
  },

  async getLaborEntries(projectId?: string) {
    const [db, ownerId] = await owner();
    return laborRepo.listLaborEntries(db, ownerId, projectId);
  },

  async createLaborEntry(entry: NewLaborEntry) {
    const [db, ownerId] = await owner();
    return laborRepo.createLaborEntry(db, ownerId, entry);
  },

  async deleteLaborEntry(id: string) {
    const [db, ownerId] = await owner();
    return laborRepo.deleteLaborEntry(db, ownerId, id);
  },

  async getInvoices(projectId?: string) {
    const [db, ownerId] = await owner();
    return invoicesRepo.listInvoices(db, ownerId, projectId);
  },

  async createInvoice(invoice: NewInvoice) {
    const [db, ownerId] = await owner();
    return invoicesRepo.createInvoice(db, ownerId, invoice);
  },

  async updateInvoice(id: string, updates: Partial<NewInvoice>) {
    const [db, ownerId] = await owner();
    return invoicesRepo.updateInvoice(db, ownerId, id, updates);
  },

  async getCardProfile() {
    const [db, ownerId] = await owner();
    return bankRepo.getCardProfile(db, ownerId);
  },

  async updateCardProfile(updates: Partial<CardProfile>) {
    const [db, ownerId] = await owner();
    return bankRepo.updateCardProfile(db, ownerId, updates);
  },
};
