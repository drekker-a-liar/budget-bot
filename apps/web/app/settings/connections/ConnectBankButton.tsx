'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Loader2 } from 'lucide-react';
import { usePlaidLink } from 'react-plaid-link';
import {
  SCRIPTED_PUBLIC_TOKEN,
  forgetLinkToken,
  rememberLinkToken,
} from '@/lib/plaidLink';
import {
  createLinkTokenAction,
  exchangePublicTokenAction,
} from '@/src/server/actions/bank';

/**
 * "Connect a bank", which is two flows wearing one label.
 *
 * Against a real deployment it is Plaid's: fetch a short-lived Link token,
 * open Plaid's own UI with it, and hand back the public token Link returns.
 * Behind the `E2E=1` door the scripted bank has no UI - it hands out its
 * public token unconditionally - so the click goes straight to the exchange.
 *
 * The two are separate components rather than one with a branch in it, because
 * `usePlaidLink` loads `link-initialize.js` from Plaid's CDN on mount whatever
 * token it is given. A single component would make a network call to Plaid on
 * every render of this screen during an end-to-end run whose whole point is
 * that it needs no Plaid at all. A hook cannot be called conditionally; a
 * component can be rendered conditionally.
 */

interface ConnectBankButtonProps {
  kind: 'fake' | 'plaid';
}

export function ConnectBankButton({ kind }: ConnectBankButtonProps) {
  return kind === 'plaid' ? <ConnectThroughLink /> : <ConnectTheScriptedBank />;
}

/** What both flows do with a public token once they have one. */
function useExchange() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exchange = useCallback(
    async (publicToken: string) => {
      setBusy(true);
      const result = await exchangePublicTokenAction({ publicToken });
      setBusy(false);
      // Whatever happened next, Link is finished with this token and the
      // return page has no business resuming it.
      forgetLinkToken();

      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The action revalidated the tree; this is what asks for it. The new
      // connection is a server render away, not a piece of local state.
      router.refresh();
    },
    [router]
  );

  return { exchange, busy, error, setBusy, setError };
}

function ConnectButton({
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
      <button onClick={onClick} disabled={busy} className="btn-primary">
        {busy ? <Loader2 size={14} /> : <Link2 size={14} />}
        <span>{busy ? 'Connecting…' : 'Connect a bank'}</span>
      </button>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--severity-critical)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ConnectThroughLink() {
  const { exchange, busy, error, setBusy, setError } = useExchange();
  const [token, setToken] = useState<string | null>(null);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken) => {
      // Link can complete without one - a flow the user abandoned at the last
      // step - and exchanging nothing is a call that can only fail.
      if (publicToken) void exchange(publicToken);
      setToken(null);
    },
  });

  // Link is built from the token, so it cannot be opened in the tick the token
  // arrives: the hook has to re-initialise with it first. This is that wait,
  // and it is why `open` is not simply called at the end of `connect`.
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  const connect = async () => {
    setError(null);
    setBusy(true);
    const result = await createLinkTokenAction();
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Stashed before Link opens: an OAuth bank leaves this page entirely and
    // comes back to `/plaid/oauth-return`, where this component's state is
    // gone and only `sessionStorage` survives.
    rememberLinkToken(result.data.linkToken);
    setToken(result.data.linkToken);
  };

  return <ConnectButton onClick={() => void connect()} busy={busy} error={error} />;
}

function ConnectTheScriptedBank() {
  const { exchange, busy, error, setError } = useExchange();

  const connect = () => {
    setError(null);
    void exchange(SCRIPTED_PUBLIC_TOKEN);
  };

  return <ConnectButton onClick={connect} busy={busy} error={error} />;
}
