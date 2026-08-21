import { parseMoney } from '@budget-bot/core';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { invoicesRepo, laborRepo, projectsRepo, transactionsRepo } from '../../src/repos';
import { UnknownProjectError } from '../../src/repos/errors';
import { invoices, laborEntries, transactions } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';
import { newProject } from '../helpers/fixtures';

const getDb = useTestDb();

/**
 * `project_id` arrives from the caller on every child-row write. The owner
 * filter on the query protects reads, but says nothing about *which* project a
 * new row points at - so without a constraint, owner B could attach a row to
 * owner A's project, and A deleting that project would then reach into B's
 * data. The composite foreign key `(project_id, owner_id)` is what makes that
 * unrepresentable rather than merely discouraged.
 */

const newTransaction = () => ({
  date: '2026-08-14',
  description: 'THE HOME DEPOT #0421',
  vendor: 'The Home Depot',
  amountCents: parseMoney('114.75'),
  category: 'materials' as const,
  paymentMethod: 'card' as const,
  status: 'unassigned' as const,
  taxDeductible: true,
});

const newInvoice = (projectId: string) => ({
  projectId,
  invoiceNumber: 'INV-2026-041',
  amountCents: parseMoney('4500.00'),
  depositAmountCents: parseMoney('1500.00'),
  dateIssued: '2026-08-01',
  dueDate: '2026-08-15',
  status: 'sent' as const,
});

const newLabor = (projectId: string) => ({
  projectId,
  date: '2026-08-05',
  hours: 7.25,
  hourlyRateCents: parseMoney('85.00'),
  workerName: 'Mike (Owner/Lead)',
});

/** Two owners, each with a project of their own. */
async function twoOwners(db: Database) {
  const alice = await createOwner(db);
  const bob = await createOwner(db);
  const hers = await projectsRepo.createProject(db, alice, newProject({ name: 'Hers' }));
  const his = await projectsRepo.createProject(db, bob, newProject({ name: 'His' }));
  return { alice, bob, hers: hers.id, his: his.id };
}

describeDb('a row cannot be attached to another owner’s project', () => {
  it('refuses an invoice pointed at a project the owner does not own', async () => {
    const db = getDb();
    const { bob, hers } = await twoOwners(db);

    await expect(invoicesRepo.createInvoice(db, bob, newInvoice(hers))).rejects.toThrow(
      UnknownProjectError
    );
  });

  it('refuses a labor entry pointed at a project the owner does not own', async () => {
    const db = getDb();
    const { bob, hers } = await twoOwners(db);

    await expect(laborRepo.createLaborEntry(db, bob, newLabor(hers))).rejects.toThrow(
      UnknownProjectError
    );
  });

  it('refuses a transaction pointed at a project the owner does not own', async () => {
    const db = getDb();
    const { bob, hers } = await twoOwners(db);

    await expect(
      transactionsRepo.createTransaction(db, bob, { ...newTransaction(), projectId: hers })
    ).rejects.toThrow(UnknownProjectError);
  });

  it('refuses a bulk import that smuggles in another owner’s project', async () => {
    const db = getDb();
    const { bob, hers, his } = await twoOwners(db);

    await expect(
      transactionsRepo.bulkCreateTransactions(db, bob, [
        { ...newTransaction(), projectId: his },
        { ...newTransaction(), projectId: hers },
      ])
    ).rejects.toThrow(UnknownProjectError);
    expect(await transactionsRepo.listTransactions(db, bob)).toEqual([]);
  });

  it('refuses to move an existing transaction onto another owner’s project', async () => {
    const db = getDb();
    const { bob, hers } = await twoOwners(db);
    const mine = await transactionsRepo.createTransaction(db, bob, newTransaction());

    await expect(
      transactionsRepo.updateTransaction(db, bob, mine.id, { projectId: hers })
    ).rejects.toThrow(UnknownProjectError);
  });

  it('refuses to move an existing invoice onto another owner’s project', async () => {
    const db = getDb();
    const { bob, his, hers } = await twoOwners(db);
    const mine = await invoicesRepo.createInvoice(db, bob, newInvoice(his));

    await expect(
      invoicesRepo.updateInvoice(db, bob, mine.id, { projectId: hers })
    ).rejects.toThrow(UnknownProjectError);
  });

  it('reports a project that does not exist at all the same way', async () => {
    const db = getDb();
    const bob = await createOwner(db);

    await expect(
      invoicesRepo.createInvoice(db, bob, newInvoice('00000000-0000-4000-8000-000000000000'))
    ).rejects.toThrow(UnknownProjectError);
  });

  it('still accepts a project the owner does own', async () => {
    const db = getDb();
    const { bob, his } = await twoOwners(db);

    const invoice = await invoicesRepo.createInvoice(db, bob, newInvoice(his));
    const labor = await laborRepo.createLaborEntry(db, bob, newLabor(his));
    const transaction = await transactionsRepo.createTransaction(db, bob, {
      ...newTransaction(),
      projectId: his,
    });

    expect(invoice.projectId).toBe(his);
    expect(labor.projectId).toBe(his);
    expect(transaction.projectId).toBe(his);
  });
});

describeDb('deleting a project reaches only the owner’s own rows', () => {
  it('leaves the other owner’s rows untouched', async () => {
    const db = getDb();
    const { alice, bob, hers, his } = await twoOwners(db);
    await invoicesRepo.createInvoice(db, bob, newInvoice(his));
    await laborRepo.createLaborEntry(db, bob, newLabor(his));
    await transactionsRepo.createTransaction(db, bob, {
      ...newTransaction(),
      projectId: his,
    });

    await projectsRepo.deleteProject(db, alice, hers);

    expect(await invoicesRepo.listInvoices(db, bob)).toHaveLength(1);
    expect(await laborRepo.listLaborEntries(db, bob)).toHaveLength(1);
    expect((await transactionsRepo.listTransactions(db, bob))[0].projectId).toBe(his);
  });

  it('keeps each table’s own delete behaviour for the owner’s rows', async () => {
    const db = getDb();
    const { alice, hers } = await twoOwners(db);
    await invoicesRepo.createInvoice(db, alice, newInvoice(hers));
    await laborRepo.createLaborEntry(db, alice, newLabor(hers));
    await transactionsRepo.createTransaction(db, alice, {
      ...newTransaction(),
      projectId: hers,
    });

    await projectsRepo.deleteProject(db, alice, hers);

    // Invoices and hours belong to the project and go with it; an expense is a
    // real payment that happened, so it is unfiled rather than deleted.
    expect(await db.select().from(invoices).where(eq(invoices.ownerId, alice))).toEqual([]);
    expect(
      await db.select().from(laborEntries).where(eq(laborEntries.ownerId, alice))
    ).toEqual([]);
    const [orphaned] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ownerId, alice));
    expect(orphaned.projectId).toBeNull();
    expect(orphaned.ownerId).toBe(alice);
  });
});
