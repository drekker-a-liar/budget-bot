import {
  Project,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  BusinessFinancialSummary,
  SeverityLevel,
} from '../types';
import { addCents, multiplyCents, percent, subtractCents } from '../money';
import { daysBetween, localDateString } from './dates';
import {
  getGrossMarginSeverity,
  getHourlySeverity,
  getReceivablesAgeSeverity,
} from './thresholds';
import { calculateProjectKPIs } from './project';

/** $2,000 and $500 of overdue receivables, in cents. */
const OVERDUE_CRITICAL_CENTS = 200_000;
const OVERDUE_CAUTION_CENTS = 50_000;
/** A week $500 in the red, in cents. */
const WEEKLY_CASH_CRITICAL_CENTS = -50_000;

const SEVERITY_RANK: Record<SeverityLevel, number> = { healthy: 0, caution: 1, critical: 2 };

/** The graver of two readings of the same thing. */
function worstOf(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * An invoice is overdue when it is still unpaid and its due date has passed
 * on the owner's calendar. It is derived here, from `dueDate` against `now`
 * in `timeZone`, rather than read from `status`: nothing in the product ever
 * writes `'overdue'` (the enum value exists for imports and hand edits), so a
 * rule that waited for it would never fire, and the dashboard reported every
 * book of business as current. `'sent'` and `'overdue'` are both accepted so
 * an imported row that already carries the status is not demoted; a draft has
 * not been asked for and a paid one has been answered, so neither can be late.
 */
function isOverdue(invoice: Invoice, today: string): boolean {
  return (
    (invoice.status === 'sent' || invoice.status === 'overdue') && invoice.dueDate < today
  );
}

/**
 * The whole book of business, summarised for the overview page.
 *
 * `now` is an instant and `timeZone` is the owner's IANA zone: together they
 * decide what "today" is for the due-date check, the same way the monthly
 * margin decides which month a posting falls in. Neither is read from the
 * environment, so the summary can be tested against a date boundary.
 */
export function calculateBusinessSummary(
  projects: Project[],
  transactions: ExpenseTransaction[],
  laborEntries: LaborEntry[],
  invoices: Invoice[],
  now: Date,
  timeZone: string
): BusinessFinancialSummary {
  const kpis = projects.map((p) =>
    calculateProjectKPIs(p, transactions, laborEntries, invoices)
  );

  // These sum the per-project KPIs as they stand, so they inherit that basis:
  // a job's revenue is what has been invoiced (any status, drafts included)
  // or, before anything is invoiced, its quote; costs are every matched
  // transaction and labor entry regardless of date. That is an accrual-ish
  // view of every job ever entered, not the year to date and not cash - the
  // cash-basis, by-month figure lives in `calculateMonthlyMargins` (ADR 0006)
  // and the two are not expected to agree. These fields were named `*YTD*`
  // for a while, which they never were; a genuinely YTD figure would need the
  // per-project basis to change underneath it (which invoices and costs count
  // depends on their dates, and the quote fallback has no date at all), so the
  // honest fix was the name and the label, not the arithmetic.
  const totalRevenueCents = addCents(...kpis.map((k) => k.revenueCents));
  const totalMaterialsCents = addCents(...kpis.map((k) => k.actualMaterialsCostCents));
  const totalLaborCents = addCents(...kpis.map((k) => k.actualLaborCostCents));
  const totalGrossProfitCents = addCents(...kpis.map((k) => k.grossProfitCents));

  // Null at zero revenue, same as /margin's monthly figure — a book with no
  // paid invoices has no margin, not a 0% one.
  const averageMarginPct = percent(totalGrossProfitCents, totalRevenueCents);

  // Realization uses the same net earnings each project reports, so the
  // business figure is the per-project figure scaled up rather than a second,
  // rosier definition. Null when there are no hours to divide by.
  const totalHours = kpis.reduce((sum, k) => sum + k.actualLaborHours, 0);
  const totalNetEarningsCents = addCents(...kpis.map((k) => k.netEarningsCents));
  const averageHourlyRealizationCents =
    totalHours > 0 ? multiplyCents(totalNetEarningsCents, 1 / totalHours) : null;

  const openProjectsCount = projects.filter(
    (p) => p.status === 'in_progress' || p.status === 'estimating'
  ).length;

  const unassigned = transactions.filter((t) => t.status === 'unassigned');
  const unassignedTransactionsCount = unassigned.length;
  const unassignedTransactionsTotalCents = addCents(
    ...unassigned.map((t) => t.amountCents)
  );

  // Invoices & Receivables
  const today = localDateString(now, timeZone);
  const outstandingReceivablesCents = addCents(
    ...invoices
      .filter((i) => i.status === 'sent' || i.status === 'overdue')
      .map((i) => i.amountCents)
  );
  const overdue = invoices.filter((i) => isOverdue(i, today));
  const overdueReceivablesCents = addCents(...overdue.map((i) => i.amountCents));

  // Two readings, and the badge shows the worse. Amount alone lets a small
  // invoice sit unpaid for months in green; age alone shows a $5,000 balance
  // that went late yesterday in green. Either is something the owner should
  // be chasing, so neither reading is allowed to hide the other.
  let receivablesSeverity: SeverityLevel = 'healthy';
  if (overdueReceivablesCents > OVERDUE_CRITICAL_CENTS) receivablesSeverity = 'critical';
  else if (overdueReceivablesCents > OVERDUE_CAUTION_CENTS) receivablesSeverity = 'caution';
  if (overdue.length > 0) {
    const oldestDaysPastDue = Math.max(...overdue.map((i) => daysBetween(i.dueDate, today)));
    receivablesSeverity = worstOf(
      receivablesSeverity,
      getReceivablesAgeSeverity(oldestDaysPastDue)
    );
  }

  // Weekly Cash Flow (the seven days ending at `now`)
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const weeklyCashInflowCents = addCents(
    ...invoices
      .filter(
        (i) => i.status === 'paid' && i.paidDate && new Date(i.paidDate) >= oneWeekAgo
      )
      .map((i) => i.amountCents)
  );

  // Money that actually went out, by the same rule the cash-flow waterfall
  // and the category breakdown use: not `ignored`, and not negative. A card
  // payment or a refund is both, and summing one here would *reduce* outflow
  // and make the KPI rosier than the waterfall drawn beside it on the same
  // page - two numbers about one week, from the same rows, disagreeing.
  //
  // `postedAt ?? date` because this is a question about a week of cash, and
  // for a bank row the two can fall in different weeks - a Saturday card
  // charge posts on the Monday. `postedAt` is when the money left, so it is
  // the one that decides the bucket; a manual row, or one still pending, has
  // none and is bucketed by its date as before (spec §2.3).
  const weeklyCashOutflowCents = addCents(
    ...transactions
      .filter(
        (t) =>
          t.status !== 'ignored' &&
          t.amountCents > 0 &&
          new Date(t.postedAt ?? t.date) >= oneWeekAgo
      )
      .map((t) => t.amountCents)
  );

  const weeklyNetCashFlowCents = subtractCents(
    weeklyCashInflowCents,
    weeklyCashOutflowCents
  );

  let cashFlowSeverity: SeverityLevel = 'healthy';
  if (weeklyNetCashFlowCents < WEEKLY_CASH_CRITICAL_CENTS) cashFlowSeverity = 'critical';
  else if (weeklyNetCashFlowCents < 0) cashFlowSeverity = 'caution';

  return {
    totalRevenueCents,
    totalMaterialsCents,
    totalLaborCents,
    totalGrossProfitCents,
    averageMarginPct,
    averageMarginSeverity:
      averageMarginPct === null ? null : getGrossMarginSeverity(averageMarginPct),
    averageHourlyRealizationCents,
    averageHourlySeverity:
      averageHourlyRealizationCents === null
        ? null
        : getHourlySeverity(averageHourlyRealizationCents),
    openProjectsCount,
    unassignedTransactionsCount,
    unassignedTransactionsTotalCents,
    outstandingReceivablesCents,
    overdueReceivablesCents,
    receivablesSeverity,
    weeklyCashInflowCents,
    weeklyCashOutflowCents,
    weeklyNetCashFlowCents,
    cashFlowSeverity,
  };
}
