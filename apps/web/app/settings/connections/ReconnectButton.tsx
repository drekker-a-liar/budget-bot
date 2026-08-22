'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { usePlaidLink } from 'react-plaid-link';
import {
  createReauthLinkTokenAction,
  markReconnectedAction,
} from '@/src/server/actions/bank';

/**
 * "Reconnect", on a connection that needs re-authentication (spec §5).
 *
 * `ConnectBankButton`'s shape, aimed at the other pair of actions: Link's
 * *update mode* re-authorizes an existing item instead of creating a new one,
 * and it ends with no public token to exchange, so `onSuccess` calls
 * `markReconnectedAction(connectionId)` directly. Behind the `E2E=1` door the
 * scripted bank has no UI to resume, so the click skips straight to that call
 * - and for the same reason `ConnectBankButton` is split in two, this is:
 * `usePlaidLink` loads Plaid's script on mount whatever token it is given, and
 * a single component would make that call every time this screen renders a
 * broken connection during an end-to-end run that needs no Plaid at all.
 */

interface ReconnectButtonProps {
  kind: 'fake' | 'plaid';
  connectionId: string;
}

export function ReconnectButton({ kind, connectionId }: ReconnectButtonProps) {
  return kind === 'plaid' ? (
    <ReconnectThroughLink connectionId={connectionId} />
  ) : (
    <ReconnectTheScriptedBank connectionId={connectionId} />
  );
}

/** What both flows do once Link (or the door) says this connection is good. */
function useReconnect(connectionId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const result = await markReconnectedAction({ connectionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The action revalidated the tree; this is what asks for it.
      router.refresh();
    } catch {
      // An action can fail as an exception rather than as a value - the
      // deployment is down, the request never arrives - and this `await` is
      // what receives it. Without this, the rejection is unhandled and the
      // `finally` below never runs, which is a button that says
      // "Reconnecting…" for the rest of the session.
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }, [connectionId, router]);

  return { finish, busy, error, setBusy, setError };
}

/** Something went wrong that this component cannot describe. */
const UNREACHABLE = 'Something went wrong connecting to the server. Try again.';

function ReconnectButtonUI({
  onClick,
  busy,
  error,
}: {
  onClick: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
      <button onClick={onClick} disabled={busy} className="btn-primary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
        {busy ? <Loader2 size={13} /> : <RefreshCw size={13} />}
        <span>{busy ? 'Reconnecting…' : 'Reconnect'}</span>
      </button>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--severity-critical)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ReconnectThroughLink({ connectionId }: { connectionId: string }) {
  const { finish, busy, error, setBusy, setError } = useReconnect(connectionId);
  const [token, setToken] = useState<string | null>(null);

  /** The flow is over, however it ended. */
  const done = () => setToken(null);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: () => {
      // Update mode ends with no public token to exchange (spec §5a) - there
      // is nothing here worth checking for, unlike the connect flow.
      done();
      void finish();
    },
    // Closed without finishing. Nothing changed, so there is nothing to do.
    onExit: done,
  });

  // Link is built from the token, so it cannot be opened in the tick the
  // token arrives: the hook has to re-initialise with it first.
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  const reconnect = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await createReauthLinkTokenAction({ connectionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToken(result.data.linkToken);
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  };

  return <ReconnectButtonUI onClick={() => void reconnect()} busy={busy} error={error} />;
}

function ReconnectTheScriptedBank({ connectionId }: { connectionId: string }) {
  const { finish, busy, error, setError } = useReconnect(connectionId);

  const reconnect = () => {
    setError(null);
    void finish();
  };

  return <ReconnectButtonUI onClick={reconnect} busy={busy} error={error} />;
}
