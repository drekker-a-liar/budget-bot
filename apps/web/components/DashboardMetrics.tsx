'use client';

import React from 'react';
import { BusinessFinancialSummary } from '@budget-bot/core';
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
  onOpenInbox?: () => void;
}

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
            label={summary.averageMarginPct >= 45 ? 'TARGET MET' : summary.averageMarginPct >= 25 ? 'CAUTION' : 'COMPRESSED'}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            {summary.averageMarginPct}%
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>avg across jobs</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span>Target: <strong style={{ color: '#f8fafc' }}>45.0%</strong></span>
          <span>YTD Profit: <strong className="tnum" style={{ color: 'var(--severity-healthy)' }}>${summary.totalGrossProfitYTD.toLocaleString()}</strong></span>
        </div>
      </div>

      {/* Net Hourly Realization */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Net Hourly Realization</span>
          <SeverityBadge
            level={summary.averageHourlySeverity}
            label={summary.averageHourlyRealization >= 85 ? 'STRONG' : 'WATCH'}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            ${summary.averageHourlyRealization.toFixed(0)}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/ billable hr</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span>Target: <strong style={{ color: '#f8fafc' }}>$85.00/hr</strong></span>
          <span>After Material Pass-through</span>
        </div>
      </div>

      {/* Weekly Cash Flow */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Weekly Net Cash Flow</span>
          <SeverityBadge
            level={summary.cashFlowSeverity}
            label={summary.weeklyNetCashFlow >= 0 ? 'POSITIVE' : 'DEFICIT'}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span
            className="swiss-header tnum"
            style={{
              fontSize: '2.25rem',
              color: summary.weeklyNetCashFlow >= 0 ? 'var(--severity-healthy)' : 'var(--severity-critical)',
            }}
          >
            {summary.weeklyNetCashFlow >= 0 ? '+' : ''}${Math.abs(summary.weeklyNetCashFlow).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>last 7 days</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span style={{ color: 'var(--severity-healthy)' }}>+{summary.weeklyCashInflow.toLocaleString()} in</span>
          <span style={{ color: 'var(--severity-critical)' }}>-{summary.weeklyCashOutflow.toLocaleString()} out</span>
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
            ${summary.unassignedTransactionsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>unlinked spend</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Home Depot & Lowe's swipes</span>
          <Link
            href="/transactions"
            style={{
              color: 'var(--accent-cyan)',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '0.72rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
            }}
          >
            Triage Swipes <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>

      {/* Outstanding Receivables */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <span className="swiss-label">Outstanding Receivables</span>
          <SeverityBadge
            level={summary.receivablesSeverity}
            label={summary.overdueReceivables > 0 ? `${summary.overdueReceivables > 0 ? 'OVERDUE' : 'PENDING'}` : 'CURRENT'}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
          <span className="swiss-header tnum" style={{ fontSize: '2.25rem', color: '#f8fafc' }}>
            ${summary.outstandingReceivables.toLocaleString()}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>invoiced</span>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          <span>Overdue: <strong className="tnum" style={{ color: summary.overdueReceivables > 0 ? 'var(--severity-critical)' : '#f8fafc' }}>${summary.overdueReceivables.toLocaleString()}</strong></span>
          <span>{summary.openProjectsCount} active jobs</span>
        </div>
      </div>
    </div>
  );
}
