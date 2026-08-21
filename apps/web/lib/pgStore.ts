import { CardProfile } from '@budget-bot/core';
import {
  bankRepo,
  getDb,
  invoicesRepo,
  laborRepo,
  projectsRepo,
  transactionsRepo,
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
 * The owner is an argument rather than something this module looks up: it is
 * the id on the Auth.js session, handed over by the route that already checked
 * there was one. Nothing here can be reached without that, which is the point.
 *
 * TEMP: goes away with the JSON store when the pages read from Postgres.
 */
export function createPgStore(ownerId: string): Store {
  return {
    async getAll(): Promise<DatabaseSnapshot> {
      const db = getDb();
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
      const db = getDb();
      return projectsRepo.listProjects(db, ownerId);
    },

    async getProjectById(id: string) {
      const db = getDb();
      return projectsRepo.getProject(db, ownerId, id);
    },

    async createProject(project: NewProject) {
      const db = getDb();
      return projectsRepo.createProject(db, ownerId, project);
    },

    async updateProject(id: string, updates: Partial<NewProject>) {
      const db = getDb();
      return projectsRepo.updateProject(db, ownerId, id, updates);
    },

    async deleteProject(id: string) {
      const db = getDb();
      return projectsRepo.deleteProject(db, ownerId, id);
    },

    async getTransactions() {
      const db = getDb();
      return transactionsRepo.listTransactions(db, ownerId);
    },

    async createTransaction(transaction: NewTransaction) {
      const db = getDb();
      return transactionsRepo.createTransaction(db, ownerId, transaction);
    },

    async updateTransaction(id: string, updates: Partial<NewTransaction>) {
      const db = getDb();
      return transactionsRepo.updateTransaction(db, ownerId, id, updates);
    },

    async deleteTransaction(id: string) {
      const db = getDb();
      return transactionsRepo.deleteTransaction(db, ownerId, id);
    },

    async bulkImportTransactions(items: NewTransaction[]) {
      const db = getDb();
      return transactionsRepo.bulkCreateTransactions(db, ownerId, items);
    },

    async getLaborEntries(projectId?: string) {
      const db = getDb();
      return laborRepo.listLaborEntries(db, ownerId, projectId);
    },

    async createLaborEntry(entry: NewLaborEntry) {
      const db = getDb();
      return laborRepo.createLaborEntry(db, ownerId, entry);
    },

    async deleteLaborEntry(id: string) {
      const db = getDb();
      return laborRepo.deleteLaborEntry(db, ownerId, id);
    },

    async getInvoices(projectId?: string) {
      const db = getDb();
      return invoicesRepo.listInvoices(db, ownerId, projectId);
    },

    async createInvoice(invoice: NewInvoice) {
      const db = getDb();
      return invoicesRepo.createInvoice(db, ownerId, invoice);
    },

    async updateInvoice(id: string, updates: Partial<NewInvoice>) {
      const db = getDb();
      return invoicesRepo.updateInvoice(db, ownerId, id, updates);
    },

    async getCardProfile() {
      const db = getDb();
      return bankRepo.getCardProfile(db, ownerId);
    },

    async updateCardProfile(updates: Partial<CardProfile>) {
      const db = getDb();
      return bankRepo.updateCardProfile(db, ownerId, updates);
    },
  };
}
