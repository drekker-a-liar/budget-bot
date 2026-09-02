// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localCalendarDate } from '@/lib/localDate';
import { parseMoney } from '@budget-bot/core';
import { anInvoice } from '@/test/helpers/props';
import {
  CARD,
  INVOICES,
  PROJECTS,
  SUMMARY,
  WEEKS,
  mockNextNavigation,
  refused,
  succeeded,
} from '@/test/helpers/islands';
import type { SpendBreakdown } from '@/src/server/queries/spend';

/**
 * The liquidity island: the waterfall, the spend split and the receivables
 * ledger. The split is computed by the query now, so what this asserts is that
 * the page renders what it was handed — and that "Mark Paid" reaches the
 * invoice whose row it is on.
 */

const actions = vi.hoisted(() => ({ markInvoicePaidAction: vi.fn() }));

vi.mock('next/navigation', () => mockNextNavigation());
vi.mock('@/src/server/actions/invoices', () => ({
  ...actions,
  createInvoiceAction: vi.fn(),
}));
vi.mock('@/src/server/actions/projects', () => ({ createProjectAction: vi.fn() }));
vi.mock('@/src/server/actions/transactions', () => ({ createTransactionAction: vi.fn() }));
vi.mock('@/src/server/actions/labor', () => ({ createLaborEntryAction: vi.fn() }));

const { CashFlowView } = await import('./CashFlowView');

const SPEND: SpendBreakdown = {
  totalCents: parseMoney(3200),
  byCategory: {
    materials: { amountCents: parseMoney(2400), pct: 75 },
    tools: { amountCents: parseMoney(480), pct: 15 },
    mileage_fuel: { amountCents: parseMoney(320), pct: 10 },
    permits_fees: { amountCents: parseMoney(0), pct: 0 },
    overhead: { amountCents: parseMoney(0), pct: 0 },
    subcontractor: { amountCents: parseMoney(0), pct: 0 },
  },
};

function renderView(overrides: Partial<Parameters<typeof CashFlowView>[0]> = {}) {
  render(
    <CashFlowView
      summary={SUMMARY}
      weeks={WEEKS}
      spend={SPEND}
      invoices={INVOICES}
      projects={PROJECTS}
      cardProfile={null}
      unassignedCount={3}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.markInvoicePaidAction.mockResolvedValue(succeeded);
});

afterEach(cleanup);

describe('CashFlowView', () => {
  it('renders the waterfall from the weeks the query computed', () => {
    renderView();

    expect(screen.getByText('Aug 10 - Aug 16')).toBeInTheDocument();
    expect(screen.getByText('Net: +$825.40')).toBeInTheDocument();
  });

  it('renders the spend split from the query, shares and all', () => {
    renderView();

    expect(screen.getByText('$3,200.00')).toBeInTheDocument();
    expect(screen.getByText(/\(75%\)/)).toBeInTheDocument();
    expect(screen.getByText('$2,400.00')).toBeInTheDocument();
  });

  it('lists every invoice with the job it belongs to', () => {
    renderView();

    const row = screen.getByText('INV-2026-042').closest('tr')!;
    expect(within(row).getByText('Cedar Deck')).toBeInTheDocument();
    expect(within(row).getByText('PENDING')).toBeInTheDocument();
  });

  it('marks an invoice paid, naming the one whose button was pressed', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /mark paid/i }));

    // Revenue is recognised on `paidDate` (ADR 0006) and the day is the one on
    // the browser's clock: the action takes no default, because the server
    // would have to guess the owner's day from its own.
    await waitFor(() =>
      expect(actions.markInvoicePaidAction).toHaveBeenCalledWith({
        id: 'inv-1',
        paidDate: localCalendarDate(),
      })
    );
  });

  it('offers no button on an invoice that is already paid', () => {
    renderView();

    const paid = screen.getByText('INV-2026-041').closest('tr')!;
    expect(within(paid).queryByRole('button')).not.toBeInTheDocument();
    expect(within(paid).getByText('PAID')).toBeInTheDocument();
  });

  it('marks an overdue invoice as overdue', () => {
    renderView({
      invoices: [anInvoice({ id: 'inv-3', invoiceNumber: 'INV-9', status: 'overdue' })],
    });

    expect(screen.getByText('OVERDUE')).toBeInTheDocument();
  });

  it('shows what the action refused, and does not pretend it was paid', async () => {
    actions.markInvoicePaidAction.mockResolvedValue(refused('No such invoice.'));
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /mark paid/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No such invoice.')
    );
  });

  it('says there are no invoices rather than drawing an empty table', () => {
    renderView({ invoices: [] });

    expect(screen.getByText('No invoices recorded.')).toBeInTheDocument();
  });

  it('shows the card credit once one is linked', () => {
    renderView({ cardProfile: CARD });

    expect(screen.getByText('$21,751')).toBeInTheDocument();
  });

  it('opens quick add on the invoice tab', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /create invoice/i }));

    expect(screen.getByRole('button', { name: 'Invoice' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
