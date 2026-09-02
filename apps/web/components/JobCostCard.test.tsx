// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { aKpi, aProject } from '@/test/helpers/props';
import { JobCostCard } from './JobCostCard';

/**
 * One job, summarised. The card's job is to put quoted against actual side by
 * side and to carry the margin severity, so that is what is asserted; the
 * gauge inside it has its own test.
 */

afterEach(cleanup);

describe('JobCostCard', () => {
  it('shows what was quoted next to what it actually cost', () => {
    render(
      <JobCostCard
        project={aProject()}
        kpi={aKpi({
          quotedTotalCents: parseMoney(4500),
          totalDirectCostCents: parseMoney(3010.95),
          grossProfitCents: parseMoney(1489.05),
        })}
      />
    );

    expect(screen.getByText('$4,500.00')).toBeInTheDocument();
    expect(screen.getByText('$3,010.95')).toBeInTheDocument();
    expect(screen.getByText('$1,489.05')).toBeInTheDocument();
  });

  it('carries the margin severity into the badge, with the percentage as its label', () => {
    render(
      <JobCostCard
        project={aProject()}
        kpi={aKpi({ grossMarginPct: 18.4, grossMarginSeverity: 'critical' })}
      />
    );

    expect(screen.getByText('18.4%').parentElement).toHaveClass('badge-critical');
  });

  it.each([
    ['estimating' as const, 'ESTIMATING', 'badge-neutral'],
    ['in_progress' as const, 'IN PROGRESS', 'badge-caution'],
    ['completed' as const, 'COMPLETED', 'badge-healthy'],
    ['on_hold' as const, 'ON HOLD', 'badge-critical'],
  ])('renders a %s job as %s', (status, label, badgeClass) => {
    render(<JobCostCard project={aProject({ status })} kpi={aKpi()} />);

    expect(screen.getByText(label)).toHaveClass(badgeClass);
  });

  it('shows an em dash for a realized rate with no hours behind it', () => {
    render(
      <JobCostCard
        project={aProject()}
        kpi={aKpi({ netHourlyRealizationCents: null, hourlySeverity: null })}
      />
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  /**
   * A job with no quote and nothing invoiced has no margin. It used to arrive
   * as `grossMarginPct: 0` with severity 'critical' and put a red "0%" on the
   * card for a job nothing had happened to; the KPI is now null and the card
   * draws the em dash on a neutral badge, the way the dashboard aggregate does.
   */
  it('shows an em dash on a neutral badge for a job with no margin to report', () => {
    render(
      <JobCostCard
        project={aProject({ quotedTotalCents: parseMoney(0) })}
        kpi={aKpi({
          quotedTotalCents: parseMoney(0),
          revenueCents: parseMoney(0),
          grossMarginPct: null,
          grossMarginSeverity: null,
        })}
      />
    );

    expect(screen.getByText('—').parentElement).toHaveClass('badge-neutral');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('still warns about a zero-quote job that has spent money, without inventing a percentage', () => {
    render(
      <JobCostCard
        project={aProject({ quotedTotalCents: parseMoney(0) })}
        kpi={aKpi({
          quotedTotalCents: parseMoney(0),
          isOverBudget: true,
          budgetVariancePct: null,
          budgetSeverity: null,
        })}
      />
    );

    expect(screen.getByText(/Over Budget \(—\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Over Budget \(0%\)/)).not.toBeInTheDocument();
  });

  it('warns about a job that has run past its hours, and by how much', () => {
    render(
      <JobCostCard
        project={aProject()}
        kpi={aKpi({ isOverBudget: true, budgetVariancePct: 118 })}
      />
    );

    expect(screen.getByText(/Over Budget \(118%\)/)).toBeInTheDocument();
  });

  it('says nothing about the budget when the job is inside it', () => {
    render(<JobCostCard project={aProject()} kpi={aKpi({ isOverBudget: false })} />);

    expect(screen.queryByText(/Over Budget/)).not.toBeInTheDocument();
  });

  it('offers to log hours against this job, and names it when asked', async () => {
    const onOpenQuickLabor = vi.fn();
    render(
      <JobCostCard
        project={aProject({ id: 'proj-7' })}
        kpi={aKpi()}
        onOpenQuickLabor={onOpenQuickLabor}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /log hours/i }));

    expect(onOpenQuickLabor).toHaveBeenCalledWith('proj-7');
  });

  it('leaves the button out when the page has no quick-add to open', () => {
    render(<JobCostCard project={aProject()} kpi={aKpi()} />);

    expect(screen.queryByRole('button', { name: /log hours/i })).not.toBeInTheDocument();
  });

  it('links its title and its ledger at the project it is about', () => {
    render(<JobCostCard project={aProject({ id: 'proj-7' })} kpi={aKpi()} />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('href', '/projects/proj-7');
    }
    expect(within(screen.getByRole('link', { name: /cost ledger/i })).queryByText(/ledger/i))
      .toBeInTheDocument();
  });
});
