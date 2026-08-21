import { expect, it } from 'vitest';
import { invoicesRepo, laborRepo, projectsRepo, transactionsRepo } from '../src/repos';
import { SEED_PROJECTS, SEED_TRANSACTIONS, seedOwner } from '../src/seed';
import { createOwner, describeDb, useTestDb } from './helpers/db';

const getDb = useTestDb();

describeDb('seedOwner', () => {
  it('writes the demo fixtures for one owner', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    const result = await seedOwner(db, ownerId);

    expect(result.seeded).toBe(true);
    expect(await projectsRepo.listProjects(db, ownerId)).toHaveLength(SEED_PROJECTS.length);
    expect(await transactionsRepo.listTransactions(db, ownerId)).toHaveLength(
      SEED_TRANSACTIONS.length
    );
  });

  it('rewrites the fixtures’ project references to real ids', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await seedOwner(db, ownerId);

    const projects = await projectsRepo.listProjects(db, ownerId);
    const ids = new Set(projects.map((project) => project.id));
    const assigned = (await transactionsRepo.listTransactions(db, ownerId))
      .map((transaction) => transaction.projectId)
      .filter((id): id is string => id !== undefined);

    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.every((id) => ids.has(id))).toBe(true);
    expect((await laborRepo.listLaborEntries(db, ownerId)).every((entry) => ids.has(entry.projectId))).toBe(true);
    expect((await invoicesRepo.listInvoices(db, ownerId)).every((invoice) => ids.has(invoice.projectId))).toBe(true);
  });

  it('keeps money as whole cents rather than dollars', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await seedOwner(db, ownerId);

    const [first] = await projectsRepo.listProjects(db, ownerId);
    expect(Number.isInteger(first.quotedTotalCents)).toBe(true);
    expect(first.quotedTotalCents).toBeGreaterThan(1000);
  });

  it('leaves an owner who already has data alone', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await seedOwner(db, ownerId);

    const again = await seedOwner(db, ownerId);

    expect(again.seeded).toBe(false);
    expect(await projectsRepo.listProjects(db, ownerId)).toHaveLength(SEED_PROJECTS.length);
  });

  it('replaces the data when a reset is asked for', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await seedOwner(db, ownerId);

    const again = await seedOwner(db, ownerId, { reset: true });

    expect(again.seeded).toBe(true);
    expect(await projectsRepo.listProjects(db, ownerId)).toHaveLength(SEED_PROJECTS.length);
  });

  it('seeds one owner without touching another', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);

    await seedOwner(db, alice);

    expect(await projectsRepo.listProjects(db, bob)).toEqual([]);
  });
});
