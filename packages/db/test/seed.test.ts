import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { bankRepo, invoicesRepo, laborRepo, ownersRepo, projectsRepo, transactionsRepo } from '../src/repos';
import { bankAccounts, bankConnections, users, type UserSettings } from '../src/schema';
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

  it('takes the linked banks with it, so a reset owner can link again', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const bystander = await createOwner(db);
    const [connection] = await db
      .insert(bankConnections)
      .values({
        ownerId,
        itemId: 'item-reset',
        institutionName: 'Fake Bank',
        accessTokenCiphertext: 'v1:k2:aaaa:bbbb:cccc',
        encryptionKeyId: 'k2',
        cursor: 'spent',
      })
      .returning({ id: bankConnections.id });
    await db.insert(bankAccounts).values({
      ownerId,
      connectionId: connection.id,
      externalAccountId: 'acct-reset',
      name: 'Fake Business Card',
    });

    // Somebody else's bank, linked at the same institution.
    await db.insert(bankConnections).values({
      ownerId: bystander,
      itemId: 'item-bystander',
      institutionName: 'Fake Bank',
      accessTokenCiphertext: 'v1:k2:dddd:eeee:ffff',
      encryptionKeyId: 'k2',
    });

    await seedOwner(db, ownerId, { reset: true });

    // Both, and the accounts by the cascade rather than a second delete.
    expect(await bankRepo.listConnections(db, ownerId)).toEqual([]);
    expect(await bankRepo.getCardProfile(db, ownerId)).toBeNull();
    // `deleteOwnerData` is owner-scoped, and this is what says so out loud: a
    // reset is the most destructive thing in the package and the blast radius
    // is the assertion worth having, not the delete's own where-clause.
    expect(await bankRepo.listConnections(db, bystander)).toHaveLength(1);
  });

  it('seeds one owner without touching another', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);

    await seedOwner(db, alice);

    expect(await projectsRepo.listProjects(db, bob)).toEqual([]);
  });

  it('gives the demo owner a time zone the metrics can bucket by', async () => {
    // The seed's fixtures are dated as if lived in the Pacific time zone
    // (spec §5); an owner with no settings would otherwise fall back to UTC
    // and bucket every one of those dates up to a day into the wrong month.
    const db = getDb();
    const ownerId = await createOwner(db);

    await seedOwner(db, ownerId);

    expect(await ownersRepo.getTimeZone(db, ownerId)).toBe('America/Los_Angeles');
  });

  it('sets the time zone again on a reset', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await seedOwner(db, ownerId);
    await db.update(users).set({ settings: { timeZone: 'America/New_York' } }).where(eq(users.id, ownerId));

    await seedOwner(db, ownerId, { reset: true });

    expect(await ownersRepo.getTimeZone(db, ownerId)).toBe('America/Los_Angeles');
  });

  it('keeps settings keys it does not own when it sets the time zone', async () => {
    // The jsonb can hold keys this build has never heard of; a seed that
    // replaces the whole object erases them (Phase 4 ledger, spec §3).
    const db = getDb();
    const ownerId = await createOwner(db);
    await db
      .update(users)
      .set({ settings: { timeZone: 'America/New_York', theme: 'dark' } as UserSettings })
      .where(eq(users.id, ownerId));

    await seedOwner(db, ownerId, { reset: true });

    const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, ownerId));
    expect(row.settings).toEqual({ timeZone: 'America/Los_Angeles', theme: 'dark' });
  });

  it('writes an evergreen book: the fixtures follow the seeding month', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    await seedOwner(db, ownerId, { now: new Date('2028-03-15T12:00:00.000Z') });

    const paidDates = (await invoicesRepo.listInvoices(db, ownerId))
      .map((invoice) => invoice.paidDate)
      .filter((date): date is string => date != null);
    expect(paidDates.length).toBeGreaterThan(0);
    for (const date of paidDates) {
      // Inside the trailing 13-month margin window of the seeding instant.
      expect(date >= '2027-03-01').toBe(true);
      expect(date <= '2028-03-31').toBe(true);
    }
  });

  it('leaves an owner’s own time zone alone when it already had data', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await seedOwner(db, ownerId);
    await db.update(users).set({ settings: { timeZone: 'America/New_York' } }).where(eq(users.id, ownerId));

    await seedOwner(db, ownerId);

    expect(await ownersRepo.getTimeZone(db, ownerId)).toBe('America/New_York');
  });
});
