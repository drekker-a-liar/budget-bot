'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { disconnectConnectionAction } from '@/src/server/actions/bank';

/**
 * Removing a linked bank (spec §6).
 *
 * Destructive, and there is no undo on this screen once it runs - so the
 * button that actually disconnects starts disabled and stays that way until
 * the owner types the confirmation word into an input that only appears once
 * they have asked to. The match is case-insensitive: the point of the gate is
 * to make someone stop and mean it, not to fail a warning typed in caps lock.
 *
 * What is *not* at stake is data. `deleteConnection` cascades away the
 * accounts behind this connection, but every charge already filed through it
 * stays in the ledger - it only loses the link back to a bank account that no
 * longer exists (spec §6). This component says none of that; the screen
 * above it does not need reminding every time it renders a button.
 */

const CONFIRM_WORD = 'disconnect';

/** Something went wrong that this component cannot describe. */
const UNREACHABLE = 'Something went wrong connecting to the server. Try again.';

interface DisconnectButtonProps {
  connectionId: string;
}

export function DisconnectButton({ connectionId }: DisconnectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  const cancel = () => {
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const disconnect = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await disconnectConnectionAction({ connectionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The action revalidated the tree; this is what asks for it.
      router.refresh();
    } catch {
      // An action can fail as an exception rather than as a value - the
      // deployment is down, the request never arrives - and this `await` is
      // what receives it. Without this the rejection is unhandled and the
      // `finally` below never runs, which is a button that says
      // "Disconnecting…" for the rest of the session.
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary"
        style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
      >
        <Trash2 size={13} />
        <span>Disconnect</span>
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <label
          htmlFor={`disconnect-confirm-${connectionId}`}
          style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}
        >
          Type “disconnect” to confirm
        </label>
        <input
          id={`disconnect-confirm-${connectionId}`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={busy}
          className="form-input"
          style={{ width: '7rem', padding: '0.35rem 0.5rem', fontSize: '0.78rem' }}
        />
        <button
          onClick={() => void disconnect()}
          disabled={!confirmed || busy}
          className="btn-secondary"
          style={{
            padding: '0.4rem 0.75rem',
            fontSize: '0.78rem',
            color: confirmed ? 'var(--severity-critical)' : undefined,
            borderColor: confirmed ? 'var(--severity-critical)' : undefined,
          }}
        >
          {busy ? <Loader2 size={13} /> : <Trash2 size={13} />}
          <span>{busy ? 'Disconnecting…' : 'Disconnect'}</span>
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="btn-secondary"
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--severity-critical)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
