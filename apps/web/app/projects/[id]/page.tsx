'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Project,
  ProjectFinancialKPIs,
  ExpenseTransaction,
  LaborEntry,
  Invoice,
  ProjectStatus,
} from '@budget-bot/core';
import { Navigation } from '@/components/Navigation';
import { SeverityBadge } from '@/components/SeverityBadge';
import { MarginGauge } from '@/components/MarginGauge';
import { QuickAddModal } from '@/components/QuickAddModal';
import {
  ArrowLeft,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  Clock,
  Receipt,
  Plus,
  Trash2,
  CheckCircle2,
  FileText,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [kpi, setKpi] = useState<ProjectFinancialKPIs | null>(null);
  const [transactions, setTransactions] = useState<ExpenseTransaction[]>([]);
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<'project' | 'expense' | 'labor' | 'invoice'>('expense');

  const fetchProjectData = async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setKpi(data.kpi);
        setTransactions(data.transactions);
        setLaborEntries(data.laborEntries);
        setInvoices(data.invoices);
      }
    } catch (err) {
      console.error('Failed to load project details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchProjectData();
    }
  }, [id]);

  const handleUpdateStatus = async (newStatus: ProjectStatus) => {
    try {
      await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchProjectData();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleDeleteExpense = async (txId: string) => {
    try {
      await fetch(`/api/transactions?id=${txId}`, { method: 'DELETE' });
      await fetchProjectData();
    } catch (err) {
      console.error('Failed to delete transaction:', err);
    }
  };

  const handleDeleteLabor = async (labId: string) => {
    try {
      await fetch(`/api/labor?id=${labId}`, { method: 'DELETE' });
      await fetchProjectData();
    } catch (err) {
      console.error('Failed to delete labor entry:', err);
    }
  };

  const handleCreateExpense = async (exp: any) => {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...exp, projectId: id }),
    });
    await fetchProjectData();
  };

  const handleCreateLabor = async (lab: any) => {
    await fetch('/api/labor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lab, projectId: id }),
    });
    await fetchProjectData();
  };

  const handleCreateInvoice = async (inv: any) => {
    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...inv, projectId: id }),
    });
    await fetchProjectData();
  };

  const openQuickAdd = (tab: 'project' | 'expense' | 'labor' | 'invoice' = 'expense') => {
    setQuickAddTab(tab);
    setQuickAddOpen(true);
  };

  if (loading || !project || !kpi) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading project ledger...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation onOpenQuickAdd={openQuickAdd} />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Back Link */}
        <Link
          href="/projects"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
            fontSize: '0.8rem',
            marginBottom: '1rem',
          }}
        >
          <ArrowLeft size={14} /> Back to Projects
        </Link>

        {/* Project Header Banner */}
        <div
          className="swiss-card"
          style={{
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
              <select
                value={project.status}
                onChange={(e) => handleUpdateStatus(e.target.value as ProjectStatus)}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-strong)',
                  color: '#f8fafc',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                <option value="estimating">Estimating</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
              </select>

              <span className="swiss-label">
                {project.pricingType === 'fixed' ? 'Fixed Price Contract' : 'Time & Materials'}
              </span>
            </div>

            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc', marginBottom: '0.4rem' }}>
              {project.name}
            </h1>

            <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
              <span><strong>Client:</strong> {project.clientName} ({project.clientPhone})</span>
              <span><strong>Site:</strong> {project.clientAddress}</span>
              <span><strong>Started:</strong> {project.startDate}</span>
            </div>

            {project.description && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.6rem', maxWidth: '800px' }}>
                {project.description}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button onClick={() => openQuickAdd('expense')} className="btn-primary" style={{ fontSize: '0.75rem' }}>
              <Receipt size={13} />
              <span>+ Add Receipt</span>
            </button>

            <button onClick={() => openQuickAdd('labor')} className="btn-secondary" style={{ fontSize: '0.75rem' }}>
              <Clock size={13} />
              <span>+ Log Labor</span>
            </button>

            <button onClick={() => openQuickAdd('invoice')} className="btn-secondary" style={{ fontSize: '0.75rem' }}>
              <FileText size={13} />
              <span>+ Invoice</span>
            </button>
          </div>
        </div>

        {/* Financial KPI Dashboard */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          {/* Quoted Revenue */}
          <div className="swiss-card">
            <span className="swiss-label">Contract Revenue</span>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc', marginTop: '0.2rem' }}>
              ${kpi.revenue.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Quoted: ${kpi.quotedTotal.toLocaleString()}
            </div>
          </div>

          {/* Actual Direct Cost */}
          <div className="swiss-card">
            <span className="swiss-label">Total Direct Cost</span>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: 'var(--accent-cyan)', marginTop: '0.2rem' }}>
              ${kpi.totalDirectCost.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Materials: ${kpi.actualMaterialsCost.toLocaleString()} &bull; Labor: ${kpi.actualLaborCost.toLocaleString()}
            </div>
          </div>

          {/* Gross Profit Margin */}
          <div className="swiss-card">
            <div className="swiss-card-header">
              <span className="swiss-label">Gross Margin</span>
              <SeverityBadge level={kpi.grossMarginSeverity} />
            </div>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              {kpi.grossMarginPct}%
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Gross Profit: <strong className="tnum" style={{ color: 'var(--severity-healthy)' }}>${kpi.grossProfit.toLocaleString()}</strong>
            </div>
          </div>

          {/* Realized Hourly Rate */}
          <div className="swiss-card">
            <div className="swiss-card-header">
              <span className="swiss-label">Realized Rate</span>
              <SeverityBadge level={kpi.hourlySeverity} />
            </div>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              ${kpi.netHourlyRealization.toFixed(0)}<span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/hr</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Target: ${project.targetHourlyRate}/hr &bull; {kpi.actualLaborHours} hrs worked
            </div>
          </div>

          {/* Materials Markup */}
          <div className="swiss-card">
            <div className="swiss-card-header">
              <span className="swiss-label">Materials Markup</span>
              <SeverityBadge level={kpi.materialsMarkupSeverity} />
            </div>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              {kpi.materialsMarkupPct}%
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Quoted Materials: ${project.quotedMaterials.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Margin Gauge Visualizer */}
        <div className="swiss-card" style={{ marginBottom: '1.5rem' }}>
          <div className="swiss-card-header">
            <span className="swiss-label">Cost Structure & Profit Realization</span>
          </div>
          <MarginGauge kpi={kpi} showLabels={true} />
        </div>

        {/* Granular Ledgers Grid: Materials Receipts vs Labor Entries */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
          {/* Materials Receipts */}
          <div className="swiss-card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
                  Materials & Job Receipts ({transactions.length})
                </h3>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Matched card charges from Home Depot, Lowe&apos;s, Ferguson
                </div>
              </div>
              <button onClick={() => openQuickAdd('expense')} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
                + Add Receipt
              </button>
            </div>

            {transactions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No receipts matched to this project yet. Use the Card Inbox to assign Home Depot or Lowe&apos;s purchases.
              </div>
            ) : (
              <table className="swiss-table">
                <thead>
                  <tr>
                    <th style={{ width: '85px' }}>Date</th>
                    <th>Vendor / Notes</th>
                    <th style={{ width: '90px' }}>Category</th>
                    <th style={{ width: '90px', textAlign: 'right' }}>Amount</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="tnum" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.date}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.8rem' }}>{t.vendor}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.description}</div>
                      </td>
                      <td>
                        <span className="badge-materials" style={{ fontSize: '0.65rem' }}>{t.category.toUpperCase()}</span>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>
                        ${t.amount.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteExpense(t.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Labor Time Logs */}
          <div className="swiss-card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
                  Labor Hours Log ({laborEntries.length})
                </h3>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Total: {kpi.actualLaborHours} hrs (${kpi.actualLaborCost.toLocaleString()})
                </div>
              </div>
              <button onClick={() => openQuickAdd('labor')} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
                + Log Hours
              </button>
            </div>

            {laborEntries.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No labor entries recorded yet.
              </div>
            ) : (
              <table className="swiss-table">
                <thead>
                  <tr>
                    <th style={{ width: '85px' }}>Date</th>
                    <th>Worker / Tasks</th>
                    <th style={{ width: '60px', textAlign: 'right' }}>Hours</th>
                    <th style={{ width: '80px', textAlign: 'right' }}>Cost</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {laborEntries.map((l) => (
                    <tr key={l.id}>
                      <td className="tnum" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{l.date}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.8rem' }}>{l.workerName}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.notes || 'Onsite labor'}</div>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>
                        {l.hours} hrs
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent-indigo)' }}>
                        ${(l.hours * l.hourlyRate).toFixed(0)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteLabor(l.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Invoices & Collections */}
        <div className="swiss-card" style={{ padding: 0 }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
                Client Invoices & Receivables
              </h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Billing schedule, deposits, and payment tracking
              </div>
            </div>
            <button onClick={() => openQuickAdd('invoice')} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              + Issue Invoice
            </button>
          </div>

          {invoices.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No invoices issued for this project.
            </div>
          ) : (
            <table className="swiss-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Issued</th>
                  <th>Due Date</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th>
                  <th>Paid Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 700, color: '#f8fafc' }}>{inv.invoiceNumber}</td>
                    <td className="tnum" style={{ color: 'var(--text-secondary)' }}>{inv.dateIssued}</td>
                    <td className="tnum" style={{ color: 'var(--text-secondary)' }}>{inv.dueDate}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 700 }}>
                      ${inv.amount.toLocaleString()}
                    </td>
                    <td>
                      {inv.status === 'paid' ? (
                        <span className="badge-healthy">PAID</span>
                      ) : inv.status === 'overdue' ? (
                        <span className="badge-critical">OVERDUE</span>
                      ) : (
                        <span className="badge-caution">SENT</span>
                      )}
                    </td>
                    <td className="tnum" style={{ color: 'var(--text-secondary)' }}>{inv.paidDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <QuickAddModal
        initialTab={quickAddTab}
        initialProjectId={id}
        projects={project ? [project] : []}
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreateProject={async () => {}}
        onCreateExpense={handleCreateExpense}
        onCreateLabor={handleCreateLabor}
        onCreateInvoice={handleCreateInvoice}
      />
    </div>
  );
}
