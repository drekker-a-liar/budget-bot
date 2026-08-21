'use client';

import React, { useEffect, useState } from 'react';
import {
  Project,
  ProjectFinancialKPIs,
  ExpenseTransaction,
  Invoice,
  CardProfile,
  BusinessFinancialSummary,
  ExpenseCategory,
} from '@budget-bot/core';
import { Navigation } from '@/components/Navigation';
import { DashboardMetrics } from '@/components/DashboardMetrics';
import { JobCostCard } from '@/components/JobCostCard';
import { TransactionInbox } from '@/components/TransactionInbox';
import { CashFlowWaterfall } from '@/components/CashFlowWaterfall';
import { QuickAddModal, NewProjectPayload } from '@/components/QuickAddModal';
import { SeverityBadge } from '@/components/SeverityBadge';
import {
  Hammer,
  CreditCard,
  TrendingUp,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  Receipt,
  Clock
} from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  const [data, setData] = useState<{
    summary: BusinessFinancialSummary | null;
    projects: Project[];
    projectKPIs: ProjectFinancialKPIs[];
    transactions: ExpenseTransaction[];
    invoices: Invoice[];
    cardProfile: CardProfile | null;
  }>({
    summary: null,
    projects: [],
    projectKPIs: [],
    transactions: [],
    invoices: [],
    cardProfile: null,
  });

  const [loading, setLoading] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<'project' | 'expense' | 'labor' | 'invoice'>('expense');
  const [quickAddProjectId, setQuickAddProjectId] = useState<string | undefined>(undefined);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
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
      console.error('Failed to match transaction:', err);
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

  const handleCreateProject = async (proj: NewProjectPayload) => {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proj),
    });
    await fetchData();
  };

  const handleCreateExpense = async (exp: any) => {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exp),
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

  const openQuickAdd = (tab: 'project' | 'expense' | 'labor' | 'invoice' = 'expense', projectId?: string) => {
    setQuickAddTab(tab);
    setQuickAddProjectId(projectId);
    setQuickAddOpen(true);
  };

  if (loading || !data.summary) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div className="swiss-header" style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#f8fafc' }}>
            BUDGET BOT // INITIALIZING
          </div>
          <div style={{ fontSize: '0.85rem' }}>Loading trade financials and card transactions...</div>
        </div>
      </div>
    );
  }

  // Active / In Progress Projects for main view
  const activeProjects = data.projects.filter((p) => p.status === 'in_progress' || p.status === 'completed').slice(0, 4);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Swiss Navigation Header */}
      <Navigation
        unassignedCount={data.summary.unassignedTransactionsCount}
        cardProfile={data.cardProfile}
        onOpenQuickAdd={openQuickAdd}
      />

      {/* Main Content Area */}
      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Executive Headline & Quick Date */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Financial Operating Ledger
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Contractor Profit & Expense Command
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--severity-healthy)' }} />
              Live Card Feed: Active
            </span>
          </div>
        </div>

        {/* Severity Metrics Bar */}
        <DashboardMetrics summary={data.summary} />

        {/* Two-Column Grid: Active Projects & Card Inbox */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem', marginBottom: '1.75rem' }}>
          {/* Column 1: Active Contracts & Profit Margins */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  Active Job Cost Centers
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Materials vs Labor Breakdown & Margin Health
                </div>
              </div>

              <Link
                href="/projects"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--accent-cyan)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                View All ({data.projects.length}) <ArrowRight size={13} />
              </Link>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {activeProjects.map((project) => {
                const kpi = data.projectKPIs.find((k) => k.projectId === project.id);
                if (!kpi) return null;
                return (
                  <JobCostCard
                    key={project.id}
                    project={project}
                    kpi={kpi}
                    onOpenQuickLabor={(id) => openQuickAdd('labor', id)}
                    onOpenQuickExpense={(id) => openQuickAdd('expense', id)}
                  />
                );
              })}
            </div>
          </div>

          {/* Column 2: Live Credit Card Ingestion & Matching */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  Card Ingestion & Expense Triage
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  1-Click match hardware store receipts to client contracts
                </div>
              </div>

              <Link
                href="/transactions"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--accent-cyan)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                Full Ledger <ArrowRight size={13} />
              </Link>
            </div>

            <TransactionInbox
              transactions={data.transactions}
              projects={data.projects}
              onAssignProject={handleAssignProject}
              onUpdateCategory={handleUpdateCategory}
              onImportCsv={handleImportCsv}
              onDeleteTransaction={handleDeleteTransaction}
            />
          </div>
        </div>

        {/* Bottom Section: Cash Flow Waterfall */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                Day-to-Day & Weekly Cash Flow
              </h2>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Cash inflows from deposits vs card outflows for materials & tools
              </div>
            </div>

            <Link
              href="/cashflow"
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--accent-cyan)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              Liquidity & Runway Forecast <ArrowRight size={13} />
            </Link>
          </div>

          <CashFlowWaterfall
            transactions={data.transactions}
            invoices={data.invoices}
            cardProfile={data.cardProfile}
          />
        </div>
      </div>

      {/* Quick Add Modal */}
      <QuickAddModal
        initialTab={quickAddTab}
        initialProjectId={quickAddProjectId}
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
