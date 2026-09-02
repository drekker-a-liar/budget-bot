'use client';

import React from 'react';
import Link from 'next/link';
import { formatCents, Project, ProjectFinancialKPIs } from '@budget-bot/core';
import { SeverityBadge } from './SeverityBadge';
import { MarginGauge } from './MarginGauge';
import {
  MapPin,
  Phone,
  Clock,
  ArrowRight,
  TrendingUp,
  Receipt,
  AlertTriangle
} from 'lucide-react';

interface JobCostCardProps {
  project: Project;
  kpi: ProjectFinancialKPIs;
  onOpenQuickLabor?: (projectId: string) => void;
  onOpenQuickExpense?: (projectId: string) => void;
}

export function JobCostCard({
  project,
  kpi,
  onOpenQuickLabor,
  onOpenQuickExpense,
}: JobCostCardProps) {
  const statusStyles: Record<string, { label: string; badge: string }> = {
    estimating: { label: 'ESTIMATING', badge: 'badge-neutral' },
    in_progress: { label: 'IN PROGRESS', badge: 'badge-caution' },
    completed: { label: 'COMPLETED', badge: 'badge-healthy' },
    on_hold: { label: 'ON HOLD', badge: 'badge-critical' },
  };

  const statusConfig = statusStyles[project.status] || {
    label: project.status.toUpperCase(),
    badge: 'badge-neutral',
  };

  return (
    <div className="swiss-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Top Header: Title, Client, Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span className={statusConfig.badge} style={{ fontSize: '0.65rem' }}>
              {statusConfig.label}
            </span>
            <span className="swiss-label" style={{ fontSize: '0.65rem' }}>
              {project.pricingType === 'fixed' ? 'FIXED CONTRACT' : 'T&M BILLING'}
            </span>
          </div>
          <Link
            href={`/projects/${project.id}`}
            style={{
              fontSize: '1.05rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              textDecoration: 'none',
              letterSpacing: '-0.02em',
            }}
          >
            {project.name}
          </Link>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
            {project.clientName} &bull; {project.clientAddress}
          </div>
        </div>

        {/* Gross Margin Badge. Null margin (no quote, nothing invoiced) is an
            em dash on a neutral badge, as the dashboard's aggregate draws it -
            not "0%" in red for a job nothing has happened to yet. */}
        <div style={{ textAlign: 'right' }}>
          <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>GROSS MARGIN</div>
          <SeverityBadge
            level={kpi.grossMarginSeverity}
            label={kpi.grossMarginPct === null ? '—' : `${kpi.grossMarginPct}%`}
            size="md"
          />
        </div>
      </div>

      {/* Financial Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.75rem',
          background: 'var(--bg-panel)',
          padding: '0.75rem',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <div className="swiss-label" style={{ fontSize: '0.65rem' }}>Quoted Price</div>
          <div className="tnum" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {formatCents(kpi.quotedTotalCents)}
          </div>
        </div>

        <div>
          <div className="swiss-label" style={{ fontSize: '0.65rem' }}>Direct Costs</div>
          <div className="tnum" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
            {formatCents(kpi.totalDirectCostCents)}
          </div>
        </div>

        <div>
          <div className="swiss-label" style={{ fontSize: '0.65rem' }}>Gross Profit</div>
          <div
            className="tnum"
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: kpi.grossProfitCents >= 0 ? 'var(--severity-healthy)' : 'var(--severity-critical)',
            }}
          >
            {formatCents(kpi.grossProfitCents)}
          </div>
        </div>

        <div>
          <div className="swiss-label" style={{ fontSize: '0.65rem' }}>Realized Rate</div>
          <div className="tnum" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {kpi.netHourlyRealizationCents === null ? (
              '\u2014'
            ) : (
              <>
                {formatCents(kpi.netHourlyRealizationCents, { showCents: false })}
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/hr</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Margin Gauge Visualizer */}
      <MarginGauge kpi={kpi} showLabels={true} />

      {/* Footer: Labor summary & Action links */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '0.75rem',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Clock size={13} color="var(--accent-indigo)" />
            Labor: <strong className="tnum" style={{ color: 'var(--text-primary)' }}>{kpi.actualLaborHours} hrs</strong>
            <span style={{ color: 'var(--text-muted)' }}>/ {kpi.quotedLaborHours} quoted</span>
          </span>

          {kpi.isOverBudget && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--severity-critical)', fontWeight: 600 }}>
              {/* A zero-quote job with spend is over budget with no ratio to
                  report: money against nothing. The dash keeps the shape. */}
              <AlertTriangle size={12} /> Over Budget (
              {kpi.budgetVariancePct === null ? '—' : `${kpi.budgetVariancePct}%`})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {onOpenQuickLabor && (
            <button
              type="button"
              onClick={() => onOpenQuickLabor(project.id)}
              className="btn-secondary"
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
            >
              + Log Hours
            </button>
          )}

          <Link
            href={`/projects/${project.id}`}
            className="btn-secondary"
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: '0.7rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            Cost Ledger <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
