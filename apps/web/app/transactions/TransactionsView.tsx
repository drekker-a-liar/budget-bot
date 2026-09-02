'use client';

import React, { useState } from 'react';
import { formatCents, subtractCents } from '@budget-bot/core';
import { CreditCard } from 'lucide-react';
import { Navigation } from '@/components/Navigation';
import { QuickAddModal, type QuickAddTab } from '@/components/QuickAddModal';
import { TransactionInbox } from '@/components/TransactionInbox';
import { useTransactionInboxActions } from '@/src/client/useTransactionInboxActions';
import type { TransactionsPageData } from '@/src/server/queries/transactions';

/**
 * The interactive half of `/transactions`.
 *
 * The rows arrive as props from the Server Component above; every write goes
 * out as a server action, and the page re-renders on the server with the
 * result. There is no client-side copy of the ledger to keep in step.
 */
export function TransactionsView({
  transactions,
  projects,
  cardProfile,
  unassignedCount,
}: TransactionsPageData) {
  const [quickAdd, setQuickAdd] = useState<{ tab: QuickAddTab } | null>(null);
  const inbox = useTransactionInboxActions();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={unassignedCount}
        cardProfile={cardProfile}
        onOpenQuickAdd={(tab = 'expense') => setQuickAdd({ tab })}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Card Profile &amp; Transaction Ingestion
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)' }}>
              Business Card Reconciliation Center
            </h1>
          </div>

          <button type="button" onClick={() => setQuickAdd({ tab: 'expense' })} className="btn-primary">
            + Record Manual Receipt
          </button>
        </div>

        {inbox.error && (
          <div
            role="alert"
            className="swiss-card"
            style={{
              marginBottom: '1rem',
              color: 'var(--severity-critical)',
              borderColor: 'rgba(239, 68, 68, 0.4)',
              fontSize: '0.82rem',
            }}
          >
            {inbox.error}
          </div>
        )}

        {/* Card Profile Overview Banner */}
        {cardProfile && (
          <div
            className="swiss-card"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
              background: 'linear-gradient(135deg, rgba(17, 23, 38, 0.9), rgba(15, 23, 42, 0.95))',
            }}
          >
            <div>
              <span className="swiss-label">Connected Card</span>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CreditCard size={18} color="var(--accent-cyan)" />
                {cardProfile.issuer} {cardProfile.cardName}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Account ending in <strong className="tnum">•••• {cardProfile.last4}</strong>
              </div>
            </div>

            <div>
              <span className="swiss-label">Current Card Balance</span>
              <div className="tnum swiss-header" style={{ fontSize: '1.75rem', color: 'var(--text-primary)', marginTop: '0.1rem' }}>
                {formatCents(cardProfile.currentBalanceCents)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Credit Limit: {formatCents(cardProfile.creditLimitCents, { showCents: false })}
              </div>
            </div>

            <div>
              <span className="swiss-label">Available Credit</span>
              <div className="tnum swiss-header" style={{ fontSize: '1.75rem', color: 'var(--severity-healthy)', marginTop: '0.1rem' }}>
                {formatCents(
                  subtractCents(cardProfile.creditLimitCents, cardProfile.currentBalanceCents)
                )}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Revolving working buffer
              </div>
            </div>

            <div>
              <span className="swiss-label">Auto-Categorization</span>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '0.3rem' }}>
                Rule Engine Active
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Auto-tags Home Depot, Lowe&apos;s, Fastenal, Fuel
              </div>
            </div>
          </div>
        )}

        <TransactionInbox
          transactions={transactions}
          projects={projects}
          onAssignProject={inbox.onAssignProject}
          onUpdateCategory={inbox.onUpdateCategory}
          onImportCsv={inbox.onImportCsv}
          onDeleteTransaction={inbox.onDeleteTransaction}
        />
      </div>

      {quickAdd !== null && (
        <QuickAddModal
          initialTab={quickAdd.tab}
          projects={projects}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  );
}
