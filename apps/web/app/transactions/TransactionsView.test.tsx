// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD,
  PROJECTS,
  TRANSACTIONS,
  mockNextNavigation,
  refused,
  router,
  succeeded,
} from '@/test/helpers/islands';

/**
 * The interactive half of `/transactions`.
 *
 * Three of its four writes are server actions and the fourth is the CSV
 * upload, so the actions are mocked at the module boundary and `fetch` is
 * stubbed. What is asserted is that the right id reaches the right action, and
 * that a refusal reaches the user rather than a console nobody opens.
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

const { TransactionsView } = await import('./TransactionsView');

function renderView(overrides: Partial<Parameters<typeof TransactionsView>[0]> = {}) {
  render(
    <TransactionsView
      transactions={TRANSACTIONS}
      projects={PROJECTS}
      cardProfile={null}
      unassignedCount={1}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue(succeeded);
});

afterEach(cleanup);

describe('TransactionsView', () => {
  it('renders the inbox from the rows it was given', () => {
    renderView();

    expect(screen.getByText('The Home Depot')).toBeInTheDocument();
    expect(screen.getByText('1 Unassigned Card Transactions')).toBeInTheDocument();
  });

  it('says nothing about a card until one is linked', () => {
    renderView();

    expect(screen.queryByText('Connected Card')).not.toBeInTheDocument();
  });

  it('shows the card and its available credit once there is one', () => {
    renderView({ cardProfile: CARD });

    expect(screen.getByText(/Capital One Spark Business Cash/)).toBeInTheDocument();
    // $25,000 limit less a $3,248.65 balance.
    expect(screen.getByText('$21,751.35')).toBeInTheDocument();
  });

  it('files a charge against the job that was picked', async () => {
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

  it('recategorises the charge whose dropdown changed', async () => {
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.selectOptions(
      within(row).getByRole('combobox', { name: /expense category/i }),
      'tools'
    );

    await waitFor(() =>
      expect(actions.updateTransactionCategoryAction).toHaveBeenCalledWith({
        id: 'tx-1',
        category: 'tools',
      })
    );
  });

  it('deletes the charge whose button was pressed', async () => {
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /delete expense/i }));

    await waitFor(() =>
      expect(actions.deleteTransactionAction).toHaveBeenCalledWith({ id: 'tx-1' })
    );
  });

  it('shows what an action refused, rather than swallowing it', async () => {
    actions.assignTransactionAction.mockResolvedValue(
      refused("No project 'proj-2' belongs to this owner")
    );
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.selectOptions(
      within(row).getByRole('combobox', { name: /assign to project/i }),
      'proj-2'
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/does not|belongs to this owner/i)
    );
  });

  it('says nothing when a write succeeds', async () => {
    renderView();
    const row = screen.getByText('The Home Depot').closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /delete expense/i }));

    await waitFor(() => expect(actions.deleteTransactionAction).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('uploading a statement', () => {
    const file = new File(['Date,Description,Amount\n2026-08-18,LOWES,10.00'], 'aug.csv', {
      type: 'text/csv',
    });

    function stubFetch(status: number, body: unknown) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: status < 400, json: async () => body }))
      );
    }

    afterEach(() => vi.unstubAllGlobals());

    it('posts the file to the import route and refreshes the page', async () => {
      stubFetch(200, { inserted: 1, skipped: 0, errors: [] });
      renderView();

      await userEvent.upload(screen.getByLabelText(/import csv statement/i), file);

      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/import/csv');
      expect(init.method).toBe('POST');
      expect((init.body as FormData).get('file')).toBe(file);
    });

    it('tells the user which line was skipped and why', async () => {
      // The old importer wrote this to the console. A contractor is not going
      // to open one, and a row that silently did not import is money missing
      // from a margin.
      stubFetch(200, {
        inserted: 1,
        skipped: 1,
        errors: [{ line: 4, reason: 'date: Expected a YYYY-MM-DD date' }],
      });
      renderView();

      await userEvent.upload(screen.getByLabelText(/import csv statement/i), file);

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          /Imported 1, skipped 1\. Line 4: date/
        )
      );
    });

    it('reports a rejected upload and does not refresh', async () => {
      stubFetch(413, { error: 'That file is larger than the 5 MiB import limit.' });
      renderView();

      await userEvent.upload(screen.getByLabelText(/import csv statement/i), file);

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(/5 MiB import limit/)
      );
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });

  it('opens quick add on the receipt tab', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /record manual receipt/i }));

    expect(screen.getByRole('button', { name: 'Receipt' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
