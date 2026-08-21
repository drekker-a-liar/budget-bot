import fs from 'fs';
import path from 'path';
import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  CardProfile,
  parseMoney,
} from '@budget-bot/core';
import {
  SEED_PROJECTS,
  SEED_CARD_PROFILE,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '@budget-bot/db/seed';
import type {
  DatabaseSnapshot,
  NewInvoice,
  NewLaborEntry,
  NewProject,
  NewTransaction,
  Store,
} from './store';

/** The file on disk always has a card profile; the interface allows for none. */
type DatabaseSchema = DatabaseSnapshot & { cardProfile: CardProfile };

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// TEMP: removed in Task 5, when Postgres replaces this JSON store.
//
// The file on disk is still the prototype's shape - float dollars under the
// pre-cents field names - so that an existing data/db.json keeps working. The
// domain above this line is integer cents. These two functions are the only
// place the two shapes meet: dollars in on read, dollars out on write.
type LegacyRecord = Record<string, unknown>;

const LEGACY_MONEY_FIELDS = {
  project: { quotedTotal: 'quotedTotalCents', quotedMaterials: 'quotedMaterialsCents', targetHourlyRate: 'targetHourlyRateCents' },
  transaction: { amount: 'amountCents' },
  labor: { hourlyRate: 'hourlyRateCents' },
  invoice: { amount: 'amountCents', depositAmount: 'depositAmountCents' },
  card: { currentBalance: 'currentBalanceCents', creditLimit: 'creditLimitCents' },
} as const;

type FieldMap = Record<string, string>;

function centsFromLegacy<T>(record: LegacyRecord, fields: FieldMap): T {
  const converted: LegacyRecord = { ...record };
  for (const [dollarField, centsField] of Object.entries(fields)) {
    converted[centsField] = parseMoney(Number(converted[dollarField]) || 0);
    delete converted[dollarField];
  }
  return converted as T;
}

function legacyFromCents<T extends object>(record: T, fields: FieldMap): LegacyRecord {
  const converted = { ...record } as LegacyRecord;
  for (const [dollarField, centsField] of Object.entries(fields)) {
    converted[dollarField] = (Number(converted[centsField]) || 0) / 100;
    delete converted[centsField];
  }
  return converted;
}

function fromLegacyFile(raw: string): DatabaseSchema {
  const parsed = JSON.parse(raw) as {
    projects: LegacyRecord[];
    transactions: LegacyRecord[];
    laborEntries: LegacyRecord[];
    invoices: LegacyRecord[];
    cardProfile: LegacyRecord;
    version: number;
  };
  const { project, transaction, labor, invoice, card } = LEGACY_MONEY_FIELDS;
  return {
    projects: parsed.projects.map((p) => centsFromLegacy<Project>(p, project)),
    transactions: parsed.transactions.map((t) =>
      centsFromLegacy<ExpenseTransaction>(t, transaction)
    ),
    laborEntries: parsed.laborEntries.map((l) => centsFromLegacy<LaborEntry>(l, labor)),
    invoices: parsed.invoices.map((i) => centsFromLegacy<Invoice>(i, invoice)),
    cardProfile: centsFromLegacy<CardProfile>(parsed.cardProfile, card),
    version: parsed.version,
  };
}

function toLegacyFile(data: DatabaseSchema): string {
  const { project, transaction, labor, invoice, card } = LEGACY_MONEY_FIELDS;
  return JSON.stringify(
    {
      projects: data.projects.map((p) => legacyFromCents(p, project)),
      transactions: data.transactions.map((t) => legacyFromCents(t, transaction)),
      laborEntries: data.laborEntries.map((l) => legacyFromCents(l, labor)),
      invoices: data.invoices.map((i) => legacyFromCents(i, invoice)),
      cardProfile: legacyFromCents(data.cardProfile, card),
      version: data.version,
    },
    null,
    2
  );
}

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
      fs.writeFileSync(DB_FILE, toLegacyFile(initialData), 'utf-8');
      return initialData;
    }

    return fromLegacyFile(fs.readFileSync(DB_FILE, 'utf-8'));
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
    fs.writeFileSync(DB_FILE, toLegacyFile(data), 'utf-8');
  } catch (err) {
    console.error('Failed to write to DB file:', err);
  }
}

export const jsonStore: Store = {
  // Reset
  async resetToSeed(): Promise<DatabaseSchema> {
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

  async getAll(): Promise<DatabaseSchema> {
    return ensureDb();
  },

  // Projects
  async getProjects(): Promise<Project[]> {
    return ensureDb().projects;
  },

  async getProjectById(id: string): Promise<Project | undefined> {
    return ensureDb().projects.find((p) => p.id === id);
  },

  async createProject(project: NewProject): Promise<Project> {
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

  async updateProject(id: string, updates: Partial<NewProject>): Promise<Project | null> {
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

  async deleteProject(id: string): Promise<boolean> {
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
  async getTransactions(): Promise<ExpenseTransaction[]> {
    return ensureDb().transactions;
  },

  async createTransaction(tx: NewTransaction): Promise<ExpenseTransaction> {
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

  async updateTransaction(
    id: string,
    updates: Partial<NewTransaction>
  ): Promise<ExpenseTransaction | null> {
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

  async deleteTransaction(id: string): Promise<boolean> {
    const data = ensureDb();
    const len = data.transactions.length;
    data.transactions = data.transactions.filter((t) => t.id !== id);
    if (data.transactions.length !== len) {
      writeDb(data);
      return true;
    }
    return false;
  },

  async bulkImportTransactions(items: NewTransaction[]): Promise<ExpenseTransaction[]> {
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
  async getLaborEntries(projectId?: string): Promise<LaborEntry[]> {
    const all = ensureDb().laborEntries;
    if (projectId) {
      return all.filter((l) => l.projectId === projectId);
    }
    return all;
  },

  async createLaborEntry(entry: NewLaborEntry): Promise<LaborEntry> {
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

  async deleteLaborEntry(id: string): Promise<boolean> {
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
  async getInvoices(projectId?: string): Promise<Invoice[]> {
    const all = ensureDb().invoices;
    if (projectId) {
      return all.filter((i) => i.projectId === projectId);
    }
    return all;
  },

  async createInvoice(inv: NewInvoice): Promise<Invoice> {
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

  async updateInvoice(id: string, updates: Partial<NewInvoice>): Promise<Invoice | null> {
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
  async getCardProfile(): Promise<CardProfile> {
    return ensureDb().cardProfile;
  },

  async updateCardProfile(updates: Partial<CardProfile>): Promise<CardProfile> {
    const data = ensureDb();
    data.cardProfile = {
      ...data.cardProfile,
      ...updates,
    };
    writeDb(data);
    return data.cardProfile;
  },
};
