import { describe, expect, it } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { spendByCategory } from '@/src/server/queries/spend';

/**
 * Where the money went, by category.
 *
 * The reason this is a tested function rather than four lines inside the page:
 * the page summed every transaction for its denominator, refunds and card
 * payments included. Once negative rows started being stored - which is what
 * the sign convention asks for (spec §8) - that denominator went below the
 * materials total and the page reported "Materials 135%" next to a bar that
 * ran off the end, and an Overhead bar at -49%.
 */

const row = (
  category: 'materials' | 'tools' | 'mileage_fuel' | 'permits_fees' | 'overhead' | 'subcontractor',
  dollars: number,
  status: 'matched' | 'unassigned' | 'ignored' = 'matched'
) => ({ category, amountCents: parseMoney(dollars), status });

describe('spendByCategory', () => {
  it('totals each category and reports its share', () => {
    const spend = spendByCategory([
      row('materials', 750),
      row('materials', 250),
      row('tools', 250),
      row('mileage_fuel', 250),
    ]);

    expect(spend.totalCents).toBe(150000);
    expect(spend.byCategory.materials).toEqual({ amountCents: 100000, pct: 66.7 });
    expect(spend.byCategory.tools).toEqual({ amountCents: 25000, pct: 16.7 });
  });

  it('leaves out the rows the user filed as ignored', () => {
    // A card payment is money moving, not money spent. Counting it would
    // shrink the denominator below the categories it is meant to divide.
    const spend = spendByCategory([
      row('materials', 1000),
      row('overhead', -2500, 'ignored'),
    ]);

    expect(spend.totalCents).toBe(100000);
    expect(spend.byCategory.materials.pct).toBe(100);
    expect(spend.byCategory.overhead).toEqual({ amountCents: 0, pct: 0 });
  });

  it('never reports a share above 100% or below zero', () => {
    const spend = spendByCategory([
      row('materials', 1000),
      row('overhead', -2500, 'ignored'),
      row('tools', 100),
    ]);

    for (const { pct } of Object.values(spend.byCategory)) {
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  it('counts a charge still waiting to be filed: the money still left', () => {
    const spend = spendByCategory([row('materials', 1000, 'unassigned')]);

    expect(spend.totalCents).toBe(100000);
  });

  it('reports every category, including the ones with nothing in them', () => {
    const spend = spendByCategory([row('materials', 100)]);

    expect(Object.keys(spend.byCategory).sort()).toEqual([
      'materials',
      'mileage_fuel',
      'overhead',
      'permits_fees',
      'subcontractor',
      'tools',
    ]);
  });

  it('reports zeroes rather than dividing by nothing on an empty book', () => {
    const spend = spendByCategory([]);

    expect(spend.totalCents).toBe(0);
    expect(spend.byCategory.materials).toEqual({ amountCents: 0, pct: 0 });
  });
});
