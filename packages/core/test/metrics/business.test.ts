import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBusinessSummary } from '../../src/metrics/business';
import type { ExpenseTransaction, Invoice, InvoiceStatus } from '../../src/types';
import { parseMoney } from '../../src/money';
import {
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
  SEED_LABOR,
  SEED_INVOICES,
} from '../fixtures';

const invoice = (
  status: InvoiceStatus,
  dollars: number,
  paidDate?: string,
  dueDate = '2026-08-19'
): Invoice => ({
  id: `inv-${status}-${dollars}-${dueDate}`,
  projectId: 'proj-x',
  invoiceNumber: 'INV-TEST',
  amountCents: parseMoney(dollars),
  depositAmountCents: parseMoney(0),
  dateIssued: '2026-08-18',
  dueDate,
  status,
  paidDate,
  createdAt: '2026-08-18T00:00:00.000Z',
});

const expense = (
  dollars: number,
  date: string,
  status: ExpenseTransaction['status'] = 'matched'
): ExpenseTransaction => ({
  id: `tx-${dollars}-${date}-${status}`,
  date,
  description: 'A PURCHASE',
  vendor: 'A Vendor',
  amountCents: parseMoney(dollars),
  category: 'materials',
  paymentMethod: 'card',
  status,
  taxDeductible: true,
  createdAt: `${date}T00:00:00.000Z`,
  postedAt: null,
  pending: false,
  source: 'manual',
  provider: null,
  externalId: null,
  bankAccountId: null,
  removedAt: null,
  userEditedAt: null,
});

// CHARACTERIZATION of the aggregate figures, except where a test is marked
// CHANGED: those pin behaviour this task deliberately altered.

const NOW = new Date('2026-08-20T12:00:00.000Z');
const UTC = 'UTC';

const summarize = (now: Date = NOW) =>
  calculateBusinessSummary(
    SEED_PROJECTS,
    SEED_TRANSACTIONS,
    SEED_LABOR,
    SEED_INVOICES,
    now,
    UTC
  );

/** An empty book with just these invoices, summarised at `now` in `timeZone`. */
const receivables = (invoices: Invoice[], now: Date = NOW, timeZone = UTC) =>
  calculateBusinessSummary([], [], [], invoices, now, timeZone);

afterEach(() => {
  vi.useRealTimers();
});

