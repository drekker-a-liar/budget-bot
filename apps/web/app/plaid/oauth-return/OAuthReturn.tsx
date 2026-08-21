'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { forgetLinkToken, storedLinkToken } from '@/lib/plaidLink';
import { usePlaidLink } from 'react-plaid-link';
import { exchangePublicTokenAction } from '@/src/server/actions/bank';

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
 * Everything is read in an effect rather than during render because both
 * `sessionStorage` and `window.location` exist only in the browser, and this
 * component is prerendered on the server first.
 */

/** What the browser brought back with it, once the browser has been asked. */
interface ResumedFlow {
  token: string;
  receivedRedirectUri: string;
}

export function OAuthReturn() {
  const router = useRouter();
  const [resumed, setResumed] = useState<ResumedFlow | null>(null);
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = storedLinkToken();
    if (token) setResumed({ token, receivedRedirectUri: window.location.href });
    setAsked(true);
  }, []);

  const finish = useCallback(
    async (publicToken: string) => {
      const result = await exchangePublicTokenAction({ publicToken });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace('/settings/connections');
    },
    [router]
  );

  const { open, ready } = usePlaidLink({
    token: resumed?.token ?? null,
    receivedRedirectUri: resumed?.receivedRedirectUri,
    onSuccess: (publicToken) => {
      // Spent either way: the flow has left Link, and this page must not be
      // able to resume it a second time.
      forgetLinkToken();
      setResumed(null);
      if (publicToken) void finish(publicToken);
    },
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
          <h1 className="swiss-header" style={{ fontSize: '1.2rem', color: '#f8fafc' }}>
            Finishing the connection with your bank…
          </h1>
        ) : (
          <>
            <h1 className="swiss-header" style={{ fontSize: '1.2rem', color: '#f8fafc' }}>
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
