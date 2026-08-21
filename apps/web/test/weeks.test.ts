import { describe, expect, it } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { calculateWeeklyCashFlow } from '@/src/server/queries/weeks';

/**
 * The last four weeks of cash, on a cash basis (ADR 0006): money is counted on
 * the day it moved, not on the day something was promised.
 *
 * `now` is injected, so nothing here depends on the day the suite runs. The
 * weeks are ISO weeks in UTC - Monday to Sunday - which is what a contractor
 * means by "last week" and what makes the boundaries testable at all.
 */

// A Thursday. Its week starts on Monday 2026-08-17.
const NOW = new Date('2026-08-20T15:00:00Z');

const expense = (date: string, dollars: number, status: 'unassigned' | 'matched' | 'ignored' = 'matched') => ({
  date,
  amountCents: parseMoney(dollars),
  status,
});

const paid = (paidDate: string, dollars: number) => ({
  status: 'paid' as const,
  paidDate,
  amountCents: parseMoney(dollars),
});

describe('calculateWeeklyCashFlow', () => {
  it('returns four weeks, oldest first, ending with the week `now` is in', () => {
    const weeks = calculateWeeklyCashFlow({ transactions: [], invoices: [] }, NOW);

    expect(weeks.map((week) => week.weekStart)).toEqual([
      '2026-07-27',
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
    ]);
  });

  it('zero-fills a week nothing happened in rather than leaving a gap', () => {
    const weeks = calculateWeeklyCashFlow(
      { transactions: [expense('2026-08-18', 100)], invoices: [] },
      NOW
    );

    expect(weeks[0]).toEqual({
      weekStart: '2026-07-27',
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
    });
  });

  it('counts an expense in the week it falls in', () => {
    const weeks = calculateWeeklyCashFlow(
      {
        transactions: [
          expense('2026-07-28', 100),
          expense('2026-08-04', 200),
          expense('2026-08-18', 50),
        ],
        invoices: [],
      },
      NOW
    );

    expect(weeks.map((week) => week.outflowCents)).toEqual([10000, 20000, 0, 5000]);
  });

  it('counts an invoice in the week it was paid, not the week it was issued', () => {
    const weeks = calculateWeeklyCashFlow(
      { transactions: [], invoices: [paid('2026-08-11', 6800)] },
      NOW
    );

    expect(weeks.map((week) => week.inflowCents)).toEqual([0, 0, 680000, 0]);
  });

  it('nets each week, and shows a losing week as negative', () => {
    const weeks = calculateWeeklyCashFlow(
      {
        transactions: [expense('2026-08-18', 1450.65)],
        invoices: [paid('2026-08-19', 1000)],
      },
      NOW
    );

    expect(weeks[3]).toEqual({
      weekStart: '2026-08-17',
      inflowCents: 100000,
      outflowCents: 145065,
      netCents: -45065,
    });
  });

  describe('what it leaves out', () => {
    it('ignores an expense the user filed as ignored', () => {
      // A card payment or a refund. It moved money, but counting it as spend
      // would double-count the purchases it settles (spec §8).
      const weeks = calculateWeeklyCashFlow(
        { transactions: [expense('2026-08-18', 1250, 'ignored')], invoices: [] },
        NOW
      );

      expect(weeks[3].outflowCents).toBe(0);
    });

    it('counts an unassigned charge, because the money still left', () => {
      const weeks = calculateWeeklyCashFlow(
        { transactions: [expense('2026-08-18', 88.65, 'unassigned')], invoices: [] },
        NOW
      );

      expect(weeks[3].outflowCents).toBe(8865);
    });

    it('ignores an invoice that has been sent but not paid', () => {
      const weeks = calculateWeeklyCashFlow(
        {
          transactions: [],
          invoices: [{ status: 'sent', amountCents: parseMoney(4500) }],
        },
        NOW
      );

      expect(weeks.map((week) => week.inflowCents)).toEqual([0, 0, 0, 0]);
    });

    it('ignores a paid invoice with no date on it', () => {
      const weeks = calculateWeeklyCashFlow(
        { transactions: [], invoices: [{ status: 'paid', amountCents: parseMoney(4500) }] },
        NOW
      );

      expect(weeks.map((week) => week.inflowCents)).toEqual([0, 0, 0, 0]);
    });

    it('drops anything older or newer than the window', () => {
      const weeks = calculateWeeklyCashFlow(
        {
          transactions: [expense('2026-07-26', 999), expense('2026-08-24', 999)],
          invoices: [],
        },
        NOW
      );

      expect(weeks.map((week) => week.outflowCents)).toEqual([0, 0, 0, 0]);
    });
  });

  describe('the week boundaries', () => {
    it('puts a Monday in the week it starts', () => {
      const weeks = calculateWeeklyCashFlow(
        { transactions: [expense('2026-08-17', 100)], invoices: [] },
        NOW
      );

      expect(weeks[3].outflowCents).toBe(10000);
    });

    it('puts a Sunday in the week it ends', () => {
      const weeks = calculateWeeklyCashFlow(
        { transactions: [expense('2026-08-16', 100)], invoices: [] },
        NOW
      );

      expect(weeks[2].outflowCents).toBe(10000);
      expect(weeks[3].outflowCents).toBe(0);
    });

    it('reads `now` on a Sunday as the last day of its week, not the first', () => {
      const weeks = calculateWeeklyCashFlow(
        { transactions: [], invoices: [] },
        new Date('2026-08-23T23:59:00Z')
      );

      expect(weeks.at(-1)?.weekStart).toBe('2026-08-17');
    });
  });

  it('prefers the date the bank posted a charge over the date on the receipt', () => {
    // A Saturday swipe that posts on Monday belongs to the week the money
    // actually left the account. The repository does not surface `postedAt`
    // yet; the rule is written here so that when it does, nothing has to move.
    const weeks = calculateWeeklyCashFlow(
      {
        transactions: [
          { ...expense('2026-08-16', 100), postedAt: new Date('2026-08-17T09:00:00Z') },
        ],
        invoices: [],
      },
      NOW
    );

    expect(weeks[2].outflowCents).toBe(0);
    expect(weeks[3].outflowCents).toBe(10000);
  });

  it('takes a window of any length, for a caller that wants more history', () => {
    const weeks = calculateWeeklyCashFlow({ transactions: [], invoices: [] }, NOW, 2);

    expect(weeks.map((week) => week.weekStart)).toEqual(['2026-08-10', '2026-08-17']);
  });
});
