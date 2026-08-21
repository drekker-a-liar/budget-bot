'use client';

import React, { useState, useEffect } from 'react';
import {
  formatCents,
  subtractCents,
  ExpenseTransaction,
  Project,
  CardProfile,
  BusinessFinancialSummary,
  ExpenseCategory,
} from '@budget-bot/core';
import { Navigation } from '@/components/Navigation';
import { TransactionInbox } from '@/components/TransactionInbox';
import { QuickAddModal, NewProjectPayload } from '@/components/QuickAddModal';
import { CreditCard, Zap, Shield, Sparkles } from 'lucide-react';

export default function TransactionsPage() {
  const [data, setData] = useState<{
    summary: BusinessFinancialSummary | null;
    projects: Project[];
    transactions: ExpenseTransaction[];
    cardProfile: CardProfile | null;
  }>({
    summary: null,
    projects: [],
    transactions: [],
    cardProfile: null,
  });

  const [loading, setLoading] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<'project' | 'expense' | 'labor' | 'invoice'>('expense');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load card transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAssignProject = async (transactionId: string, projectId: string) => {
    try {
      await fetch('/api/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: transactionId,
          projectId: projectId || null,
          status: projectId ? 'matched' : 'unassigned',
        }),
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to assign project:', err);
    }
  };

  const handleUpdateCategory = async (transactionId: string, category: ExpenseCategory) => {
    try {
      await fetch('/api/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: transactionId, category }),
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to update category:', err);
    }
  };


  const handleImportCsv = async (file: File) => {
    try {
      const form = new FormData();
      form.set('file', file);
      await fetch('/api/import/csv', { method: 'POST', body: form });
      await fetchData();
    } catch (err) {
      console.error('Failed to import CSV:', err);
    }
  };

  const handleDeleteTransaction = async (transactionId: string) => {
    try {
      await fetch(`/api/transactions?id=${transactionId}`, { method: 'DELETE' });
      await fetchData();
    } catch (err) {
      console.error('Failed to delete transaction:', err);
    }
  };

  const handleCreateExpense = async (exp: any) => {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exp),
    });
    await fetchData();
  };

  const handleCreateProject = async (proj: NewProjectPayload) => {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proj),
    });
    await fetchData();
  };

  const handleCreateLabor = async (lab: any) => {
    await fetch('/api/labor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lab),
    });
    await fetchData();
  };

  const handleCreateInvoice = async (inv: any) => {
    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inv),
    });
    await fetchData();
  };

  const openQuickAdd = (tab: 'project' | 'expense' | 'labor' | 'invoice' = 'expense') => {
    setQuickAddTab(tab);
    setQuickAddOpen(true);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={data.summary?.unassignedTransactionsCount || 0}
        cardProfile={data.cardProfile}
        onOpenQuickAdd={openQuickAdd}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Card Profile & Transaction Ingestion
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Business Card Reconciliation Center
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button onClick={() => openQuickAdd('expense')} className="btn-primary">
              + Record Manual Receipt
            </button>
          </div>
        </div>

        {/* Card Profile Overview Banner */}
        {data.cardProfile && (
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
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CreditCard size={18} color="var(--accent-cyan)" />
                {data.cardProfile.issuer} {data.cardProfile.cardName}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Account ending in <strong className="tnum">•••• {data.cardProfile.last4}</strong>
              </div>
            </div>

            <div>
              <span className="swiss-label">Current Card Balance</span>
              <div className="tnum swiss-header" style={{ fontSize: '1.75rem', color: '#f8fafc', marginTop: '0.1rem' }}>
                {formatCents(data.cardProfile.currentBalanceCents)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Credit Limit: {formatCents(data.cardProfile.creditLimitCents, { showCents: false })}
              </div>
            </div>

            <div>
              <span className="swiss-label">Available Credit</span>
              <div className="tnum swiss-header" style={{ fontSize: '1.75rem', color: 'var(--severity-healthy)', marginTop: '0.1rem' }}>
                {formatCents(
                  subtractCents(
                    data.cardProfile.creditLimitCents,
                    data.cardProfile.currentBalanceCents
                  )
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

        {/* Transaction Inbox Component */}
        <TransactionInbox
          transactions={data.transactions}
          projects={data.projects}
          onAssignProject={handleAssignProject}
          onUpdateCategory={handleUpdateCategory}
          onImportCsv={handleImportCsv}
          onDeleteTransaction={handleDeleteTransaction}
        />
      </div>

      <QuickAddModal
        initialTab={quickAddTab}
        projects={data.projects}
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreateProject={handleCreateProject}
        onCreateExpense={handleCreateExpense}
        onCreateLabor={handleCreateLabor}
        onCreateInvoice={handleCreateInvoice}
      />
    </div>
  );
}
