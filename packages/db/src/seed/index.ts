import { eq } from 'drizzle-orm';
import type { Database, Executor } from '../client';
import { bankConnections, invoices, laborEntries, projects, transactions, users } from '../schema';
import { monthsSinceAnchor, shiftedSeedFixtures } from './shift';

export * from './fixtures';
export * from './shift';

/** The fixtures are dated as if lived here; the demo owner's zone must agree. */
const DEMO_TIME_ZONE = 'America/Los_Angeles';

/**
 * Writes the demo fixtures for one owner.
 *
 * It never creates the `users` row: Auth.js owns that table and creates a user
 * on first sign-in (ADR 0003), so a row planted here would collide with the
 * OAuth account link rather than save anyone a step. It does update that row's
 * `settings.timeZone` (spec §5) whenever it writes fixtures: the fixture dates
 * are written as if lived in the Pacific time zone, and an owner with no
 * settings would otherwise default to UTC and bucket a fixture up to a day
 * into the wrong month in the margin metrics.
 *
 * The fixture dates are shifted forward by whole months at seed time so the
 * demo book always ends near the month it is written in (see `shift.ts`).
 */

export interface SeedOptions {
  /** Delete this owner's existing rows first. Off by default. */
  reset?: boolean;
  /**
   * The instant the fixture dates are shifted relative to (see `shift.ts`).
   * Defaults to the wall clock; tests pass one to pin the shift.
   */
  now?: Date;
}

export interface SeedResult {
  /** False when the owner already had data and `reset` was not asked for. */
  seeded: boolean;
  counts: {
    projects: number;
    transactions: number;
    laborEntries: number;
    invoices: number;
  };
}

const EMPTY = { projects: 0, transactions: 0, laborEntries: 0, invoices: 0 };

async function deleteOwnerData(db: Executor, ownerId: string): Promise<void> {
  // Transactions first: they reference projects with ON DELETE SET NULL, so
  // dropping the projects would keep them as orphans rather than remove them.
  // They also reference `bank_accounts`, which is the other reason they go
  // first.
  await db.delete(transactions).where(eq(transactions.ownerId, ownerId));
  await db.delete(invoices).where(eq(invoices.ownerId, ownerId));
  await db.delete(laborEntries).where(eq(laborEntries.ownerId, ownerId));
  await db.delete(projects).where(eq(projects.ownerId, ownerId));
  // The linked banks too, and the accounts behind them by the cascade.
  //
  // Leaving them was the tempting half-measure and it is the wrong one: a
  // connection carries a *spent* `/transactions/sync` cursor, so a reset owner
  // keeps a bank that will never hand over another transaction it has already
  // delivered - the ledger is empty, the connection says "last synced two
  // minutes ago", and pressing Sync now truthfully reports nothing. Worse,
  // `(provider, item_id)` is unique, so linking the same bank again to refill
  // the inbox collides with the row nobody wanted. A reset that cannot be
  // followed by a working link is not a reset.
  await db.delete(bankConnections).where(eq(bankConnections.ownerId, ownerId));
}

export async function seedOwner(
  db: Database,
  ownerId: string,
  options: SeedOptions = {}
): Promise<SeedResult> {
  const delta = monthsSinceAnchor(options.now ?? new Date(), DEMO_TIME_ZONE);
  const {
    projects: seedProjects,
    transactions: seedTransactions,
    laborEntries: seedLabor,
    invoices: seedInvoices,
  } = shiftedSeedFixtures(delta);

  return db.transaction(async (tx) => {
    if (options.reset) {
      await deleteOwnerData(tx, ownerId);
    } else {
      const [existing] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.ownerId, ownerId))
        .limit(1);
      if (existing) return { seeded: false, counts: EMPTY };
    }

    // Merge, never replace: the jsonb can hold settings keys this build has
    // never heard of, and a seed that erases them is a seed nobody asked for.
    // `FOR UPDATE`, because a merge built from an unlocked read is the same
    // clobber with a shorter window: this runs from the first-sign-in event
    // while the first requests are already in flight.
    const [owner] = await tx
      .select({ settings: users.settings })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1)
      .for('update');
    await tx
      .update(users)
      .set({ settings: { ...owner?.settings, timeZone: DEMO_TIME_ZONE } })
      .where(eq(users.id, ownerId));

    const projectRows = await tx
      .insert(projects)
      .values(
        seedProjects.map((project) => ({
          ownerId,
          name: project.name,
          clientName: project.clientName,
          clientPhone: project.clientPhone,
          clientAddress: project.clientAddress,
          description: project.description,
          status: project.status,
          pricingType: project.pricingType,
          quotedTotalCents: project.quotedTotalCents,
          quotedMaterialsCents: project.quotedMaterialsCents,
          quotedLaborHours: project.quotedLaborHours,
          targetHourlyRateCents: project.targetHourlyRateCents,
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

    // The fixtures reference projects by their fixture id; the database just
    // generated real ones. Insert order is the order given, so the two lists
    // line up.
    const projectIds = new Map(
      seedProjects.map((project, index) => [project.id, projectRows[index].id])
    );
    const projectId = (fixtureId: string): string => {
      const id = projectIds.get(fixtureId);
      if (!id) throw new Error(`Seed fixture references unknown project '${fixtureId}'`);
      return id;
    };

    await tx.insert(transactions).values(
      seedTransactions.map((transaction) => ({
        ownerId,
        date: transaction.date,
        description: transaction.description,
        vendor: transaction.vendor,
        amountCents: transaction.amountCents,
        category: transaction.category,
        paymentMethod: transaction.paymentMethod,
        cardLast4: transaction.cardLast4 ?? null,
        status: transaction.status,
        projectId: transaction.projectId ? projectId(transaction.projectId) : null,
        receiptNumber: transaction.receiptNumber ?? null,
        taxDeductible: transaction.taxDeductible,
        notes: transaction.notes ?? null,
        createdAt: new Date(transaction.createdAt),
        updatedAt: new Date(transaction.updatedAt ?? transaction.createdAt),
      }))
    );

    await tx.insert(laborEntries).values(
      seedLabor.map((entry) => ({
        ownerId,
        projectId: projectId(entry.projectId),
        date: entry.date,
        hours: entry.hours,
        hourlyRateCents: entry.hourlyRateCents,
        workerName: entry.workerName,
        notes: entry.notes ?? null,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt ?? entry.createdAt),
      }))
    );

    await tx.insert(invoices).values(
      seedInvoices.map((invoice) => ({
        ownerId,
        projectId: projectId(invoice.projectId),
        invoiceNumber: invoice.invoiceNumber,
        amountCents: invoice.amountCents,
        depositAmountCents: invoice.depositAmountCents,
        dateIssued: invoice.dateIssued,
        dueDate: invoice.dueDate,
        status: invoice.status,
        paidDate: invoice.paidDate ?? null,
        notes: invoice.notes ?? null,
        createdAt: new Date(invoice.createdAt),
        updatedAt: new Date(invoice.updatedAt ?? invoice.createdAt),
      }))
    );

    return {
      seeded: true,
      counts: {
        projects: seedProjects.length,
        transactions: seedTransactions.length,
        laborEntries: seedLabor.length,
        invoices: seedInvoices.length,
      },
    };
  });
}
