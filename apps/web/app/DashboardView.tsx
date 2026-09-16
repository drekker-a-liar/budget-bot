'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CashFlowWaterfall } from '@/components/CashFlowWaterfall';
import { DashboardMetrics } from '@/components/DashboardMetrics';
import { JobCostCard } from '@/components/JobCostCard';
import { Navigation } from '@/components/Navigation';
import { QuickAddModal, type QuickAddTab } from '@/components/QuickAddModal';
import { TransactionInbox } from '@/components/TransactionInbox';
import { useTransactionInboxActions } from '@/src/client/useTransactionInboxActions';
import { availableCreditOf } from '@/src/client/card';
import type { DashboardData } from '@/src/server/queries/dashboard';

/** How many jobs the overview shows before sending the reader to /projects. */
const ACTIVE_JOBS_SHOWN = 4;

/**
 * The interactive half of the overview.
 *
 * Everything drawn here was read on the server. What stays on the client is
 * the modal, the inbox's writes, and the one piece of genuine browser state:
 * scrolling to the inbox when the unassigned card is clicked.
 */
export function DashboardView({
  summary,
  projects,
  projectKPIs,
  transactions,
  weeks,
  cardProfile,
  unassignedCount,
}: DashboardData) {
  const [quickAdd, setQuickAdd] = useState<{ tab: QuickAddTab; projectId?: string } | null>(null);
  const inboxRef = useRef<HTMLDivElement>(null);
  const inbox = useTransactionInboxActions();

  const activeProjects = projects
    .filter((p) => p.status === 'in_progress' || p.status === 'completed')
    .slice(0, ACTIVE_JOBS_SHOWN);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={unassignedCount}
        cardProfile={cardProfile}
        onOpenQuickAdd={(tab = 'expense') => setQuickAdd({ tab })}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Executive Headline */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Financial Operating Ledger
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)' }}>
              Contractor Profit &amp; Expense Command
            </h1>
          </div>
        </div>

        <DashboardMetrics
          summary={summary}
          onOpenInbox={() => inboxRef.current?.scrollIntoView({ behavior: 'smooth' })}
        />

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

        {/* Two-Column Grid: Active Projects & Card Inbox */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem', marginBottom: '1.75rem' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  Active Job Cost Centers
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Materials vs Labor Breakdown &amp; Margin Health
                </div>
              </div>

              <Link href="/projects" style={LINK_STYLE}>
                View All ({projects.length}) <ArrowRight size={13} />
              </Link>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {activeProjects.map((project) => {
                const kpi = projectKPIs.find((k) => k.projectId === project.id);
                if (!kpi) return null;
                return (
                  <JobCostCard
                    key={project.id}
                    project={project}
                    kpi={kpi}
                    onOpenQuickLabor={(id) => setQuickAdd({ tab: 'labor', projectId: id })}
                    onOpenQuickExpense={(id) => setQuickAdd({ tab: 'expense', projectId: id })}
                  />
                );
              })}
            </div>
          </div>

          <div ref={inboxRef}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  Card Ingestion &amp; Expense Triage
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  1-Click match hardware store receipts to client contracts
                </div>
              </div>

              <Link href="/transactions" style={LINK_STYLE}>
                Full Ledger <ArrowRight size={13} />
              </Link>
            </div>

            <TransactionInbox
              transactions={transactions}
              projects={projects}
              onAssignProject={inbox.onAssignProject}
              onUpdateCategory={inbox.onUpdateCategory}
              onImportCsv={inbox.onImportCsv}
              onDeleteTransaction={inbox.onDeleteTransaction}
            />
          </div>
        </div>

        {/* Bottom Section: Cash Flow Waterfall */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                Day-to-Day &amp; Weekly Cash Flow
              </h2>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Cash inflows from deposits vs card outflows for materials &amp; tools
              </div>
            </div>

            <Link href="/cashflow" style={LINK_STYLE}>
              Liquidity &amp; Runway Forecast <ArrowRight size={13} />
            </Link>
          </div>

          <CashFlowWaterfall
            weeks={weeks}
            availableCreditCents={availableCreditOf(cardProfile)}
            creditLimitCents={cardProfile?.creditLimitCents ?? null}
          />
        </div>
      </div>

      {quickAdd !== null && (
        <QuickAddModal
          initialTab={quickAdd.tab}
          initialProjectId={quickAdd.projectId}
          projects={projects}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  );
}

const LINK_STYLE: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--accent-cyan)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
};
