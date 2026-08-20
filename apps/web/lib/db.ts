import fs from 'fs';
import path from 'path';
import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  CardProfile,
} from '@budget-bot/core';
import {
  SEED_PROJECTS,
  SEED_CARD_PROFILE,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from './seedData';

interface DatabaseSchema {
  projects: Project[];
  transactions: ExpenseTransaction[];
  laborEntries: LaborEntry[];
  invoices: Invoice[];
  cardProfile: CardProfile;
  version: number;
}

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

function ensureDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    if (!fs.existsSync(DB_FILE)) {
      const initialData: DatabaseSchema = {
        projects: SEED_PROJECTS,
        transactions: SEED_TRANSACTIONS,
        laborEntries: SEED_LABOR,
        invoices: SEED_INVOICES,
        cardProfile: SEED_CARD_PROFILE,
        version: 1,
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
      return initialData;
    }

    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading DB, falling back to seed memory:', err);
    return {
      projects: SEED_PROJECTS,
      transactions: SEED_TRANSACTIONS,
      laborEntries: SEED_LABOR,
      invoices: SEED_INVOICES,
      cardProfile: SEED_CARD_PROFILE,
      version: 1,
    };
  }
}

function writeDb(data: DatabaseSchema): void {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write to DB file:', err);
  }
}

export const db = {
  // Reset
  resetToSeed(): DatabaseSchema {
    const data: DatabaseSchema = {
      projects: SEED_PROJECTS,
      transactions: SEED_TRANSACTIONS,
      laborEntries: SEED_LABOR,
      invoices: SEED_INVOICES,
      cardProfile: SEED_CARD_PROFILE,
      version: 1,
    };
    writeDb(data);
    return data;
  },

  getAll(): DatabaseSchema {
    return ensureDb();
  },

  // Projects
  getProjects(): Project[] {
    return ensureDb().projects;
  },

  getProjectById(id: string): Project | undefined {
    return ensureDb().projects.find((p) => p.id === id);
  },

  createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const data = ensureDb();
    const newProject: Project = {
      ...project,
      id: `proj-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.projects.unshift(newProject);
    writeDb(data);
    return newProject;
  },

  updateProject(id: string, updates: Partial<Project>): Project | null {
    const data = ensureDb();
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    data.projects[idx] = {
      ...data.projects[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    writeDb(data);
    return data.projects[idx];
  },

  deleteProject(id: string): boolean {
    const data = ensureDb();
    const len = data.projects.length;
    data.projects = data.projects.filter((p) => p.id !== id);
    if (data.projects.length !== len) {
      writeDb(data);
      return true;
    }
    return false;
  },

  // Transactions
  getTransactions(): ExpenseTransaction[] {
    return ensureDb().transactions;
  },

  createTransaction(
    tx: Omit<ExpenseTransaction, 'id' | 'createdAt'>
  ): ExpenseTransaction {
    const data = ensureDb();
    const newTx: ExpenseTransaction = {
      ...tx,
      id: `tx-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    data.transactions.unshift(newTx);
    writeDb(data);
    return newTx;
  },

  updateTransaction(
    id: string,
    updates: Partial<ExpenseTransaction>
  ): ExpenseTransaction | null {
    const data = ensureDb();
    const idx = data.transactions.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    data.transactions[idx] = {
      ...data.transactions[idx],
      ...updates,
    };
    writeDb(data);
    return data.transactions[idx];
  },

  deleteTransaction(id: string): boolean {
    const data = ensureDb();
    const len = data.transactions.length;
    data.transactions = data.transactions.filter((t) => t.id !== id);
    if (data.transactions.length !== len) {
      writeDb(data);
      return true;
    }
    return false;
  },

  bulkImportTransactions(
    items: Omit<ExpenseTransaction, 'id' | 'createdAt'>[]
  ): ExpenseTransaction[] {
    const data = ensureDb();
    const created: ExpenseTransaction[] = [];
    items.forEach((item, i) => {
      const newTx: ExpenseTransaction = {
        ...item,
        id: `tx-${Date.now()}-${i}`,
        createdAt: new Date().toISOString(),
      };
      created.push(newTx);
      data.transactions.unshift(newTx);
    });
    writeDb(data);
    return created;
  },

  // Labor
  getLaborEntries(projectId?: string): LaborEntry[] {
    const all = ensureDb().laborEntries;
    if (projectId) {
      return all.filter((l) => l.projectId === projectId);
    }
    return all;
  },

  createLaborEntry(
    entry: Omit<LaborEntry, 'id' | 'createdAt'>
  ): LaborEntry {
    const data = ensureDb();
    const newEntry: LaborEntry = {
      ...entry,
      id: `lab-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    data.laborEntries.unshift(newEntry);
    writeDb(data);
    return newEntry;
  },

  deleteLaborEntry(id: string): boolean {
    const data = ensureDb();
    const len = data.laborEntries.length;
    data.laborEntries = data.laborEntries.filter((l) => l.id !== id);
    if (data.laborEntries.length !== len) {
      writeDb(data);
      return true;
    }
    return false;
  },

  // Invoices
  getInvoices(projectId?: string): Invoice[] {
    const all = ensureDb().invoices;
    if (projectId) {
      return all.filter((i) => i.projectId === projectId);
    }
    return all;
  },

  createInvoice(inv: Omit<Invoice, 'id' | 'createdAt'>): Invoice {
    const data = ensureDb();
    const newInv: Invoice = {
      ...inv,
      id: `inv-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    data.invoices.unshift(newInv);
    writeDb(data);
    return newInv;
  },

  updateInvoice(id: string, updates: Partial<Invoice>): Invoice | null {
    const data = ensureDb();
    const idx = data.invoices.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    data.invoices[idx] = {
      ...data.invoices[idx],
      ...updates,
    };
    writeDb(data);
    return data.invoices[idx];
  },

  // Card Profile
  getCardProfile(): CardProfile {
    return ensureDb().cardProfile;
  },

  updateCardProfile(updates: Partial<CardProfile>): CardProfile {
    const data = ensureDb();
    data.cardProfile = {
      ...data.cardProfile,
      ...updates,
    };
    writeDb(data);
    return data.cardProfile;
  },
};
