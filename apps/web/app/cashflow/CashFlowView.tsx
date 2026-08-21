'use client';

import React, { useState, useTransition } from 'react';
import { addCents, formatCents, type ExpenseCategory } from '@budget-bot/core';
import { FileText } from 'lucide-react';
import { CashFlowWaterfall } from '@/components/CashFlowWaterfall';
import { Navigation } from '@/components/Navigation';
import { QuickAddModal, type QuickAddTab } from '@/components/QuickAddModal';
import { availableCreditOf } from '@/src/client/card';
import { markInvoicePaidAction } from '@/src/server/actions/invoices';
import type { CashflowPageData } from '@/src/server/queries/cashflow';

/**
 * The interactive half of `/cashflow`.
 *
 * The waterfall is now computed on the server from real rows; it used to draw
 * four weeks of literals that had nothing to do with the books underneath.
 */

const CATEGORIES: Array<{ name: string; key: ExpenseCategory; color: string }> = [
  { name: 'Materials & Lumber', key: 'materials', color: 'var(--accent-cyan)' },
  { name: 'Tools & Equipment', key: 'tools', color: 'var(--severity-caution)' },
  { name: 'Fuel & Transit', key: 'mileage_fuel', color: 'var(--accent-indigo)' },
  { name: 'Permits & Dump Fees', key: 'permits_fees', color: 'var(--text-muted)' },
  { name: 'Overhead & Admin', key: 'overhead', color: '#ec4899' },
];

export function CashFlowView({
  summary,
  weeks,
  transactions,
  invoices,
  projects,
  cardProfile,
  unassignedCount,
}: CashflowPageData) {
  const [quickAdd, setQuickAdd] = useState<{ tab: QuickAddTab } | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const markPaid = (invoiceId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await markInvoicePaidAction({ id: invoiceId });
      if (!result.ok) setError(result.error);
    });
  };

  const totalSpendCents = addCents(...transactions.map((t) => t.amountCents));
  const spendDenominator = totalSpendCents || 1;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={unassignedCount}
        cardProfile={cardProfile}
        onOpenQuickAdd={(tab = 'invoice') => setQuickAdd({ tab })}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Liquidity &amp; Runway Intelligence
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Cash Flow Waterfall &amp; Burn Runway
            </h1>
          </div>

          <button onClick={() => setQuickAdd({ tab: 'invoice' })} className="btn-primary">
            <FileText size={14} />
            <span>+ Create Invoice</span>
          </button>
        </div>

        {error && (
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
            {error}
          </div>
        )}

        <div style={{ marginBottom: '1.75rem' }}>
          <CashFlowWaterfall
            weeks={weeks}
            availableCreditCents={availableCreditOf(cardProfile)}
            creditLimitCents={cardProfile?.creditLimitCents ?? null}
          />
        </div>

        {/* Grid: Category Spend Breakdown & Receivables Aging Ledger */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem' }}>
          <div className="swiss-card">
            <div className="swiss-card-header">
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  YTD Spend by Expense Category
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Total Disbursed:{' '}
                  <strong className="tnum" style={{ color: '#f8fafc' }}>
                    {formatCents(totalSpendCents)}
                  </strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem' }}>
              {CATEGORIES.map((cat) => {
                const amountCents = addCents(
                  ...transactions.filter((t) => t.category === cat.key).map((t) => t.amountCents)
                );
                const pct = Math.round((amountCents / spendDenominator) * 1000) / 10;

                return (
                  <div key={cat.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: '#f8fafc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: cat.color }} />
                        {cat.name}
                      </span>
                      <span className="tnum" style={{ color: 'var(--text-secondary)' }}>
                        <strong style={{ color: '#f8fafc' }}>{formatCents(amountCents)}</strong> ({pct}%)
                      </span>
                    </div>

                    <div style={{ height: '6px', background: 'var(--bg-input)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.max(0, pct)}%`,
                          height: '100%',
                          backgroundColor: cat.color,
                          borderRadius: '3px',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Accounts Receivable Aging */}
          <div className="swiss-card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  Receivables &amp; Invoice Aging
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Uncollected Cash:{' '}
                  <strong className="tnum" style={{ color: 'var(--severity-caution)' }}>
                    {formatCents(summary.outstandingReceivablesCents)}
                  </strong>
                </div>
              </div>
            </div>

            {invoices.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No invoices recorded.
              </div>
            ) : (
              <table className="swiss-table">
                <thead>
                  <tr>
                    <th>Invoice / Project</th>
                    <th>Due Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Status</th>
                    <th style={{ width: '90px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const project = projects.find((p) => p.id === inv.projectId);
                    return (
                      <tr key={inv.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.825rem' }}>
                            {inv.invoiceNumber}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {project ? project.name : 'Job'}
                          </div>
                        </td>
                        <td className="tnum" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {inv.dueDate}
                        </td>
                        <td className="tnum" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>
                          {formatCents(inv.amountCents)}
                        </td>
                        <td>
                          {inv.status === 'paid' ? (
                            <span className="badge-healthy">PAID</span>
                          ) : inv.status === 'overdue' ? (
                            <span className="badge-critical">OVERDUE</span>
                          ) : (
                            <span className="badge-caution">PENDING</span>
                          )}
                        </td>
                        <td>
                          {inv.status !== 'paid' && (
                            <button
                              onClick={() => markPaid(inv.id)}
                              disabled={pending}
                              className="btn-success"
                              style={{ padding: '0.2rem 0.45rem', fontSize: '0.68rem' }}
                            >
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <QuickAddModal
        initialTab={quickAdd?.tab ?? 'invoice'}
        projects={projects}
        isOpen={quickAdd !== null}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  );
}
