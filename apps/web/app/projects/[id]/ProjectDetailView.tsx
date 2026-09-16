'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { formatCents, multiplyCents, type ProjectStatus } from '@budget-bot/core';
import { ArrowLeft, Clock, FileText, Receipt, Trash2 } from 'lucide-react';
import { MarginGauge } from '@/components/MarginGauge';
import { Navigation } from '@/components/Navigation';
import { QuickAddModal, type QuickAddTab } from '@/components/QuickAddModal';
import { SeverityBadge } from '@/components/SeverityBadge';
import { deleteLaborEntryAction } from '@/src/server/actions/labor';
import { updateProjectStatusAction } from '@/src/server/actions/projects';
import { deleteTransactionAction } from '@/src/server/actions/transactions';
import type { ActionResult } from '@/src/server/actions/result';
import type { ProjectDetailData } from '@/src/server/queries/projects';

/**
 * One job's ledger: what it was quoted at, what it has cost, and every row
 * behind those two numbers.
 *
 * The three writes on this page - moving the job's status, deleting a receipt,
 * deleting a labor entry - are server actions. Each of them changes the
 * project's margin, so the page re-renders on the server rather than the
 * browser patching a copy of the figures.
 */
export function ProjectDetailView({
  project,
  kpi,
  transactions,
  laborEntries,
  invoices,
  unassignedCount,
}: ProjectDetailData) {
  const [quickAdd, setQuickAdd] = useState<{ tab: QuickAddTab } | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (write: () => Promise<ActionResult<unknown>>) => {
    setError(null);
    startTransition(async () => {
      const result = await write();
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={unassignedCount}
        onOpenQuickAdd={(tab = 'expense') => setQuickAdd({ tab })}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
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
                aria-label="Project status"
                value={project.status}
                disabled={pending}
                onChange={(e) =>
                  run(() =>
                    updateProjectStatusAction({
                      id: project.id,
                      status: e.target.value as ProjectStatus,
                    })
                  )
                }
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
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

            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
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
            <button type="button" onClick={() => setQuickAdd({ tab: 'expense' })} className="btn-primary" style={{ fontSize: '0.75rem' }}>
              <Receipt size={13} />
              <span>+ Add Receipt</span>
            </button>

            <button type="button" onClick={() => setQuickAdd({ tab: 'labor' })} className="btn-secondary" style={{ fontSize: '0.75rem' }}>
              <Clock size={13} />
              <span>+ Log Labor</span>
            </button>

            <button type="button" onClick={() => setQuickAdd({ tab: 'invoice' })} className="btn-secondary" style={{ fontSize: '0.75rem' }}>
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
          <div className="swiss-card">
            <span className="swiss-label">Contract Revenue</span>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {formatCents(kpi.revenueCents)}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Quoted: {formatCents(kpi.quotedTotalCents)}
            </div>
          </div>

          <div className="swiss-card">
            <span className="swiss-label">Total Direct Cost</span>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: 'var(--accent-cyan)', marginTop: '0.2rem' }}>
              {formatCents(kpi.totalDirectCostCents)}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Materials: {formatCents(kpi.actualMaterialsCostCents)} &bull; Labor:{' '}
              {formatCents(kpi.actualLaborCostCents)}
            </div>
          </div>

          <div className="swiss-card">
            <div className="swiss-card-header">
              <span className="swiss-label">Gross Margin</span>
              <SeverityBadge level={kpi.grossMarginSeverity} />
            </div>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)' }}>
              {kpi.grossMarginPct === null ? '—' : `${kpi.grossMarginPct}%`}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Gross Profit:{' '}
              <strong className="tnum" style={{ color: 'var(--severity-healthy)' }}>
                {formatCents(kpi.grossProfitCents)}
              </strong>
            </div>
          </div>

          <div className="swiss-card">
            <div className="swiss-card-header">
              <span className="swiss-label">Realized Rate</span>
              <SeverityBadge
                level={kpi.hourlySeverity}
                label={kpi.hourlySeverity === null ? 'NO HOURS LOGGED' : undefined}
              />
            </div>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)' }}>
              {kpi.netHourlyRealizationCents === null ? (
                '—'
              ) : (
                <>
                  {formatCents(kpi.netHourlyRealizationCents, { showCents: false })}
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/hr</span>
                </>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Target: {formatCents(project.targetHourlyRateCents, { showCents: false })}/hr &bull;{' '}
              {kpi.actualLaborHours} hrs worked
            </div>
          </div>

          <div className="swiss-card">
            <div className="swiss-card-header">
              <span className="swiss-label">Materials Markup</span>
              <SeverityBadge level={kpi.materialsMarkupSeverity} />
            </div>
            <div className="tnum swiss-header" style={{ fontSize: '1.85rem', color: 'var(--text-primary)' }}>
              {kpi.materialsMarkupPct === null ? '—' : `${kpi.materialsMarkupPct}%`}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              Quoted Materials: {formatCents(project.quotedMaterialsCents)}
            </div>
          </div>
        </div>

        {/* Margin Gauge Visualizer */}
        <div className="swiss-card" style={{ marginBottom: '1.5rem' }}>
          <div className="swiss-card-header">
            <span className="swiss-label">Cost Structure &amp; Profit Realization</span>
          </div>
          <MarginGauge kpi={kpi} showLabels={true} />
        </div>

        {/* Granular Ledgers Grid: Materials Receipts vs Labor Entries */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div className="swiss-card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Materials &amp; Job Receipts ({transactions.length})
                </h3>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Card charges filed against this job
                </div>
              </div>
              <button type="button" onClick={() => setQuickAdd({ tab: 'expense' })} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
                + Add Receipt
              </button>
            </div>

            {transactions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No receipts matched to this project yet. Use the Card Inbox to assign them.
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
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.8rem' }}>{t.vendor}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.description}</div>
                      </td>
                      <td>
                        <span className="badge-materials" style={{ fontSize: '0.65rem' }}>{t.category.toUpperCase()}</span>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>
                        {formatCents(t.amountCents)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => run(() => deleteTransactionAction({ id: t.id }))}
                          disabled={pending}
                          title="Delete expense"
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

          <div className="swiss-card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Labor Hours Log ({laborEntries.length})
                </h3>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Total: {kpi.actualLaborHours} hrs ({formatCents(kpi.actualLaborCostCents)})
                </div>
              </div>
              <button type="button" onClick={() => setQuickAdd({ tab: 'labor' })} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
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
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.8rem' }}>{l.workerName}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.notes || 'Onsite labor'}</div>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>
                        {l.hours} hrs
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.85rem', color: 'var(--accent-indigo)' }}>
                        {formatCents(multiplyCents(l.hourlyRateCents, l.hours), { showCents: false })}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => run(() => deleteLaborEntryAction({ id: l.id }))}
                          disabled={pending}
                          title="Delete labor entry"
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
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Client Invoices &amp; Receivables
              </h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Billing schedule, deposits, and payment tracking
              </div>
            </div>
            <button type="button" onClick={() => setQuickAdd({ tab: 'invoice' })} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
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
                    <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.invoiceNumber}</td>
                    <td className="tnum" style={{ color: 'var(--text-secondary)' }}>{inv.dateIssued}</td>
                    <td className="tnum" style={{ color: 'var(--text-secondary)' }}>{inv.dueDate}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {formatCents(inv.amountCents)}
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

      {quickAdd !== null && (
        <QuickAddModal
          initialTab={quickAdd.tab}
          initialProjectId={project.id}
          projects={[project]}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  );
}
