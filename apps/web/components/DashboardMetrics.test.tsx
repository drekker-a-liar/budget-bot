// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { aSummary } from '@/test/helpers/props';
import { DashboardMetrics } from './DashboardMetrics';

/**
 * The five numbers a contractor checks before deciding whether to take the
 * next job. What matters is that each one is rendered as money rather than as
 * a bare integer of cents, and that "no data" reads as absence rather than as
 * zero - a $0 realized rate and an unlogged one mean opposite things.
 */

afterEach(cleanup);

describe('DashboardMetrics', () => {
  it('renders every cents figure as money', () => {
    render(
      <DashboardMetrics
        summary={aSummary({
          totalGrossProfitYTDCents: parseMoney(5550.4),
          unassignedTransactionsTotalCents: parseMoney(372.85),
          outstandingReceivablesCents: parseMoney(4500),
          averageHourlyRealizationCents: parseMoney(96.5),
        })}
      />
    );

    expect(screen.getByText('$5,550.40')).toBeInTheDocument();
    expect(screen.getByText('$372.85')).toBeInTheDocument();
    expect(screen.getByText('$4,500.00')).toBeInTheDocument();
    // The rate is shown to the dollar; cents per hour are noise at a glance.
    expect(screen.getByText('$97')).toBeInTheDocument();
  });

  it('shows an em dash for a realized rate nobody has logged hours for', () => {
    render(
      <DashboardMetrics
        summary={aSummary({
          averageHourlyRealizationCents: null,
          averageHourlySeverity: null,
        })}
      />
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('NO HOURS LOGGED')).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('marks a deficit week as a deficit, and shows it as a magnitude', () => {
    render(
      <DashboardMetrics
        summary={aSummary({
          weeklyNetCashFlowCents: parseMoney(-1250),
          cashFlowSeverity: 'critical',
        })}
      />
    );

    expect(screen.getByText('DEFICIT')).toBeInTheDocument();
    expect(screen.getByText('$1,250')).toBeInTheDocument();
  });

  it('counts the pending inbox when there is one', () => {
    render(<DashboardMetrics summary={aSummary({ unassignedTransactionsCount: 3 })} />);

    expect(screen.getByText('3 PENDING')).toBeInTheDocument();
  });

  it('says everything is matched when nothing is waiting', () => {
    render(
      <DashboardMetrics
        summary={aSummary({
          unassignedTransactionsCount: 0,
          unassignedTransactionsTotalCents: parseMoney(0),
        })}
      />
    );

    expect(screen.getByText('ALL MATCHED')).toBeInTheDocument();
    expect(screen.queryByText(/PENDING/)).not.toBeInTheDocument();
  });

  it('hands triage to the page when the page has an inbox of its own', async () => {
    const onOpenInbox = vi.fn();
    render(<DashboardMetrics summary={aSummary()} onOpenInbox={onOpenInbox} />);

    await userEvent.click(screen.getByRole('button', { name: /triage swipes/i }));

    expect(onOpenInbox).toHaveBeenCalledOnce();
  });

  it('links to the ledger when the page has nowhere to send them', () => {
    render(<DashboardMetrics summary={aSummary()} />);

    expect(screen.getByRole('link', { name: /triage swipes/i })).toHaveAttribute(
      'href',
      '/transactions'
    );
  });
});
