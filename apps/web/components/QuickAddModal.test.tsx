// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aProject } from '@/test/helpers/props';
import type { ActionResult } from '@/src/server/actions/result';

/**
 * The quick-entry modal, with the server actions mocked at the module
 * boundary - the one place this component talks to anything outside itself.
 *
 * What the assertions are about is the payload: what the user typed, as they
 * typed it. Money stays a string on this side of the wire and `parseMoney`
 * runs inside the action's schema (ADR 0007); `test/actions.test.ts` is where
 * the cents that come out of that are pinned.
 */

const actions = vi.hoisted(() => ({
  createProjectAction: vi.fn(),
  createTransactionAction: vi.fn(),
  createLaborEntryAction: vi.fn(),
  createInvoiceAction: vi.fn(),
}));

vi.mock('@/src/server/actions/projects', () => ({
  createProjectAction: actions.createProjectAction,
}));
vi.mock('@/src/server/actions/transactions', () => ({
  createTransactionAction: actions.createTransactionAction,
}));
vi.mock('@/src/server/actions/labor', () => ({
  createLaborEntryAction: actions.createLaborEntryAction,
}));
vi.mock('@/src/server/actions/invoices', () => ({
  createInvoiceAction: actions.createInvoiceAction,
}));

const { QuickAddModal } = await import('./QuickAddModal');

const PROJECTS = [
  aProject({ id: 'proj-1', name: 'Cedar Deck' }),
  aProject({ id: 'proj-2', name: 'Kitchen Island' }),
];

const succeeded: ActionResult<{ id: string }> = { ok: true, data: { id: 'new-1' } };

function renderModal(overrides: Partial<Parameters<typeof QuickAddModal>[0]> = {}) {
  const props = {
    projects: PROJECTS,
    isOpen: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  render(<QuickAddModal {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions)) action.mockResolvedValue(succeeded);
});

afterEach(cleanup);

