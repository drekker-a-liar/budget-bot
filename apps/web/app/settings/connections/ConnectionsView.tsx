'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Landmark, RefreshCw } from 'lucide-react';
import { formatCents, type Cents } from '@budget-bot/core';
import { Navigation } from '@/components/Navigation';
import { syncNowAction } from '@/src/server/actions/bank';
import type { RunSyncResult } from '@/src/server/bank/sync';
import type { ConnectionView } from '@/src/server/queries/connections';
import { ConnectBankButton } from './ConnectBankButton';

/**
 * The interactive half of `/settings/connections`.
 *
 * The page above reads the connections and their accounts on the server and
 * hands them here as plain props; what stays on the client is the two things
 * that are not a render - connecting a bank, and pulling from one.
 *
 * The screen is written around a connection that is *not* healthy. A token
 * that has expired, a bank that is rate limiting, a page that named an account
 * this connection does not have: all of them leave a code on the row and none
 * of them stop the rest of the app working, so the only place anybody can find
 * out is here. Hence a status on every connection rather than only on the
 * broken ones, the recorded code shown as it was recorded - it is what support
 * asks for - and "last synced" next to it, because "connected" and "has not
 * fetched anything since April" are both true at once and only one of them is
 * reassuring.
 */

export interface ConnectionsViewProps {
  /** False when this deployment has no Plaid credentials at all (spec §7). */
  configured: boolean;
  kind: 'fake' | 'plaid' | null;
  connections: ConnectionView[];
  unassignedCount: number;
}

/** What the outcome of the last **Sync now** was, and which connection's. */
interface Outcome {
  connectionId: string;
  ok: boolean;
  message: string;
}

function cents(value: number): Cents {
  return value as Cents;
}

/**
 * A recorded timestamp, in UTC and said so.
 *
 * This component is prerendered on the server and hydrated in a browser that
 * is usually in a different timezone, and a locale-formatted local time is the
 * classic hydration mismatch. Naming the zone is the honest way out: a wrong
 * time with no zone on it is worse than a right one in the wrong zone.
 */
function formatSyncedAt(iso: string): string {
  return `${new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}

/** The status of a connection, as a chip a reader can act on. */
function statusOf(connection: ConnectionView): { label: string; className: string } {
  if (connection.status === 'reauth_required') {
    return { label: 'Your bank needs you to sign in again', className: 'badge-critical' };
  }
  if (connection.status === 'error') {
    return {
      label: `Last sync failed: ${connection.lastErrorCode ?? 'unknown'}`,
      className: 'badge-caution',
    };
  }
  return { label: 'Connected', className: 'badge-healthy' };
}

function describeSync(result: RunSyncResult): string {
  if ('skipped' in result) {
    return 'A sync is already running on this connection. Nothing to do.';
  }
  const more = result.hasMore ? ' There is more to fetch — sync again.' : '';
  return `Synced: ${result.added} added, ${result.modified} modified, ${result.removed} removed.${more}`;
}

export function ConnectionsView({
  configured,
  kind,
  connections,
  unassignedCount,
}: ConnectionsViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const sync = (connectionId: string) => {
    setOutcome(null);
    setSyncing(connectionId);
    startTransition(async () => {
      const result = await syncNowAction({ connectionId });
      setSyncing(null);
      setOutcome({
        connectionId,
        ok: result.ok,
        message: result.ok ? describeSync(result.data) : result.error,
      });
      // Only on success: a refused sync has nothing new to draw, and
      // re-rendering the page under a message is a good way to lose it.
      if (result.ok) router.refresh();
    });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation unassignedCount={unassignedCount} />

      <div
        style={{
          maxWidth: '1360px',
          margin: '0 auto',
          width: '100%',
          padding: '1.5rem 1.5rem 3rem 1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: '1.5rem',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Bank Connections
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Where the Card Inbox Comes From
            </h1>
          </div>

          {configured && kind && <ConnectBankButton kind={kind} />}
        </div>

        {!configured && (
          <div className="swiss-card" style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <AlertTriangle size={16} color="var(--severity-caution)" />
              <div>
                <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: '0.25rem' }}>
                  Plaid is not configured on this deployment.
                </div>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Set <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code> and{' '}
                  <code>PLAID_ENV</code> to connect a bank. Receipts can still be entered by hand
                  and imported from CSV in the meantime.
                </p>
              </div>
            </div>
          </div>
        )}

        {connections.length === 0 ? (
          <div className="swiss-card">
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <Landmark size={16} color="var(--accent-cyan)" />
              <div>
                <div style={{ fontWeight: 700, color: '#f8fafc' }}>No banks connected yet.</div>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Connecting one fills the card inbox on its own, so charges stop having to be
                  typed in.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {connections.map((connection) => {
              const status = statusOf(connection);
              const message = outcome?.connectionId === connection.id ? outcome : null;

              return (
                <div key={connection.id} className="swiss-card">
                  <div className="swiss-card-header">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Landmark size={15} color="var(--accent-cyan)" />
                        <span style={{ fontWeight: 800, color: '#f8fafc' }}>
                          {connection.institutionName ?? 'Connected bank'}
                        </span>
                        <span className={status.className}>{status.label}</span>
                      </div>
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.25rem',
                        }}
                      >
                        {connection.lastSyncedAt
                          ? `Last synced ${formatSyncedAt(connection.lastSyncedAt)}`
                          : 'Never synced'}
                      </div>
                    </div>

                    <button
                      onClick={() => sync(connection.id)}
                      disabled={pending}
                      className="btn-secondary"
                      style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
                    >
                      <RefreshCw size={13} />
                      <span>{syncing === connection.id ? 'Syncing…' : 'Sync now'}</span>
                    </button>
                  </div>

                  {message && (
                    <p
                      role={message.ok ? 'status' : 'alert'}
                      style={{
                        margin: '0.5rem 0 0',
                        fontSize: '0.8rem',
                        color: message.ok ? 'var(--severity-healthy)' : 'var(--severity-critical)',
                      }}
                    >
                      {message.message}
                    </p>
                  )}

                  <table className="swiss-table" style={{ marginTop: '0.9rem' }}>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                        <th style={{ textAlign: 'right' }}>Limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connection.accounts.map((account) => (
                        <tr key={account.id}>
                          <td>
                            {account.name ?? account.officialName ?? 'Account'}
                            {account.mask && (
                              <span style={{ color: 'var(--text-muted)' }}> ••• {account.mask}</span>
                            )}
                          </td>
                          <td style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                            {account.subtype ?? account.type ?? '—'}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {account.currentBalanceCents === null
                              ? '—'
                              : formatCents(cents(account.currentBalanceCents))}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {account.creditLimitCents === null
                              ? '—'
                              : formatCents(cents(account.creditLimitCents))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
