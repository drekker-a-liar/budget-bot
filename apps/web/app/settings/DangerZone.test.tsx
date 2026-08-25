// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockNextNavigation, refused, router } from '@/test/helpers/islands';

/**
 * Export and delete-all (spec §6), the settings page's "Danger zone".
 *
 * Export is a plain link - nothing to click-handle, just an `href` a browser
 * already knows how to save. Delete-all is `ConfirmGate` wired to
 * `deleteAllDataAction`; `ConfirmGate.test.tsx` covers the gate itself, so
 * what is worth pinning here is that this component asks for the right
 * phrase and calls the right action, and reports pending/error/success the
 * way every other action-backed island in this app does.
 */

vi.mock('next/navigation', () => mockNextNavigation());

vi.mock('@/src/server/actions/account', () => ({
  deleteAllDataAction: vi.fn(async () => ({
    ok: true as const,
    data: {
      connections: 1,
      transactions: 12,
      laborEntries: 3,
      invoices: 2,
      importBatches: 1,
      projects: 4,
    },
  })),
}));

const { deleteAllDataAction } = await import('@/src/server/actions/account');
const { DangerZone } = await import('./DangerZone');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const openConfirm = () =>
  userEvent.click(screen.getByRole('button', { name: /delete all my data/i }));

describe('exporting', () => {
  it('is a plain link to /api/export, not a click handler', () => {
    render(<DangerZone />);

    const link = screen.getByRole('link', { name: /export my data/i });
    expect(link).toHaveAttribute('href', '/api/export');
  });
});

describe('before typing the confirmation phrase', () => {
  it('shows a disabled destructive button and no confirmation input', () => {
    render(<DangerZone />);

    expect(screen.queryByLabelText(/type.*delete everything/i)).not.toBeInTheDocument();
  });

  it('opens a confirmation input, disabled until the phrase is typed', async () => {
    render(<DangerZone />);

    await openConfirm();

    expect(screen.getByLabelText(/type.*delete everything/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete all my data$/i })).toBeDisabled();
  });

  it('stays disabled on a partial phrase', async () => {
    render(<DangerZone />);
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete');

    expect(screen.getByRole('button', { name: /^delete all my data$/i })).toBeDisabled();
    expect(deleteAllDataAction).not.toHaveBeenCalled();
  });
});

describe('once the confirmation phrase is typed', () => {
  it('enables the destructive button, case-insensitively', async () => {
    render(<DangerZone />);
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'DELETE EVERYTHING');

    expect(screen.getByRole('button', { name: /^delete all my data$/i })).toBeEnabled();
  });

  it('fires deleteAllDataAction', async () => {
    render(<DangerZone />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete everything');

    await userEvent.click(screen.getByRole('button', { name: /^delete all my data$/i }));

    expect(deleteAllDataAction).toHaveBeenCalledTimes(1);
  });

  it('re-reads the page once the data is gone', async () => {
    render(<DangerZone />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete everything');

    await userEvent.click(screen.getByRole('button', { name: /^delete all my data$/i }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('while the call is pending', () => {
  it('disables the button and shows a busy label', async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof deleteAllDataAction>>
    ) => void;
    vi.mocked(deleteAllDataAction).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<DangerZone />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete everything');

    await userEvent.click(screen.getByRole('button', { name: /^delete all my data$/i }));

    expect(await screen.findByRole('button', { name: /deleting/i })).toBeDisabled();
    resolve({
      ok: true,
      data: {
        connections: 0,
        transactions: 0,
        laborEntries: 0,
        invoices: 0,
        importBatches: 0,
        projects: 0,
        webhookEvents: 0,
      },
    });
  });
});

describe('when the server refuses', () => {
  it('shows the refusal and does not navigate away', async () => {
    vi.mocked(deleteAllDataAction).mockResolvedValueOnce(refused('Unauthorized'));
    render(<DangerZone />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete everything');

    await userEvent.click(screen.getByRole('button', { name: /^delete all my data$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('when the call itself never comes back', () => {
  it('says something went wrong and re-enables the confirmed button', async () => {
    vi.mocked(deleteAllDataAction).mockRejectedValueOnce(new Error('502'));
    render(<DangerZone />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete everything');

    await userEvent.click(screen.getByRole('button', { name: /^delete all my data$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete all my data$/i })).toBeEnabled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('502');
  });
});

describe('cancelling', () => {
  it('closes the confirmation and clears what was typed', async () => {
    render(<DangerZone />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete everything');

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText(/type.*delete everything/i)).not.toBeInTheDocument();
    expect(deleteAllDataAction).not.toHaveBeenCalled();

    await openConfirm();
    expect(screen.getByLabelText(/type.*delete everything/i)).toHaveValue('');
  });
});
