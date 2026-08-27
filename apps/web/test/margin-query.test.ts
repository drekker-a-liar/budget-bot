import { parseMoney } from '@budget-bot/core';
import { invoicesRepo, laborRepo, projectsRepo, transactionsRepo, type Database } from '@budget-bot/db';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOwner, describeDb, testDatabaseUrl, useTestDb } from './helpers/db';

// `import 'server-only'` throws outside a React Server Component. That is the
// point of it; here it is the module boundary this test reaches past.
vi.mock('server-only', () => ({}));

/**
 * `getMonthlyMargins` (spec §3), against a real Postgres.
 *
 * What matters here is what the query edge decides that `calculateMonthlyMargins`
 * itself never does: whose rows go in, which window they are read for, and
 * which time zone the range and the bucketing share. The core function's own
 * fixtures cover the math; this covers the wiring.
 */

async function ownerWithProject(db: Database): Promise<[string, string]> {
  const ownerId = await createOwner(db);
  const project = await projectsRepo.createProject(db, ownerId, {
    name: 'Cedar Deck Reconstruction',
    clientName: 'Robert Henderson',
    clientPhone: '(555) 876-5432',
    clientAddress: '1204 Pine Valley Way',
    description: 'Tear out and rebuild a 16x20 deck.',
    status: 'in_progress',
    pricingType: 'fixed',
    quotedTotalCents: parseMoney('4500.00'),
    quotedMaterialsCents: parseMoney('1750.00'),
    quotedLaborHours: 32,
    targetHourlyRateCents: parseMoney('85.00'),
    targetMarginPct: 45,
    startDate: '2026-08-02',
  });
  return [ownerId, project.id];
}

// Raw SQL rather than drizzle's query builder: `drizzle-orm` is not a
// dependency of this app (see `test/helpers/db.ts`).
async function setTimeZone(db: Database, ownerId: string, timeZone: string): Promise<void> {
  await db.$client`update users set settings = ${JSON.stringify({ timeZone })} where id = ${ownerId}`;
}

/** `YYYY-MM-DD` for right now, in `timeZone` - the same reading `getMonthlyMargins` takes. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `today`'s date, `monthsBack` months earlier - day fixed at 15th to dodge month-length edge cases. */
function monthsBefore(today: string, monthsBack: number): string {
  const [year, month] = today.split('-').map(Number);
  const total = year * 12 + (month - 1) - monthsBack;
  const backYear = Math.floor(total / 12);
  const backMonth = (total % 12) + 1;
  return `${backYear}-${String(backMonth).padStart(2, '0')}-15`;
}

const { getMonthlyMargins } = await import('@/src/server/queries/margin');

describeDb('getMonthlyMargins', () => {
  const getDb = useTestDb();

  beforeEach(() => {
    // `getMonthlyMargins` reaches the database through the app's own `getDb()`
    // singleton, not the harness's connection; pointing `DATABASE_URL` at the
    // same test database is what makes the two see the same rows (the same
    // reason `webhooks-plaid-route.test.ts` does this).
    vi.stubEnv('DATABASE_URL', testDatabaseUrl as string);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never lets one owner’s revenue show up in another’s months', async () => {
    const db = getDb();
    const [alice] = await ownerWithProject(db);
    const [bob, bobProject] = await ownerWithProject(db);
    const today = todayIn('UTC');
    await invoicesRepo.createInvoice(db, bob, {
      projectId: bobProject,
      invoiceNumber: 'INV-BOB-1',
      amountCents: parseMoney('9000.00'),
      depositAmountCents: parseMoney('0.00'),
      dateIssued: today,
      dueDate: today,
      status: 'paid',
      paidDate: today,
    });

    const { months } = await getMonthlyMargins(alice);

    const totalRevenue = months.reduce((sum, month) => sum + month.revenueCents, 0);
    expect(totalRevenue).toBe(0);
  });

  it('excludes a paid invoice from 13 months back and includes one paid today', async () => {
    const db = getDb();
    const [ownerId, projectId] = await ownerWithProject(db);
    const today = todayIn('UTC');
    const tooOld = monthsBefore(today, 13);
    await invoicesRepo.createInvoice(db, ownerId, {
      projectId,
      invoiceNumber: 'INV-OLD',
      amountCents: parseMoney('5000.00'),
      depositAmountCents: parseMoney('0.00'),
      dateIssued: tooOld,
      dueDate: tooOld,
      status: 'paid',
      paidDate: tooOld,
    });
    await invoicesRepo.createInvoice(db, ownerId, {
      projectId,
      invoiceNumber: 'INV-NEW',
      amountCents: parseMoney('3000.00'),
      depositAmountCents: parseMoney('0.00'),
      dateIssued: today,
      dueDate: today,
      status: 'paid',
      paidDate: today,
    });

    const { months } = await getMonthlyMargins(ownerId);

    const totalRevenue = months.reduce((sum, month) => sum + month.revenueCents, 0);
    expect(totalRevenue).toBe(parseMoney('3000.00'));
  });

  it('defaults to UTC when the owner has never set a time zone', async () => {
    const db = getDb();
    const [ownerId] = await ownerWithProject(db);

    const { timeZone } = await getMonthlyMargins(ownerId);

    expect(timeZone).toBe('UTC');
  });

  it('honors the time zone once the owner has set one', async () => {
    const db = getDb();
    const [ownerId] = await ownerWithProject(db);
    await setTimeZone(db, ownerId, 'America/Los_Angeles');

    const { timeZone } = await getMonthlyMargins(ownerId);

    expect(timeZone).toBe('America/Los_Angeles');
  });

  it('is trailing 12 full months plus month-to-date, ending in the owner’s current month', async () => {
    const db = getDb();
    const [ownerId, projectId] = await ownerWithProject(db);
    const today = todayIn('UTC');
    await laborRepo.createLaborEntry(db, ownerId, {
      projectId,
      date: today,
      hours: 1,
      hourlyRateCents: parseMoney('10.00'),
      workerName: 'Test Worker',
    });

    const { months } = await getMonthlyMargins(ownerId);

    expect(months).toHaveLength(13);
    expect(months[months.length - 1].month).toBe(today.slice(0, 7));
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
  });

  it('never mixes another owner’s costs into the total', async () => {
    const db = getDb();
    const [alice] = await ownerWithProject(db);
    const [bob, bobProject] = await ownerWithProject(db);
    const today = todayIn('UTC');
    await transactionsRepo.createTransaction(db, bob, {
      date: today,
      description: 'Bob-only cost',
      vendor: 'Bob Supply Co',
      amountCents: parseMoney('500.00'),
      category: 'materials',
      paymentMethod: 'card',
      status: 'matched',
      projectId: bobProject,
      taxDeductible: false,
    });

    const { months } = await getMonthlyMargins(alice);

    const totalCogs = months.reduce((sum, month) => sum + month.cogs.total, 0);
    expect(totalCogs).toBe(0);
  });
});
