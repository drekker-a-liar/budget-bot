// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmGate } from './ConfirmGate';

/**
 * The type-to-confirm gate behind every destructive control in this app
 * (spec §6): disconnect and delete-all both start disabled and stay that way
 * until the word is typed, matched case-insensitively.
 *
 * What is under test here is the gate itself - the open/typed UI state and
 * when the confirm button may be pressed. `busy` and `error` are the caller's
 * own state, handed in as props, because *why* a call is pending or refused
 * differs by what it is confirming; `DisconnectButton.test.tsx` and
 * `DangerZone.test.tsx` cover that half for their own actions.
 */

afterEach(cleanup);

function renderGate(overrides: Partial<React.ComponentProps<typeof ConfirmGate>> = {}) {
  const onConfirm = vi.fn();
  render(
    <ConfirmGate
      phrase="disconnect"
      idSuffix="conn-1"
      idleLabel="Disconnect"
      confirmLabel="Disconnect"
      busyLabel="Disconnecting…"
      busy={false}
      error={null}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onConfirm };
}

const openGate = () => userEvent.click(screen.getByRole('button', { name: /disconnect/i }));

describe('before typing the confirmation word', () => {
  it('shows a single idle button and no confirmation input', () => {
    renderGate();

    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/type.*disconnect/i)).not.toBeInTheDocument();
  });

  it('opens a confirmation input, disabled until the word is typed', async () => {
    renderGate();

    await openGate();

    expect(screen.getByLabelText(/type.*disconnect/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeDisabled();
  });

  it('stays disabled on the wrong word', async () => {
    const { onConfirm } = renderGate();
    await openGate();

    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconect');

    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('once the confirmation word is typed', () => {
  it('enables the confirm button, case-insensitively', async () => {
    renderGate();
    await openGate();

    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'DISCONNECT');

    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeEnabled();
  });

  it('calls onConfirm when the confirm button is pressed', async () => {
    const { onConfirm } = renderGate();
    await openGate();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('a phrase of more than one word', () => {
  it('is matched as a whole, and shown in the label', async () => {
    const { onConfirm } = renderGate({
      phrase: 'delete everything',
      idSuffix: 'danger',
      idleLabel: 'Delete all my data',
      confirmLabel: 'Delete all my data',
      busyLabel: 'Deleting…',
    });
    await userEvent.click(screen.getByRole('button', { name: /delete all my data/i }));

    expect(screen.getByLabelText(/type.*delete everything/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), 'delete');
    expect(screen.getByRole('button', { name: /^delete all my data$/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/type.*delete everything/i), ' everything');
    expect(screen.getByRole('button', { name: /^delete all my data$/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /^delete all my data$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('while busy', () => {
  it('shows the busy label and disables the confirm button and the input', async () => {
    renderGate({ busy: true });
    await openGate();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    expect(screen.getByRole('button', { name: /disconnecting/i })).toBeDisabled();
    expect(screen.getByLabelText(/type.*disconnect/i)).toBeDisabled();
  });
});

describe('an error from the caller', () => {
  it('is shown as an alert', async () => {
    renderGate({ error: 'Connection not found' });
    await openGate();

    expect(screen.getByRole('alert')).toHaveTextContent('Connection not found');
  });

  it('shows nothing when there is none', async () => {
    renderGate();
    await openGate();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('cancelling', () => {
  it('closes the confirmation and clears what was typed', async () => {
    renderGate();
    await openGate();
    await userEvent.type(screen.getByLabelText(/type.*disconnect/i), 'disconnect');

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText(/type.*disconnect/i)).not.toBeInTheDocument();

    await openGate();
    expect(screen.getByLabelText(/type.*disconnect/i)).toHaveValue('');
  });

  it('calls onCancel, so the caller can clear its own error', async () => {
    const onCancel = vi.fn();
    renderGate({ onCancel });
    await openGate();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
