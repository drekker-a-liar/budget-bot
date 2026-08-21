// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { aProject } from '@/test/helpers/props';
import {
  CARD,
  KPIS,
  PROJECTS,
  SUMMARY,
  TRANSACTIONS,
  WEEKS,
  mockNextNavigation,
  refused,
  succeeded,
} from '@/test/helpers/islands';

/**
 * The overview island: the metric row, the active jobs, the triage inbox and
 * the waterfall, all from one query's result.
 *
 * The dashboard is the only page that renders the inbox *and* the metric row,
 * so it is also the only place `onOpenInbox` is wired to anything — that
 * connection is asserted here.
 */

const actions = vi.hoisted(() => ({
  assignTransactionAction: vi.fn(),
  updateTransactionCategoryAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
  createTransactionAction: vi.fn(),
}));

vi.mock('next/navigation', () => mockNextNavigation());
vi.mock('@/src/server/actions/transactions', () => actions);
vi.mock('@/src/server/actions/projects', () => ({ createProjectAction: vi.fn() }));
vi.mock('@/src/server/actions/labor', () => ({ createLaborEntryAction: vi.fn() }));
vi.mock('@/src/server/actions/invoices', () => ({ createInvoiceAction: vi.fn() }));

const { DashboardView } = await import('./DashboardView');

function renderView(overrides: Partial<Parameters<typeof DashboardView>[0]> = {}) {
  render(
    <DashboardView
      summary={SUMMARY}
      projects={PROJECTS}
      projectKPIs={KPIS}
      transactions={TRANSACTIONS}
      weeks={WEEKS}
      cardProfile={null}
      unassignedCount={3}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue(succeeded);
});

afterEach(cleanup);

describe('DashboardView', () => {
  it('renders the business summary it was handed', () => {
    renderView();

    expect(screen.getByText('41.9%')).toBeInTheDocument();
    expect(screen.getByText('$372.85')).toBeInTheDocument();
    expect(screen.getByText('$5,550.00')).toBeInTheDocument();
  });

  it('shows only jobs that are running or finished, and at most four', () => {
    // The overview is a shortlist; `estimating` jobs have no costs against
    // them yet and the full list is one click away.
    renderView({
      projects: [
        ...PROJECTS,
        aProject({ id: 'proj-3', name: 'Bath Remodel', status: 'completed' }),
        aProject({ id: 'proj-4', name: 'Fence Line', status: 'in_progress' }),
        aProject({ id: 'proj-5', name: 'Deck Stain', status: 'in_progress' }),
        aProject({ id: 'proj-6', name: 'Shed Build', status: 'in_progress' }),
      ],
      projectKPIs: [
        ...KPIS,
        ...['proj-3', 'proj-4', 'proj-5', 'proj-6'].map((projectId) => ({
          ...KPIS[0],
          projectId,
        })),
      ],
    });

    expect(screen.queryByText('Kitchen Island')).not.toBeInTheDocument();
    expect(screen.getByText(/View All \(6\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /cost ledger/i })).toHaveLength(4);
  });

  it('renders the waterfall from the weeks it was given, not from literals', () => {
    renderView();

    expect(screen.getByText('Aug 17 - Aug 23')).toBeInTheDocument();
    expect(screen.getByText('Net: +$611.25')).toBeInTheDocument();
  });

  it('shows an em dash for card credit until an account is linked', () => {
    renderView();

    expect(screen.getByText('No card linked yet')).toBeInTheDocument();
  });

  it('computes the available credit once a card is linked', () => {
    renderView({ cardProfile: CARD });

    expect(screen.getByText('$21,751')).toBeInTheDocument();
    expect(screen.getByText('Limit $25,000')).toBeInTheDocument();
  });

  it('wires the metric row’s triage button to its own inbox', async () => {
    // The dashboard renders the inbox further down the same page, so triage is
    // a scroll rather than a navigation. Every other page links away instead.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /triage swipes/i }));

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('files a charge from the inbox on this page', async () => {
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.selectOptions(
      within(row).getByRole('combobox', { name: /assign to project/i }),
      'proj-2'
    );

    await waitFor(() =>
      expect(actions.assignTransactionAction).toHaveBeenCalledWith({
        id: 'tx-1',
        projectId: 'proj-2',
      })
    );
  });

  it('surfaces what an action refused', async () => {
    actions.deleteTransactionAction.mockResolvedValue(refused('No such charge.'));
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /delete expense/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No such charge.')
    );
  });

  it('opens quick add against the job whose button was pressed', async () => {
    renderView();

    await userEvent.click(screen.getAllByRole('button', { name: /log hours/i })[0]);

    expect(screen.getByRole('button', { name: 'Labor' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByLabelText(/project \/ job/i)).toHaveValue('proj-1');
  });

  it('links onward to the pages that hold the full lists', () => {
    renderView();

    expect(screen.getByRole('link', { name: /View All/ })).toHaveAttribute(
      'href',
      '/projects'
    );
    expect(screen.getByRole('link', { name: /Full Ledger/ })).toHaveAttribute(
      'href',
      '/transactions'
    );
    expect(screen.getByRole('link', { name: /Liquidity/ })).toHaveAttribute(
      'href',
      '/cashflow'
    );
  });

  it('renders an empty book without inventing anything', () => {
    renderView({
      projects: [],
      projectKPIs: [],
      transactions: [],
      weeks: [],
      unassignedCount: 0,
      summary: { ...SUMMARY, unassignedTransactionsCount: 0, unassignedTransactionsTotalCents: parseMoney(0) },
    });

    expect(screen.getByText('No cash movement recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('ALL MATCHED')).toBeInTheDocument();
  });
});
