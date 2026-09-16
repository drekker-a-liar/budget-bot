'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  forgetLinkToken,
  forgetReauthConnection,
  storedLinkToken,
  storedReauthConnection,
} from '@/lib/plaidLink';
import { usePlaidLink } from 'react-plaid-link';
import { exchangePublicTokenAction, markReconnectedAction } from '@/src/server/actions/bank';

/**
 * Coming back from an OAuth bank.
 *
 * A bank that authenticates on its own site takes the browser away and returns
 * it here, which is a fresh page load: everything the connections page knew is
 * gone. Link can be resumed from two things and only two - the token that
 * started the flow, which was stashed in `sessionStorage` on the way out, and
 * `receivedRedirectUri`, which is the URL the bank came back to and is how
 * Link recognises which flow this is.
 *
 * No stashed token means no flow to finish, and this page says so rather than
 * initialising Link with nothing (spec §9). That is not a nicety: this URL is
 * reachable by anyone who bookmarks it or presses Back, and a page that
 * cheerfully starts a Link session for whoever asks is a page that starts one
 * for a link in an email.
 *
 * The flow being resumed is either a brand-new connection or Link's update
 * mode reconnecting an existing one (spec §5a), and the stashed connection id
 * is what tells the two apart: present, this is a reconnect and update mode's
 * `onSuccess` has no public token worth exchanging, so `markReconnectedAction`
 * runs instead of `exchangePublicTokenAction`.
 *
 * Everything is read in an effect rather than during render because both
 * `sessionStorage` and `window.location` exist only in the browser, and this
 * component is prerendered on the server first.
 */

/** Something went wrong that this page cannot describe. */
const UNREACHABLE = 'Something went wrong connecting to the server. Try again.';

/** What the browser brought back with it, once the browser has been asked. */
interface ResumedFlow {
  token: string;
  receivedRedirectUri: string;
  /** Set only when this is a reconnect resuming, never a brand-new bank. */
  connectionId: string | null;
}

export function OAuthReturn() {
  const router = useRouter();
  const [resumed, setResumed] = useState<ResumedFlow | null>(null);
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = storedLinkToken();
    if (token) {
      setResumed({
        token,
        receivedRedirectUri: window.location.href,
        connectionId: storedReauthConnection(),
      });
    }
    setAsked(true);
  }, []);

  const finishExchange = useCallback(
    async (publicToken: string) => {
      try {
        const result = await exchangePublicTokenAction({ publicToken });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.replace('/settings/connections');
      } catch {
        // A refusal is a value with a message on it; this is the call itself
        // never coming back. Unhandled, it leaves the page saying "Finishing
        // the connection…" with nothing to say it never will.
        setError(UNREACHABLE);
      }
    },
    [router]
  );

  const finishReauth = useCallback(
    async (connectionId: string) => {
      try {
        const result = await markReconnectedAction({ connectionId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.replace('/settings/connections');
      } catch {
        setError(UNREACHABLE);
      }
    },
    [router]
  );

  /** The flow is over, however it ended: the stash is spent either way. */
  const done = () => {
    forgetLinkToken();
    forgetReauthConnection();
    setResumed(null);
  };

  const { open, ready } = usePlaidLink({
    token: resumed?.token ?? null,
    receivedRedirectUri: resumed?.receivedRedirectUri,
    onSuccess: (publicToken) => {
      // Read before `done()` clears it: `resumed` is gone the instant this
      // returns.
      const connectionId = resumed?.connectionId ?? null;
      // Spent either way: the flow has left Link, and this page must not be
      // able to resume it a second time.
      done();
      if (connectionId) {
        void finishReauth(connectionId);
      } else if (publicToken) {
        void finishExchange(publicToken);
      }
    },
    // Closed without finishing - the user backed out at the bank. The token is
    // single-use, so there is nothing here left to resume.
    onExit: done,
  });

  useEffect(() => {
    if (resumed && ready) open();
  }, [resumed, ready, open]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div className="swiss-card" style={{ maxWidth: '32rem', textAlign: 'center' }}>
        <div className="swiss-label" style={{ marginBottom: '0.4rem' }}>
          Plaid
        </div>

        {!asked || resumed ? (
          <h1 className="swiss-header" style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>
            Finishing the connection with your bank…
          </h1>
        ) : (
          <>
            <h1 className="swiss-header" style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>
              There is nothing to finish here.
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.6rem 0 1rem' }}>
              This page completes a bank connection that was started somewhere else, and this
              browser is not in the middle of one.
            </p>
          </>
        )}

        {error && (
          <p
            role="alert"
            style={{ color: 'var(--severity-critical)', fontSize: '0.82rem', margin: '0.6rem 0' }}
          >
            {error}
          </p>
        )}

        <Link href="/settings/connections" className="btn-secondary" style={{ marginTop: '0.5rem' }}>
          Back to Connections
        </Link>
      </div>
    </div>
  );
}
