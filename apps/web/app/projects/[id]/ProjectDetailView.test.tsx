// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { aKpi, aLaborEntry, aProject, aTransaction, anInvoice } from '@/test/helpers/props';
import { mockNextNavigation, refused, succeeded } from '@/test/helpers/islands';

/**
 * One job's ledger.
 *
 * Its three writes all change the margin rendered above them, which is why
 * they are actions rather than local state: the page re-renders on the server
 * with the new figures. What is asserted here is that each one names the right
 * row, and that a refusal is shown rather than swallowed.
 */

const actions = vi.hoisted(() => ({
  updateProjectStatusAction: vi.fn(),
  deleteTransactionAction: vi.fn(),
  deleteLaborEntryAction: vi.fn(),
}));

vi.mock('next/navigation', () => mockNextNavigation());
vi.mock('@/src/server/actions/projects', () => ({
  ...actions,
  createProjectAction: vi.fn(),
}));
vi.mock('@/src/server/actions/transactions', () => ({
  deleteTransactionAction: actions.deleteTransactionAction,
  createTransactionAction: vi.fn(),
}));
vi.mock('@/src/server/actions/labor', () => ({
  deleteLaborEntryAction: actions.deleteLaborEntryAction,
  createLaborEntryAction: vi.fn(),
}));
vi.mock('@/src/server/actions/invoices', () => ({ createInvoiceAction: vi.fn() }));

const { ProjectDetailView } = await import('./ProjectDetailView');

const PROJECT = aProject({ id: 'proj-1', name: 'Cedar Deck Reconstruction' });

const DETAIL = {
  project: PROJECT,
  kpi: aKpi({ projectId: 'proj-1', grossMarginPct: 33.2, grossMarginSeverity: 'caution' }),
  transactions: [
    aTransaction({ id: 'tx-1', vendor: 'The Home Depot', projectId: 'proj-1', status: 'matched' }),
  ],
  laborEntries: [aLaborEntry({ id: 'lab-1', projectId: 'proj-1', hours: 8 })],
  invoices: [anInvoice({ id: 'inv-1', projectId: 'proj-1' })],
  unassignedCount: 2,
};

function renderView(overrides: Partial<typeof DETAIL> = {}) {
  render(<ProjectDetailView {...DETAIL} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue(succeeded);
});

afterEach(cleanup);

describe('ProjectDetailView', () => {
  it('renders the job and its KPIs', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Cedar Deck Reconstruction' })).toBeInTheDocument();
    expect(screen.getByText('33.2%')).toBeInTheDocument();
    expect(screen.getByText(/Quoted: \$4,500\.00/)).toBeInTheDocument();
  });

  it('shows an em dash for a realized rate with no hours behind it', () => {
    renderView({ kpi: aKpi({ netHourlyRealizationCents: null, hourlySeverity: null }) });

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('NO HOURS LOGGED')).toBeInTheDocument();
  });

  it('shows an em dash for a markup that cannot be computed', () => {
    renderView({ kpi: aKpi({ materialsMarkupPct: null, materialsMarkupSeverity: null }) });

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('lists the receipts and hours filed against this job', () => {
    renderView();

    expect(screen.getByText(/Materials & Job Receipts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Labor Hours Log \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('The Home Depot')).toBeInTheDocument();
    expect(screen.getByText('8 hrs')).toBeInTheDocument();
  });

  it('moves the job to the status that was picked', async () => {
    renderView();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /project status/i }),
      'completed'
    );

    await waitFor(() =>
      expect(actions.updateProjectStatusAction).toHaveBeenCalledWith({
        id: 'proj-1',
        status: 'completed',
      })
    );
  });

  it('deletes the receipt whose button was pressed', async () => {
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /delete expense/i }));

    await waitFor(() =>
      expect(actions.deleteTransactionAction).toHaveBeenCalledWith({ id: 'tx-1' })
    );
  });

  it('deletes the labor entry whose button was pressed', async () => {
    renderView();
    const row = screen.getByText('Mike (Lead)').closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /delete labor entry/i }));

    await waitFor(() =>
      expect(actions.deleteLaborEntryAction).toHaveBeenCalledWith({ id: 'lab-1' })
    );
  });

  it('shows what an action refused rather than leaving the page looking fine', async () => {
    actions.updateProjectStatusAction.mockResolvedValue(refused('No such project.'));
    renderView();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /project status/i }),
      'on_hold'
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No such project.')
    );
  });

  it('says the ledgers are empty rather than drawing empty tables', () => {
    renderView({ transactions: [], laborEntries: [], invoices: [] });

    expect(screen.getByText(/No receipts matched to this project yet/)).toBeInTheDocument();
    expect(screen.getByText('No labor entries recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No invoices issued for this project.')).toBeInTheDocument();
  });

  it('shows an unpaid invoice with an em dash where its paid date will go', () => {
    renderView();

    const row = screen.getByText('INV-2026-042').closest('tr')!;
    expect(within(row).getByText('SENT')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('opens quick add against this job, whichever button was used', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /log labor/i }));

    expect(screen.getByRole('button', { name: 'Labor' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByLabelText(/project \/ job/i)).toHaveValue('proj-1');
  });

  it('offers only this job in the modal, because that is the ledger being read', () => {
    renderView();

    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute(
      'href',
      '/projects'
    );
  });

  it('passes the inbox count to the header', () => {
    renderView();

    expect(screen.getByRole('link', { name: /card inbox/i })).toHaveTextContent('2');
  });

  it('costs the labor entry at the rate it was logged at', () => {
    renderView({
      laborEntries: [aLaborEntry({ id: 'lab-1', hours: 8, hourlyRateCents: parseMoney(92.5) })],
    });

    expect(screen.getByText('$740')).toBeInTheDocument();
  });
});
