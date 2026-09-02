'use client';

import React from 'react';
import { formatCents, BusinessFinancialSummary, THRESHOLDS } from '@budget-bot/core';
import { SeverityBadge } from './SeverityBadge';
import {
  TrendingUp,
  DollarSign,
  Clock,
  CreditCard,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Receipt
} from 'lucide-react';
import Link from 'next/link';

interface DashboardMetricsProps {
  summary: BusinessFinancialSummary;
  /**
   * How to reach the triage inbox from here. The dashboard renders the inbox
   * further down its own page and passes a handler that scrolls to it; a page
   * that has no inbox of its own leaves this out and the card links to
   * `/transactions` instead.
   */
  onOpenInbox?: () => void;
}

/** Shared so the button and the link are the same affordance, differently wired. */
const TRIAGE_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--accent-cyan)',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: '0.72rem',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.2rem',
};

export function DashboardMetrics({ summary, onOpenInbox }: DashboardMetricsProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '1rem',
      marginBottom: '1.5rem',
    }}>
      {/* Gross Profit Margin KPI */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Gross Profit Margin</span>
          <SeverityBadge
            level={summary.averageMarginSeverity}
            label={
              summary.averageMarginPct === null
                ? 'NO REVENUE'
                : summary.averageMarginPct >= THRESHOLDS.GROSS_MARGIN.HEALTHY
                  ? 'TARGET MET'
                  : summary.averageMarginPct >= THRESHOLDS.GROSS_MARGIN.CAUTION
                    ? 'CAUTION'
                    : 'COMPRESSED'
            }
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            {summary.averageMarginPct === null ? '—' : `${summary.averageMarginPct}%`}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>avg across jobs</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span>Target: <strong style={{ color: '#f8fafc' }}>{THRESHOLDS.GROSS_MARGIN.HEALTHY.toFixed(1)}%</strong></span>
          <span>YTD Profit: <strong className="tnum" style={{ color: summary.totalGrossProfitYTDCents >= 0 ? 'var(--severity-healthy)' : 'var(--severity-critical)' }}>{formatCents(summary.totalGrossProfitYTDCents)}</strong></span>
        </div>
      </div>

      {/* Net Hourly Realization */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Net Hourly Realization</span>
          <SeverityBadge
            level={summary.averageHourlySeverity}
            label={
              summary.averageHourlyRealizationCents === null
                ? 'NO HOURS LOGGED'
                : summary.averageHourlyRealizationCents >=
                    THRESHOLDS.HOURLY_REALIZATION.HEALTHY
                  ? 'STRONG'
                  : 'WATCH'
            }
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            {summary.averageHourlyRealizationCents === null
              ? '\u2014'
              : formatCents(summary.averageHourlyRealizationCents, { showCents: false })}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/ billable hr</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span>Target: <strong style={{ color: '#f8fafc' }}>{formatCents(THRESHOLDS.HOURLY_REALIZATION.HEALTHY)}/hr</strong></span>
          <span>After Material Pass-through</span>
        </div>
      </div>

      {/* Weekly Cash Flow */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Weekly Net Cash Flow</span>
          <SeverityBadge
            level={summary.cashFlowSeverity}
            label={summary.weeklyNetCashFlowCents >= 0 ? 'POSITIVE' : 'DEFICIT'}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span
            className="swiss-header tnum"
            style={{
              fontSize: '2.25rem',
              color: summary.weeklyNetCashFlowCents >= 0 ? 'var(--severity-healthy)' : 'var(--severity-critical)',
            }}
          >
            {/*
              The sign is part of the figure, not a colour. `formatCents`
              already writes a negative as `-$1,250`; taking the magnitude and
              prefixing nothing rendered a deficit as a surplus to anyone not
              reading the red (WCAG 1.4.1).
            */}
            {summary.weeklyNetCashFlowCents >= 0 ? '+' : ''}
            {formatCents(summary.weeklyNetCashFlowCents, { showCents: false })}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>last 7 days</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span style={{ color: 'var(--severity-healthy)' }}>+{formatCents(summary.weeklyCashInflowCents)} in</span>
          <span style={{ color: 'var(--severity-critical)' }}>-{formatCents(summary.weeklyCashOutflowCents)} out</span>
        </div>
      </div>

      {/* Unassigned Card Expenses (Triage Inbox) */}
      <div
        className="swiss-card"
        style={{
          borderColor: summary.unassignedTransactionsCount > 0 ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-subtle)',
          backgroundColor: summary.unassignedTransactionsCount > 0 ? 'rgba(239, 68, 68, 0.04)' : 'var(--bg-card)',
        }}
      >
        <div className="swiss-card-header">
          <span className="swiss-label">Unassigned Card Inbox</span>
          {summary.unassignedTransactionsCount > 0 ? (
            <span className="badge-critical">
              {summary.unassignedTransactionsCount} PENDING
            </span>
          ) : (
            <span className="badge-healthy">ALL MATCHED</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            {formatCents(summary.unassignedTransactionsTotalCents)}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>unlinked spend</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Home Depot &amp; Lowe&apos;s swipes</span>
          {onOpenInbox ? (
            <button type="button" onClick={onOpenInbox} style={TRIAGE_STYLE}>
              Triage Swipes <ArrowUpRight size={12} />
            </button>
          ) : (
            <Link href="/transactions" style={TRIAGE_STYLE}>
              Triage Swipes <ArrowUpRight size={12} />
            </Link>
          )}
        </div>
      </div>

      {/* Outstanding Receivables */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Outstanding Receivables</span>
          <SeverityBadge
            level={summary.receivablesSeverity}
            label={summary.overdueReceivablesCents > 0 ? 'OVERDUE' : 'CURRENT'}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            {formatCents(summary.outstandingReceivablesCents)}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>invoiced</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span>Overdue: <strong className="tnum" style={{ color: summary.overdueReceivablesCents > 0 ? 'var(--severity-critical)' : '#f8fafc' }}>{formatCents(summary.overdueReceivablesCents)}</strong></span>
          <span>{summary.openProjectsCount} active jobs</span>
        </div>
      </div>
    </div>
  );
}
