import { parseMoney } from '@budget-bot/core';
import { expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { invoicesRepo, laborRepo, projectsRepo } from '../../src/repos';
import type { NewInvoice } from '../../src/repos/invoices';
import type { NewLaborEntry } from '../../src/repos/labor';
import { createOwner, describeDb, useTestDb } from '../helpers/db';
import { newProject } from '../helpers/fixtures';

const getDb = useTestDb();

const newLaborEntry = (
  projectId: string,
  overrides: Partial<NewLaborEntry> = {}
): NewLaborEntry => ({
  projectId,
  date: '2026-08-05',
  hours: 7.25,
  hourlyRateCents: parseMoney('85.00'),
  workerName: 'Mike (Owner/Lead)',
  ...overrides,
});

const newInvoice = (projectId: string, overrides: Partial<NewInvoice> = {}): NewInvoice => ({
  projectId,
  invoiceNumber: 'INV-2026-041',
  amountCents: parseMoney('4500.00'),
  depositAmountCents: parseMoney('1500.00'),
  dateIssued: '2026-08-01',
  dueDate: '2026-08-15',
  status: 'sent',
  ...overrides,
});

async function ownerWithProject(db: Database): Promise<[string, string]> {
  const ownerId = await createOwner(db);
  const project = await projectsRepo.createProject(db, ownerId, newProject());
  return [ownerId, project.id];
}

describeDb('laborRepo', () => {
  it('round-trips hours and a cents rate', async () => {
    const db = getDb();
    const [ownerId, projectId] = await ownerWithProject(db);

    const created = await laborRepo.createLaborEntry(db, ownerId, newLaborEntry(projectId));

    expect(created.hours).toBe(7.25);
    expect(created.hourlyRateCents).toBe(8500);
    expect(await laborRepo.listLaborEntries(db, ownerId)).toEqual([created]);
  });

  it('filters to one project when asked', async () => {
    const db = getDb();
    const [ownerId, projectId] = await ownerWithProject(db);
    const other = await projectsRepo.createProject(db, ownerId, newProject({ name: 'Other' }));
    await laborRepo.createLaborEntry(db, ownerId, newLaborEntry(projectId));
    await laborRepo.createLaborEntry(db, ownerId, newLaborEntry(other.id));

    expect(await laborRepo.listLaborEntries(db, ownerId, projectId)).toHaveLength(1);
    expect(await laborRepo.listLaborEntries(db, ownerId)).toHaveLength(2);
  });

  it('never returns or deletes another owner’s hours', async () => {
    const db = getDb();
    const [alice, projectId] = await ownerWithProject(db);
    const bob = await createOwner(db);
    const hers = await laborRepo.createLaborEntry(db, alice, newLaborEntry(projectId));

    expect(await laborRepo.listLaborEntries(db, bob)).toEqual([]);
    expect(await laborRepo.listLaborEntries(db, bob, projectId)).toEqual([]);
    expect(await laborRepo.deleteLaborEntry(db, bob, hers.id)).toBe(false);
    expect(await laborRepo.deleteLaborEntry(db, alice, hers.id)).toBe(true);
  });
});

describeDb('invoicesRepo', () => {
  it('round-trips amounts and an absent paid date', async () => {
    const db = getDb();
    const [ownerId, projectId] = await ownerWithProject(db);

    const created = await invoicesRepo.createInvoice(db, ownerId, newInvoice(projectId));

    expect(created.amountCents).toBe(450000);
    expect(created.depositAmountCents).toBe(150000);
    expect(created.paidDate).toBeUndefined();
  });

  it('records a payment', async () => {
    const db = getDb();
    const [ownerId, projectId] = await ownerWithProject(db);
    const created = await invoicesRepo.createInvoice(db, ownerId, newInvoice(projectId));

    const paid = await invoicesRepo.updateInvoice(db, ownerId, created.id, {
      status: 'paid',
      paidDate: '2026-08-16',
    });

    expect(paid?.status).toBe('paid');
    expect(paid?.paidDate).toBe('2026-08-16');
    expect(paid?.invoiceNumber).toBe(created.invoiceNumber);
  });

  it('never returns or updates another owner’s invoices', async () => {
    const db = getDb();
    const [alice, projectId] = await ownerWithProject(db);
    const bob = await createOwner(db);
    const hers = await invoicesRepo.createInvoice(db, alice, newInvoice(projectId));

    expect(await invoicesRepo.listInvoices(db, bob)).toEqual([]);
    expect(await invoicesRepo.listInvoices(db, bob, projectId)).toEqual([]);
    expect(await invoicesRepo.updateInvoice(db, bob, hers.id, { status: 'paid' })).toBeNull();
    expect((await invoicesRepo.listInvoices(db, alice))[0].status).toBe('sent');
  });
});