describe('calculateBusinessSummary', () => {
  it('aggregates the seed book of business at a given instant', () => {
    expect(summarize()).toEqual({
      totalRevenueCents: 1_825_000,
      totalMaterialsCents: 432_140,
      totalLaborCents: 783_000,
      totalGrossProfitCents: 578_860,
      averageMarginPct: 31.7,
      averageMarginSeverity: 'caution',
      averageHourlyRealizationCents: 15_132,
      averageHourlySeverity: 'healthy',
      openProjectsCount: 2,
      unassignedTransactionsCount: 3,
      unassignedTransactionsTotalCents: 37_285,
      outstandingReceivablesCents: 450_000,
      overdueReceivablesCents: 0,
      receivablesSeverity: 'healthy',
      weeklyCashInflowCents: 375_000,
      weeklyCashOutflowCents: 139_155,
      weeklyNetCashFlowCents: 235_845,
      cashFlowSeverity: 'healthy',
    });
  });

  // CHANGED: the four totals were named `*YTD*` and never were: they sum every
  // project's KPIs whatever their dates, on the invoiced-or-quoted basis the
  // project card uses. Pinning the arithmetic under the honest name so nobody
  // "fixes" the rename by adding a year filter that the per-project basis
  // cannot support (a quote has no date to filter on).
  it('CHANGED: the totals cover every job ever entered, not the year to date', () => {
    const inLastYear = {
      ...SEED_PROJECTS[0],
      id: 'proj-old',
      startDate: '2025-03-01',
      completedDate: '2025-03-20',
    };
    const oldInvoice = {
      ...invoice('paid', 1000, '2025-03-21', '2025-03-20'),
      projectId: 'proj-old',
      dateIssued: '2025-03-20',
    };
    const summary = calculateBusinessSummary(
      [inLastYear],
      [],
      [],
      [oldInvoice],
      NOW,
      UTC
    );
    expect(summary.totalRevenueCents).toBe(100_000);
    expect(summary.totalGrossProfitCents).toBe(100_000);
    expect(summary).not.toHaveProperty('totalGrossProfitYTDCents');
  });

  // CHANGED: in float dollars these two totals came out as 372.84999999999997
  // and 1391.5500000000002. Sums of cents are exact.
  it('CHANGED: totals that used to drift in float are exact', () => {
    const summary = summarize();
    expect(summary.unassignedTransactionsTotalCents).toBe(37_285);
    expect(summary.weeklyCashOutflowCents).toBe(139_155);
  });

  // CHANGED (Phase 5): zero revenue used to fabricate a 0% margin (and a
  // 'critical' severity for it). /margin's rule — null, never a sentinel —
  // now applies to the dashboard aggregate too.
  it('CHANGED: reports null margin and severity when there is no revenue', () => {
    const summary = calculateBusinessSummary([], [], [], [], NOW, UTC);
    expect(summary.averageMarginPct).toBeNull();
    expect(summary.averageMarginSeverity).toBeNull();
  });

  // CHANGED: `now` used to be read from the wall clock inside the function.
  it('CHANGED: takes `now` as a required parameter and never reads the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-05-05T00:00:00.000Z'));

    const summary = summarize(NOW);
    expect(summary.weeklyCashInflowCents).toBe(375_000);
    expect(summary.weeklyCashOutflowCents).toBe(139_155);
    expect(summary.weeklyNetCashFlowCents).toBe(235_845);
    // The due-date check reads the same `now`: the seed's one open invoice
    // (due 2026-08-20) is not overdue at NOW, however late the clock says it is.
    expect(summary.overdueReceivablesCents).toBe(0);
  });

  it('CHANGED: a different `now` moves the weekly cash-flow window', () => {
    const summary = summarize(new Date('2027-01-01T00:00:00.000Z'));
    expect(summary.weeklyCashInflowCents).toBe(0);
    expect(summary.weeklyCashOutflowCents).toBe(0);
    expect(summary.weeklyNetCashFlowCents).toBe(0);
    expect(summary.cashFlowSeverity).toBe('healthy');
  });

  // CHANGED (bug 2): the business figure used to be
  // (totalRevenue - totalMaterials) / totalHours, subtracting materials only
  // and leaving subcontractor and other direct costs in, so it disagreed with
  // the per-project netHourlyRealization it was supposed to summarise. It is
  // now sum(kpi.netEarningsCents) / totalHours, the same definition scaled up.
  it('CHANGED: business realization sums the same net earnings the projects report', () => {
    // $13,618.60 net earnings / 90 hrs. The old materials-only formula reported
    // $154.76/hr by leaving $1,690 of subs and disposal costs in.
    expect(summarize().averageHourlyRealizationCents).toBe(15_132);
    expect(summarize().averageHourlySeverity).toBe('healthy');
  });

  /**
   * CHANGED: overdue is derived from `dueDate` against today on the owner's
   * calendar, not read from `status`. Nothing in the product writes
   * `'overdue'`, so the old `status === 'overdue'` check could never fire and
   * every book of business reported $0 overdue and a green badge. The seed's
   * open invoice is due 2026-08-20; NOW is midday UTC that day, so it is
   * current in these tests and becomes overdue the next morning.
   */
  describe('overdue receivables', () => {
    it('CHANGED: a sent invoice past its due date is overdue without anyone marking it', () => {
      const summary = receivables([invoice('sent', 300, undefined, '2026-08-19')]);
      expect(summary.overdueReceivablesCents).toBe(30_000);
      expect(summary.outstandingReceivablesCents).toBe(30_000);
    });

    it('is not overdue on its due date, only after it', () => {
      const dueToday = invoice('sent', 300, undefined, '2026-08-20');
      expect(receivables([dueToday]).overdueReceivablesCents).toBe(0);
      expect(
        receivables([dueToday], new Date('2026-08-21T00:00:00.000Z')).overdueReceivablesCents
      ).toBe(30_000);
    });

    it('reads "today" in the owner zone: due yesterday in Auckland while UTC is still on the due date', () => {
      // 20:00Z on the 19th is 08:00 on the 20th in Auckland (UTC+12).
      const dueOn19th = invoice('sent', 300, undefined, '2026-08-19');
      const now = new Date('2026-08-19T20:00:00.000Z');
      expect(receivables([dueOn19th], now, 'UTC').overdueReceivablesCents).toBe(0);
      expect(receivables([dueOn19th], now, 'Pacific/Auckland').overdueReceivablesCents).toBe(
        30_000
      );
    });

    it('reads "today" in the owner zone: still the due date in Los Angeles while UTC has moved on', () => {
      // 03:00Z on the 20th is 20:00 on the 19th in Los Angeles (UTC-7).
      const dueOn19th = invoice('sent', 300, undefined, '2026-08-19');
      const now = new Date('2026-08-20T03:00:00.000Z');
      expect(receivables([dueOn19th], now, 'UTC').overdueReceivablesCents).toBe(30_000);
      expect(
        receivables([dueOn19th], now, 'America/Los_Angeles').overdueReceivablesCents
      ).toBe(0);
    });

    it('never counts a paid invoice, however old its due date', () => {
      const summary = receivables([invoice('paid', 300, '2026-08-01', '2026-07-01')]);
      expect(summary.overdueReceivablesCents).toBe(0);
      expect(summary.receivablesSeverity).toBe('healthy');
    });

    it('never counts a draft: nobody has been asked to pay it', () => {
      const summary = receivables([invoice('draft', 300, undefined, '2026-07-01')]);
      expect(summary.overdueReceivablesCents).toBe(0);
      expect(summary.outstandingReceivablesCents).toBe(0);
    });

    it('keeps an imported row already marked overdue, once its due date has passed', () => {
      expect(
        receivables([invoice('overdue', 300, undefined, '2026-08-19')]).overdueReceivablesCents
      ).toBe(30_000);
      // The status alone does not make it late; the date does.
      expect(
        receivables([invoice('overdue', 300, undefined, '2026-09-01')]).overdueReceivablesCents
      ).toBe(0);
    });

    it.each([
      [0, 'healthy'],
      [500, 'healthy'],
      [500.01, 'caution'],
      [2000, 'caution'],
      [2000.01, 'critical'],
    ])('$%s overdue since yesterday is %s', (dollars, expected) => {
      const invoices = dollars > 0 ? [invoice('sent', dollars, undefined, '2026-08-19')] : [];
      expect(receivables(invoices).receivablesSeverity).toBe(expected);
    });

    // CHANGED: THRESHOLDS.RECEIVABLES_OVERDUE_DAYS had no reader. The age of
    // the oldest overdue invoice now grades the badge alongside the amount.
    it.each([
      ['2026-08-07', 13, 'healthy'],
      ['2026-08-06', 14, 'caution'],
      ['2026-07-22', 29, 'caution'],
      ['2026-07-21', 30, 'critical'],
    ])('CHANGED: $100 due %s (%s days ago) is %s', (dueDate, _days, expected) => {
      expect(receivables([invoice('sent', 100, undefined, dueDate)]).receivablesSeverity).toBe(
        expected
      );
    });

    it('CHANGED: shows the worse of the amount and the age readings', () => {
      // Small and very late: amount says healthy, age says critical.
      const stale = invoice('sent', 100, undefined, '2026-06-01');
      // Large and barely late: age says healthy, amount says critical.
      const fresh = invoice('sent', 2500, undefined, '2026-08-19');
      expect(receivables([stale]).receivablesSeverity).toBe('critical');
      expect(receivables([fresh]).receivablesSeverity).toBe('critical');
      // The oldest invoice sets the age, not the newest or the largest.
      const middling = invoice('sent', 100, undefined, '2026-08-01');
      expect(receivables([fresh, middling]).receivablesSeverity).toBe('critical');
      expect(receivables([invoice('sent', 100, undefined, '2026-08-19'), middling]).receivablesSeverity).toBe('caution');
    });
  });

  it.each([
    [1000, 'healthy'],
    [0, 'healthy'],
    [-0.01, 'caution'],
    [-500, 'caution'],
    [-500.01, 'critical'],
  ])('a weekly net cash flow of $%s is %s', (net, expected) => {
    // One paid invoice in, one expense out, both inside the seven-day window.
    const invoices = [invoice('paid', 1000, '2026-08-19')];
    const transactions = [expense(1000 - net, '2026-08-19')];
    const summary = calculateBusinessSummary([], transactions, [], invoices, NOW, UTC);
    expect(summary.weeklyNetCashFlowCents).toBe(parseMoney(net));
    expect(summary.cashFlowSeverity).toBe(expected);
  });

  /**
   * Weekly outflow counts money that went out, by the same rule
   * `spendByCategory` uses: not `ignored`, and not negative.
   *
   * A card payment or a refund arrives negative and is filed `ignored`, and
   * summing it into outflow makes the outflow *smaller* and the "Weekly Net
   * Cash Flow" KPI rosier - while the cash-flow waterfall rendered beside it
   * on the same page excludes exactly that row. Two numbers about one week,
   * drawn from the same rows, disagreeing.
   */
  describe('weekly cash outflow', () => {
    const spend = expense(1000, '2026-08-19');
    const outflow = (transactions: ExpenseTransaction[]) =>
      calculateBusinessSummary([], transactions, [], [], NOW, UTC);

    it('leaves out a negative row the user filed as ignored', () => {
      const summary = outflow([spend, expense(-400, '2026-08-19', 'ignored')]);

      expect(summary.weeklyCashOutflowCents).toBe(100_000);
      expect(summary.weeklyNetCashFlowCents).toBe(-100_000);
    });

    it('leaves out a negative row the user filed against a job', () => {
      // `ignored` is the default a refund arrives with, not a promise it
      // keeps: the user can match one to a project. It is still not spending.
      const summary = outflow([spend, expense(-400, '2026-08-19', 'matched')]);

      expect(summary.weeklyCashOutflowCents).toBe(100_000);
    });

    it('leaves out a positive row the user filed as ignored', () => {
      const summary = outflow([spend, expense(250, '2026-08-19', 'ignored')]);

      expect(summary.weeklyCashOutflowCents).toBe(100_000);
    });

    /**
     * Spec §2.3: `postedAt ?? date` starts doing real work.
     *
     * `date` is the transaction date a bank reports and `posted_at` is when
     * the money actually left, and they are not always the same week - a
     * Saturday card charge posts on the Monday. The KPI is about a week of
     * cash, so the posting instant is the one that decides which week it is
     * in; a row that never came from a bank has no `postedAt` and falls back
     * to its `date`, which is every case above.
     */
    it('buckets a bank row by when it posted, not by when it was dated', () => {
      const posted = {
        ...expense(500, '2026-08-12'),
        postedAt: '2026-08-19T10:00:00.000Z',
      };

      expect(outflow([posted]).weeklyCashOutflowCents).toBe(50_000);
    });

    it('leaves out a row dated this week that posted before it', () => {
      const posted = {
        ...expense(500, '2026-08-19'),
        postedAt: '2026-08-11T10:00:00.000Z',
      };

      expect(outflow([posted]).weeklyCashOutflowCents).toBe(0);
    });

    it('agrees with the waterfall about which rows are spending', () => {
      // The same rows through `spendByCategory`'s rule, spelled out here
      // because the two live in different packages and drifted apart once.
      const rows = [
        spend,
        expense(-400, '2026-08-19', 'ignored'),
        expense(250, '2026-08-19', 'ignored'),
      ];
      const spent = rows.filter((row) => row.status !== 'ignored' && row.amountCents > 0);

      expect(outflow(rows).weeklyCashOutflowCents).toBe(
        spent.reduce((total, row) => total + row.amountCents, 0)
      );
    });
  });

  // CHANGED (bug 2): with no hours logged there is no realization to report,
  // and the old code answered 85 - exactly the HOURLY_REALIZATION.HEALTHY
  // threshold - so an empty book of business rendered as green.
  it('CHANGED: realization is null, not $85/hr, when no hours have been logged', () => {
    const summary = calculateBusinessSummary([], [], [], [], NOW, UTC);
    expect(summary.averageHourlyRealizationCents).toBeNull();
    expect(summary.averageHourlySeverity).toBeNull();
  });
});
