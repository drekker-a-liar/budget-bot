import { describe, expect, it } from 'vitest';
import {
  SEED_INVOICES,
  SEED_LABOR,
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
} from '../src/seed/fixtures';
import {
  FIXTURE_ANCHOR_MONTH,
  monthsSinceAnchor,
  shiftDate,
  shiftedSeedFixtures,
} from '../src/seed/shift';

// The fixtures are authored against one fixed month and would age out of the
// trailing 13-month margin window about a year later. These pin the transform
// that keeps the demo book of business evergreen (spec §3).

describe('shiftDate', () => {
  it('moves a plain date by whole months, keeping the day', () => {
    expect(shiftDate('2026-08-14', 13)).toBe('2027-09-14');
  });

  it('crosses year boundaries in both directions', () => {
    expect(shiftDate('2026-11-15', 3)).toBe('2027-02-15');
    expect(shiftDate('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('clamps a day the target month does not have', () => {
    expect(shiftDate('2026-07-31', -1)).toBe('2026-06-30');
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftDate('2026-01-31', 25)).toBe('2028-02-29');
  });

  it('shifts only the date part of a timestamp', () => {
    expect(shiftDate('2026-08-09T17:30:00.000Z', 13)).toBe('2027-09-09T17:30:00.000Z');
  });
});

describe('monthsSinceAnchor', () => {
  it('is zero inside the anchor month', () => {
    expect(monthsSinceAnchor(new Date('2026-08-20T12:00:00.000Z'), 'America/Los_Angeles')).toBe(0);
  });

  it('counts calendar months in the given zone, not in UTC', () => {
    // 05:00 UTC on Sept 1 is still Aug 31 in Los Angeles.
    expect(monthsSinceAnchor(new Date('2027-09-01T05:00:00.000Z'), 'America/Los_Angeles')).toBe(12);
    expect(monthsSinceAnchor(new Date('2027-09-01T05:00:00.000Z'), 'UTC')).toBe(13);
  });
});

describe('shiftedSeedFixtures', () => {
  it('returns the authored fixtures verbatim at a zero shift', () => {
    expect(shiftedSeedFixtures(0)).toEqual({
      projects: SEED_PROJECTS,
      transactions: SEED_TRANSACTIONS,
      laborEntries: SEED_LABOR,
      invoices: SEED_INVOICES,
    });
  });

  it('moves every dated field by the delta and nothing else', () => {
    const { projects, transactions, laborEntries, invoices } = shiftedSeedFixtures(13);

    const project = projects.find((p) => p.id === 'proj-1')!;
    expect(project.startDate).toBe(shiftDate(SEED_PROJECTS[0].startDate, 13));
    expect(project.createdAt).toBe(shiftDate(SEED_PROJECTS[0].createdAt, 13));
    expect(project.name).toBe(SEED_PROJECTS[0].name);

    expect(transactions[0].date).toBe(shiftDate(SEED_TRANSACTIONS[0].date, 13));
    expect(transactions[0].amountCents).toBe(SEED_TRANSACTIONS[0].amountCents);
    expect(laborEntries[0].date).toBe(shiftDate(SEED_LABOR[0].date, 13));

    const paid = SEED_INVOICES.find((i) => i.paidDate)!;
    const shiftedPaid = invoices.find((i) => i.id === paid.id)!;
    expect(shiftedPaid.paidDate).toBe(shiftDate(paid.paidDate!, 13));
  });

  it('keeps an absent paidDate absent instead of inventing one', () => {
    const unpaid = SEED_INVOICES.find((i) => i.paidDate === undefined);
    expect(unpaid).toBeDefined();
    const shifted = shiftedSeedFixtures(13).invoices.find((i) => i.id === unpaid!.id)!;
    expect(shifted.paidDate).toBeUndefined();
  });

  it('lands the whole book inside the trailing 13-month window, whenever it runs', () => {
    // Seeding far from the anchor is the case that used to go stale.
    const now = new Date('2028-03-15T12:00:00.000Z');
    const delta = monthsSinceAnchor(now, 'America/Los_Angeles');
    const { transactions, laborEntries, invoices } = shiftedSeedFixtures(delta);

    const dates = [
      ...transactions.map((t) => t.date),
      ...laborEntries.map((l) => l.date),
      ...invoices.flatMap((i) => (i.paidDate ? [i.paidDate] : [])),
    ];
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      expect(date >= '2027-03-01').toBe(true);
      expect(date <= '2028-03-31').toBe(true);
    }
  });
});

describe('FIXTURE_ANCHOR_MONTH', () => {
  it('matches the month the fixtures are actually authored in', () => {
    const months = SEED_TRANSACTIONS.map((t) => t.date.slice(0, 7));
    expect(Math.max(...months.map((m) => Number(m.replace('-', ''))))).toBe(
      Number(FIXTURE_ANCHOR_MONTH.replace('-', ''))
    );
  });
});
