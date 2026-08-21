import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMoney } from '@budget-bot/core';
import { eq } from 'drizzle-orm';
import { createDb, type Database } from '../src/client';
import { ownersRepo } from '../src/repos';
import { invoices, laborEntries, projects, transactions } from '../src/schema';
import { hasFlag, loadRootEnv, readFlag, requireEnv } from './env';

/**
 * One-off migration of a prototype `data/db.json` into Postgres.
 *
 *   pnpm --filter @budget-bot/db db:import-json \
 *     --owner-email you@example.com --file apps/web/data/db.json
 *
 * The file holds money as floating point dollars, which is the reason ADR 0007
 * exists. Every amount goes through `parseMoney`, the one conversion the domain
 * allows, so `114.75` becomes exactly 11475 rather than 11474.999999999998.
 */

interface LegacyProject {
  id: string;
  name: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  description?: string;
  status: 'estimating' | 'in_progress' | 'completed' | 'on_hold';
  pricingType: 'fixed' | 'time_and_materials';
  quotedTotal: number;
  quotedMaterials: number;
  quotedLaborHours: number;
  targetHourlyRate: number;
  targetMarginPct: number;
  startDate: string;
  deadlineDate?: string;
  completedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface LegacyTransaction {
  id: string;
  date: string;
  description: string;
  vendor?: string;
  amount: number;
  category: 'materials' | 'tools' | 'subcontractor' | 'mileage_fuel' | 'permits_fees' | 'overhead';
  paymentMethod: 'card' | 'cash' | 'check' | 'transfer';
  cardLast4?: string;
  status: 'matched' | 'unassigned' | 'ignored';
  projectId?: string;
  receiptNumber?: string;
  taxDeductible?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface LegacyLaborEntry {
  id: string;
  projectId: string;
  date: string;
  hours: number;
  hourlyRate: number;
  workerName?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface LegacyInvoice {
  id: string;
  projectId: string;
  invoiceNumber: string;
  amount: number;
  depositAmount: number;
  dateIssued: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  paidDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface LegacyDatabase {
  projects: LegacyProject[];
  transactions: LegacyTransaction[];
  laborEntries: LegacyLaborEntry[];
  invoices: LegacyInvoice[];
}

loadRootEnv();

const email = readFlag('owner-email') ?? process.env.DEV_OWNER_EMAIL;
if (!email) {
  console.error('Whose data is this? Pass --owner-email <email>.');
  process.exit(1);
}

const file = resolve(process.cwd(), readFlag('file') ?? 'apps/web/data/db.json');
const reset = hasFlag('reset');

const legacy = JSON.parse(readFileSync(file, 'utf8')) as LegacyDatabase;
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });

try {
  const ownerId = await ownersRepo.findOwnerIdByEmail(db, email);
  if (!ownerId) {
    console.error(`No user with the email "${email}". Sign in to the app once first.`);
    process.exit(1);
  }

  const counts = await importInto(db, ownerId, legacy, reset);
  console.log(
    `Imported ${file} for ${email}: ${counts.projects} projects, ` +
      `${counts.transactions} transactions, ${counts.laborEntries} labor entries, ` +
      `${counts.invoices} invoices.`
  );
} finally {
  await db.$client.end();
}

async function importInto(
  db: Database,
  ownerId: string,
  data: LegacyDatabase,
  replace: boolean
): Promise<{ projects: number; transactions: number; laborEntries: number; invoices: number }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .limit(1);
    if (existing && !replace) {
      throw new Error(
        `${email} already has projects. Re-run with --reset to replace them, or import into a fresh account.`
      );
    }
    if (replace) {
      await tx.delete(transactions).where(eq(transactions.ownerId, ownerId));
      await tx.delete(invoices).where(eq(invoices.ownerId, ownerId));
      await tx.delete(laborEntries).where(eq(laborEntries.ownerId, ownerId));
      await tx.delete(projects).where(eq(projects.ownerId, ownerId));
    }

    const projectIds = new Map<string, string>();
    if (data.projects.length > 0) {
      const rows = await tx
        .insert(projects)
        .values(
          data.projects.map((project) => ({
            ownerId,
            name: project.name,
            clientName: project.clientName,
            clientPhone: project.clientPhone ?? '',
            clientAddress: project.clientAddress ?? '',
            description: project.description ?? '',
            status: project.status,
            pricingType: project.pricingType,
            quotedTotalCents: parseMoney(project.quotedTotal),
            quotedMaterialsCents: parseMoney(project.quotedMaterials),
            quotedLaborHours: project.quotedLaborHours,
            targetHourlyRateCents: parseMoney(project.targetHourlyRate),
            targetMarginPct: project.targetMarginPct,
            startDate: project.startDate,
            deadlineDate: project.deadlineDate ?? null,
            completedDate: project.completedDate ?? null,
            notes: project.notes ?? null,
            createdAt: new Date(project.createdAt),
            updatedAt: new Date(project.updatedAt ?? project.createdAt),
          }))
        )
        .returning({ id: projects.id });
      data.projects.forEach((project, index) => projectIds.set(project.id, rows[index].id));
    }

    /** A reference to a project the file did not contain is dropped, not guessed at. */
    const projectId = (legacyId: string | undefined): string | null =>
      legacyId ? (projectIds.get(legacyId) ?? null) : null;

    if (data.transactions.length > 0) {
      await tx.insert(transactions).values(
        data.transactions.map((transaction) => ({
          ownerId,
          date: transaction.date,
          description: transaction.description,
          vendor: transaction.vendor ?? '',
          amountCents: parseMoney(transaction.amount),
          category: transaction.category,
          paymentMethod: transaction.paymentMethod,
          cardLast4: transaction.cardLast4 ?? null,
          status: transaction.status,
          projectId: projectId(transaction.projectId),
          receiptNumber: transaction.receiptNumber ?? null,
          taxDeductible: transaction.taxDeductible ?? false,
          notes: transaction.notes ?? null,
          createdAt: new Date(transaction.createdAt),
          updatedAt: new Date(transaction.updatedAt ?? transaction.createdAt),
        }))
      );
    }

    const importableLabor = data.laborEntries.filter((entry) => projectId(entry.projectId));
    if (importableLabor.length > 0) {
      await tx.insert(laborEntries).values(
        importableLabor.map((entry) => ({
          ownerId,
          projectId: projectId(entry.projectId) as string,
          date: entry.date,
          hours: entry.hours,
          hourlyRateCents: parseMoney(entry.hourlyRate),
          workerName: entry.workerName ?? '',
          notes: entry.notes ?? null,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.updatedAt ?? entry.createdAt),
        }))
      );
    }

    const importableInvoices = data.invoices.filter((invoice) => projectId(invoice.projectId));
    if (importableInvoices.length > 0) {
      await tx.insert(invoices).values(
        importableInvoices.map((invoice) => ({
          ownerId,
          projectId: projectId(invoice.projectId) as string,
          invoiceNumber: invoice.invoiceNumber,
          amountCents: parseMoney(invoice.amount),
          depositAmountCents: parseMoney(invoice.depositAmount),
          dateIssued: invoice.dateIssued,
          dueDate: invoice.dueDate,
          status: invoice.status,
          paidDate: invoice.paidDate ?? null,
          notes: invoice.notes ?? null,
          createdAt: new Date(invoice.createdAt),
          updatedAt: new Date(invoice.updatedAt ?? invoice.createdAt),
        }))
      );
    }

    return {
      projects: data.projects.length,
      transactions: data.transactions.length,
      laborEntries: importableLabor.length,
      invoices: importableInvoices.length,
    };
  });
}
