'use client';

import React, { useState, useEffect } from 'react';
import {
  addCents,
  formatCents,
  BusinessFinancialSummary,
  ExpenseTransaction,
  Invoice,
  CardProfile,
  Project,
} from '@budget-bot/core';
import { Navigation } from '@/components/Navigation';
import { CashFlowWaterfall } from '@/components/CashFlowWaterfall';
import { QuickAddModal } from '@/components/QuickAddModal';
import { SeverityBadge } from '@/components/SeverityBadge';
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Calendar,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  FileText
} from 'lucide-react';

export default function CashFlowPage() {
  const [data, setData] = useState<{
    summary: BusinessFinancialSummary | null;
    projects: Project[];
    transactions: ExpenseTransaction[];
    invoices: Invoice[];
    cardProfile: CardProfile | null;
  }>({
    summary: null,
    projects: [],
    transactions: [],
    invoices: [],
    cardProfile: null,
  });

  const [loading, setLoading] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<'project' | 'expense' | 'labor' | 'invoice'>('invoice');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load cash flow data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleMarkInvoicePaid = async (invoiceId: string) => {
    try {
      await fetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: invoiceId,
          status: 'paid',
          paidDate: new Date().toISOString().slice(0, 10),
        }),
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to mark invoice as paid:', err);
    }
  };





  const openQuickAdd = (tab: 'project' | 'expense' | 'labor' | 'invoice' = 'invoice') => {
    setQuickAddTab(tab);
    setQuickAddOpen(true);
  };

  if (loading || !data.summary) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading cash flow projections...</div>
      </div>
    );
  }

  // Category breakdown calculation
  const totalSpendCents = addCents(...data.transactions.map((t) => t.amountCents));
  const spendDenominator = totalSpendCents || 1;
  const categories = [
    { name: 'Materials & Lumber', key: 'materials', color: 'var(--accent-cyan)' },
    { name: 'Tools & Equipment', key: 'tools', color: 'var(--severity-caution)' },
    { name: 'Fuel & Transit', key: 'mileage_fuel', color: 'var(--accent-indigo)' },
    { name: 'Permits & Dump Fees', key: 'permits_fees', color: 'var(--text-muted)' },
    { name: 'Overhead & Admin', key: 'overhead', color: '#ec4899' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={data.summary.unassignedTransactionsCount}
        cardProfile={data.cardProfile}
        onOpenQuickAdd={openQuickAdd}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Liquidity & Runway Intelligence
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Cash Flow Waterfall & Burn Runway
            </h1>
          </div>

          <button onClick={() => openQuickAdd('invoice')} className="btn-primary">
            <FileText size={14} />
            <span>+ Create Invoice</span>
          </button>
        </div>

        {/* Cash Flow Waterfall Module */}
        <div style={{ marginBottom: '1.75rem' }}>
          <CashFlowWaterfall
            transactions={data.transactions}
            invoices={data.invoices}
            cardProfile={data.cardProfile}
          />
        </div>

        {/* Grid: Category Spend Breakdown & Receivables Aging Ledger */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem' }}>
          {/* Spend by Expense Category */}
          <div className="swiss-card">
            <div className="swiss-card-header">
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  YTD Spend by Expense Category
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Total Disbursed: <strong className="tnum" style={{ color: '#f8fafc' }}>{formatCents(totalSpendCents)}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem' }}>
              {categories.map((cat) => {
                const amountCents = addCents(
                  ...data.transactions
                    .filter((t) => t.category === cat.key)
                    .map((t) => t.amountCents)
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
                          width: `${pct}%`,
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
                  Receivables & Invoice Aging
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Uncollected Cash: <strong className="tnum" style={{ color: 'var(--severity-caution)' }}>{formatCents(data.summary.outstandingReceivablesCents)}</strong>
                </div>
              </div>
            </div>

            {data.invoices.length === 0 ? (
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
                  {data.invoices.map((inv) => {
                    const project = data.projects.find((p) => p.id === inv.projectId);
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
                              onClick={() => handleMarkInvoicePaid(inv.id)}
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
        initialTab={quickAddTab}
        projects={data.projects}
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreated={fetchData}
      />
    </div>
  );
}
