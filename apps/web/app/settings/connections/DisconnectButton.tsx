'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { ConfirmGate } from '@/components/ConfirmGate';
import { disconnectConnectionAction } from '@/src/server/actions/bank';

/**
 * Removing a linked bank (spec §6).
 *
 * Destructive, and there is no undo on this screen once it runs - so it sits
 * behind `ConfirmGate`, the same type-to-confirm gate `DangerZone` uses for
 * delete-all. This component supplies the phrase and the labels; what it owns
 * on its own is calling the action and reporting how that went.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <ConfirmGate
      phrase={CONFIRM_WORD}
      idSuffix={connectionId}
      idleLabel="Disconnect"
      idleIcon={<Trash2 size={13} />}
      confirmLabel="Disconnect"
      confirmIcon={<Trash2 size={13} />}
      busyLabel="Disconnecting…"
      busy={busy}
      error={error}
      onConfirm={() => void disconnect()}
      onCancel={() => setError(null)}
    />
  );
}