describe('QuickAddModal', () => {
  it('renders nothing at all when it is closed', () => {
    renderModal({ isOpen: false });

    expect(screen.queryByText('Quick Entry Center')).not.toBeInTheDocument();
  });

  it('opens on the tab the page asked for', () => {
    renderModal({ initialTab: 'invoice' });

    expect(screen.getByRole('button', { name: 'Invoice' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Receipt' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  describe('recording a receipt', () => {
    it('sends what the user typed, money included, as they typed it', async () => {
      renderModal({ initialTab: 'expense' });

      await userEvent.selectOptions(screen.getByLabelText(/link to project/i), 'proj-2');
      await userEvent.clear(screen.getByLabelText(/^vendor$/i));
      await userEvent.type(screen.getByLabelText(/^vendor$/i), "Lowe's");
      await userEvent.type(screen.getByLabelText(/amount/i), '1,234.56');
      await userEvent.click(screen.getByRole('button', { name: /record expense/i }));

      await waitFor(() =>
        expect(actions.createTransactionAction).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'proj-2',
            vendor: "Lowe's",
            amount: '1,234.56',
            category: 'materials',
          })
        )
      );
    });

    it('closes and tells the page once the write has landed', async () => {
      const { onClose, onCreated } = renderModal({ initialTab: 'expense' });

      await userEvent.type(screen.getByLabelText(/amount/i), '145.50');
      await userEvent.click(screen.getByRole('button', { name: /record expense/i }));

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCreated).toHaveBeenCalled();
    });

    it('shows what the server said was wrong, next to the field, and stays open', async () => {
      actions.createTransactionAction.mockResolvedValue({
        ok: false,
        error: 'Enter an amount like 1,234.56',
        fieldErrors: { amount: ['Enter an amount like 1,234.56'] },
      });
      const { onClose } = renderModal({ initialTab: 'expense' });

      await userEvent.type(screen.getByLabelText(/amount/i), 'about a hundred');
      await userEvent.click(screen.getByRole('button', { name: /record expense/i }));

      await waitFor(() =>
        expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/Enter an amount/)
      );
      expect(onClose).not.toHaveBeenCalled();
      // What the user typed survives the refusal.
      expect(screen.getByLabelText(/amount/i)).toHaveValue('about a hundred');
    });

    it('clears the last complaint when the form is submitted again', async () => {
      actions.createTransactionAction.mockResolvedValueOnce({
        ok: false,
        error: 'Enter an amount like 1,234.56',
        fieldErrors: { amount: ['Enter an amount like 1,234.56'] },
      });
      renderModal({ initialTab: 'expense' });
      const submit = screen.getByRole('button', { name: /record expense/i });

      await userEvent.type(screen.getByLabelText(/amount/i), 'nope');
      await userEvent.click(submit);
      await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));

      await userEvent.type(screen.getByLabelText(/amount/i), '10.00');
      await userEvent.click(submit);

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });

  describe('the other three tabs', () => {
    it('creates a project from the quoted figures as typed', async () => {
      renderModal({ initialTab: 'project' });

      await userEvent.type(screen.getByLabelText(/project name/i), 'Bathroom Remodel');
      await userEvent.type(screen.getByLabelText(/client name/i), 'S Miller');
      await userEvent.clear(screen.getByLabelText(/quoted price/i));
      await userEvent.type(screen.getByLabelText(/quoted price/i), '6,800');
      await userEvent.click(screen.getByRole('button', { name: /create project/i }));

      await waitFor(() =>
        expect(actions.createProjectAction).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Bathroom Remodel',
            clientName: 'S Miller',
            quotedTotal: '6,800',
          })
        )
      );
    });

    it('shows a required field the server rejected', async () => {
      actions.createProjectAction.mockResolvedValue({
        ok: false,
        error: 'Give the project a name',
        fieldErrors: { name: ['Give the project a name'] },
      });
      renderModal({ initialTab: 'project' });

      await userEvent.click(screen.getByRole('button', { name: /create project/i }));

      await waitFor(() =>
        expect(screen.getAllByRole('alert').some((a) => /Give the project a name/.test(a.textContent ?? '')))
          .toBe(true)
      );
    });

    it('logs hours against the job that was picked', async () => {
      renderModal({ initialTab: 'labor', initialProjectId: 'proj-1' });

      await userEvent.clear(screen.getByLabelText(/hours worked/i));
      await userEvent.type(screen.getByLabelText(/hours worked/i), '6.5');
      await userEvent.click(screen.getByRole('button', { name: /log labor hours/i }));

      await waitFor(() =>
        expect(actions.createLaborEntryAction).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: 'proj-1', hours: '6.5', hourlyRate: '85' })
        )
      );
    });

    it('issues an invoice against the job that was picked', async () => {
      renderModal({ initialTab: 'invoice', initialProjectId: 'proj-2' });

      await userEvent.type(screen.getByLabelText(/invoice number/i), 'INV-2026-045');
      await userEvent.clear(screen.getByLabelText(/total amount/i));
      await userEvent.type(screen.getByLabelText(/total amount/i), '1950');
      await userEvent.click(screen.getByRole('button', { name: /issue invoice/i }));

      await waitFor(() =>
        expect(actions.createInvoiceAction).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'proj-2',
            invoiceNumber: 'INV-2026-045',
            amount: '1950',
          })
        )
      );
    });
  });

  it('offers every job on the tabs that need one', async () => {
    renderModal({ initialTab: 'labor' });

    const options = screen.getByLabelText(/project \/ job/i).querySelectorAll('option');
    expect([...options].map((option) => option.textContent)).toEqual([
      'Select a job...',
      'Cedar Deck',
      'Kitchen Island',
    ]);
  });

  it('closes without writing anything when cancelled', async () => {
    const { onClose } = renderModal({ initialTab: 'expense' });

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(actions.createTransactionAction).not.toHaveBeenCalled();
  });
});
