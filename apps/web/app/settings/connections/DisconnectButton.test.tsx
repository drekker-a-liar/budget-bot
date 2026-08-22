// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockNextNavigation, refused, router } from '@/test/helpers/islands';

/**
 * "Disconnect", on every connection (spec §6).
 *
 * Destructive and not reversible from this screen - everything the card
 * inbox has drawn from this connection stops arriving, though nothing
 * already filed is lost. So the destructive button starts disabled and stays
 * that way until the owner types the confirmation word, matched
 * case-insensitively (a shouted "DISCONNECT" should not fail a warning meant
 * to slow a person down, not test their keyboard).
 */

vi.mock('next/navigation', () => mockNextNavigation());

vi.mock('@/src/server/actions/bank', () => ({
  disconnectConnectionAction: vi.fn(async () => ({ ok: true as const, data: { removed: true } })),
}));

const { disconnectConnectionAction } = await import('@/src/server/actions/bank');
const { DisconnectButton } = await import('./DisconnectButton');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const openConfirm = () => userEvent.click(screen.getByRole('button', { name: /disconnect/i }));

describe('before typing the confirmation word', () => {
  it('shows a disabled destructive button and no confirmation input', () => {
    render(<DisconnectButton connectionId="conn-1" />);

    expect(screen.queryByLabelText(/type.*disconnect/i)).not.toBeInTheDocument();
  });

  it('opens a confirmation input, disabled until the word is typed', async () => {
    render(<DisconnectButton connectionId="conn-1" />);

    await openConfirm();

    expect(screen.getByLabelText(/type.*disconnect/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeDisabled();
  });

  it('stays disabled on the wrong word', async () => {
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconect');

    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeDisabled();
    expect(disconnectConnectionAction).not.toHaveBeenCalled();
  });
});

describe('once the confirmation word is typed', () => {
  it('enables the destructive button, case-insensitively', async () => {
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'DISCONNECT');

    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeEnabled();
  });

  it('fires the action with this connection’s id', async () => {
    render(<DisconnectButton connectionId="conn-7" />);
    await openConfirm();

    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');
    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    expect(disconnectConnectionAction).toHaveBeenCalledWith({ connectionId: 'conn-7' });
  });

  it('re-reads the page once the connection is gone', async () => {
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('while the call is pending', () => {
  it('disables the button and shows a busy label', async () => {
    let resolve!: (value: { ok: true; data: { removed: boolean } }) => void;
    vi.mocked(disconnectConnectionAction).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    expect(await screen.findByRole('button', { name: /disconnecting/i })).toBeDisabled();
    resolve({ ok: true, data: { removed: true } });
  });
});

describe('when the server refuses', () => {
  it('shows the refusal where the reader is looking, and does not navigate away', async () => {
    vi.mocked(disconnectConnectionAction).mockResolvedValueOnce(refused('Connection not found'));
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection not found');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('when the call itself never comes back', () => {
  it('says something went wrong and re-enables the confirmed button', async () => {
    vi.mocked(disconnectConnectionAction).mockRejectedValueOnce(new Error('502'));
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeEnabled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('502');
  });
});

describe('cancelling', () => {
  it('closes the confirmation and clears what was typed', async () => {
    render(<DisconnectButton connectionId="conn-1" />);
    await openConfirm();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText(/type.*disconnect/i)).not.toBeInTheDocument();
    expect(disconnectConnectionAction).not.toHaveBeenCalled();

    await openConfirm();
    expect(screen.getByLabelText(/type.*disconnect/i)).toHaveValue('');
  });
});
