import type { Invoice } from '@budget-bot/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { invoices } from '../schema';
import { rejectingForeignProject } from './errors';
import { isUuid, orUndefined, toIso } from './rows';

type InvoiceRow = typeof invoices.$inferSelect;

export type NewInvoice = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;
export type InvoiceUpdate = Partial<NewInvoice>;

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    projectId: row.projectId,
    invoiceNumber: row.invoiceNumber,
    amountCents: row.amountCents as Invoice['amountCents'],
    depositAmountCents: row.depositAmountCents as Invoice['depositAmountCents'],
    dateIssued: row.dateIssued,
    dueDate: row.dueDate,
    status: row.status,
    paidDate: orUndefined(row.paidDate),
    notes: orUndefined(row.notes),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Copied field by field: an update body arrives from a request. */
function toUpdate(input: InvoiceUpdate) {
  return {
    ...(input.projectId !== undefined && { projectId: input.projectId }),
    ...(input.invoiceNumber !== undefined && { invoiceNumber: input.invoiceNumber }),
    ...(input.amountCents !== undefined && { amountCents: input.amountCents }),
    ...(input.depositAmountCents !== undefined && {
      depositAmountCents: input.depositAmountCents,
    }),
    ...(input.dateIssued !== undefined && { dateIssued: input.dateIssued }),
    ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.paidDate !== undefined && { paidDate: input.paidDate ?? null }),
    ...(input.notes !== undefined && { notes: input.notes ?? null }),
  };
}

export async function listInvoices(
  db: Database,
  ownerId: string,
  projectId?: string
): Promise<Invoice[]> {
  if (projectId !== undefined && !isUuid(projectId)) return [];
  const rows = await db
    .select()
    .from(invoices)
    .where(
      projectId === undefined
        ? eq(invoices.ownerId, ownerId)
        : and(eq(invoices.ownerId, ownerId), eq(invoices.projectId, projectId))
    )
    .orderBy(desc(invoices.createdAt), desc(invoices.id));
  return rows.map(toInvoice);
}

export async function createInvoice(
  db: Database,
  ownerId: string,
  input: NewInvoice
): Promise<Invoice> {
  const [row] = await rejectingForeignProject(input.projectId, () =>
    db
    .insert(invoices)
    .values({
      ownerId,
      projectId: input.projectId,
      invoiceNumber: input.invoiceNumber,
      amountCents: input.amountCents,
      depositAmountCents: input.depositAmountCents,
      dateIssued: input.dateIssued,
      dueDate: input.dueDate,
      status: input.status,
      paidDate: input.paidDate ?? null,
      notes: input.notes ?? null,
    })
    .returning()
  );
  return toInvoice(row);
}

export async function updateInvoice(
  db: Database,
  ownerId: string,
  id: string,
  updates: InvoiceUpdate
): Promise<Invoice | null> {
  if (!isUuid(id)) return null;
  const [row] = await rejectingForeignProject(updates.projectId, () =>
    db
      .update(invoices)
      .set({ ...toUpdate(updates), updatedAt: new Date() })
      .where(and(eq(invoices.ownerId, ownerId), eq(invoices.id, id)))
      .returning()
  );
  return row ? toInvoice(row) : null;
}

/** Every invoice the owner has, gone at once (spec §6, delete-all). */
export async function deleteAllInvoices(db: Database, ownerId: string): Promise<number> {
  const deleted = await db
    .delete(invoices)
    .where(eq(invoices.ownerId, ownerId))
    .returning({ id: invoices.id });
  return deleted.length;
}
