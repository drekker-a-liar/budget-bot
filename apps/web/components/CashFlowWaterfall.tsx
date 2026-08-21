'use client';

import React from 'react';
import {
  addCents,
  formatCents,
  multiplyCents,
  subtractCents,
  type Cents,
  type WeeklyCashFlow,
} from '@budget-bot/core';

/**
 * Week-to-week cash in against cash out.
 *
 * Every figure on this component comes from its props. It used to carry four
 * weeks of invented literals - "Week 1 (Jul 27 - Aug 02) … $1,049.35" - which
 * were rendered next to real data and were indistinguishable from it, and an
 * `estimatedLiquidCash = 18450` that was nobody's bank balance. A dashboard
 * that reports a number nobody can trace is worse than one that reports
 * nothing, so what cannot be computed is an em dash now.
 */

interface CashFlowWaterfallProps {
  /** Oldest first. Zero-filled by the caller, so gaps are visible as zero. */
  weeks: WeeklyCashFlow[];
  /** Null until a bank account is linked, which is Phase 2. */
  availableCreditCents?: Cents | null;
  /** The card's limit, for context beside the credit available on it. */
  creditLimitCents?: Cents | null;
}

const EM_DASH = '—';

/** A week's label, from the Monday it starts on: "Aug 17 - Aug 23". */
function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const format = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
  return `${format(start)} - ${format(end)}`;
}

export function CashFlowWaterfall({
  weeks,
  availableCreditCents = null,
  creditLimitCents = null,
}: CashFlowWaterfallProps) {
  const totalInflow = addCents(...weeks.map((w) => w.inflowCents));
  const totalOutflow = addCents(...weeks.map((w) => w.outflowCents));
  const netCashPeriod = subtractCents(totalInflow, totalOutflow);
  const weeklyBurn =
    weeks.length > 0 ? multiplyCents(totalOutflow, 1 / weeks.length) : (0 as Cents);

  /**
   * How many weeks the available credit covers at the recent burn rate. Null
   * when there is no card linked to draw on, or nothing being spent: a runway
   * figure invented from a default credit line is exactly the kind of number
   * that gets believed.
   */
  const runwayWeeks =
    availableCreditCents === null || weeklyBurn <= 0
      ? null
      : Math.round((availableCreditCents / weeklyBurn) * 10) / 10;

  // Bars are scaled against the biggest single figure in the window, so the
  // shape of the period is legible whatever the amounts happen to be.
  const scale = Math.max(
    1,
    ...weeks.map((w) => Math.max(w.inflowCents, w.outflowCents))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Banner: period totals and what is left to draw on */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="swiss-card">
          <span className="swiss-label">Cash In ({weeks.length}-Week)</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="swiss-header tnum" style={{ fontSize: '2rem', color: 'var(--severity-healthy)' }}>
              {formatCents(totalInflow, { showCents: false })}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Invoices paid in the period
          </div>
        </div>

        <div className="swiss-card">
          <span className="swiss-label">Available Card Credit</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="swiss-header tnum" style={{ fontSize: '2rem', color: 'var(--accent-cyan)' }}>
              {availableCreditCents === null
                ? EM_DASH
                : formatCents(availableCreditCents, { showCents: false })}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {creditLimitCents === null
              ? 'No card linked yet'
              : `Limit ${formatCents(creditLimitCents, { showCents: false })}`}
          </div>
        </div>

        <div className="swiss-card">
          <span className="swiss-label">Average Weekly Outflow</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="swiss-header tnum" style={{ fontSize: '2rem', color: '#f8fafc' }}>
              {formatCents(weeklyBurn, { showCents: false })}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/ week</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Materials, Fuel, Subs &amp; Tools
          </div>
        </div>

        <div className="swiss-card">
          <span className="swiss-label">Credit Runway</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span
              className="swiss-header tnum"
              style={{ fontSize: '2rem', color: 'var(--severity-healthy)' }}
            >
              {runwayWeeks === null ? EM_DASH : runwayWeeks}
            </span>
            {runwayWeeks !== null && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>weeks</span>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {runwayWeeks === null
              ? 'Needs a linked card and some spend'
              : 'Available credit at the recent burn rate'}
          </div>
        </div>
      </div>

      {/* Week-by-week breakdown */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              Week-to-Week Cash Flow Waterfall
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Client deposits &amp; invoice payouts vs card charges &amp; supplier orders
            </div>
          </div>
          <div className={netCashPeriod >= 0 ? 'badge-healthy' : 'badge-critical'}>
            NET {netCashPeriod >= 0 ? '+' : '-'}
            {formatCents(
              netCashPeriod < 0 ? multiplyCents(netCashPeriod, -1) : netCashPeriod,
              { showCents: false }
            )}
          </div>
        </div>

        {weeks.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No cash movement recorded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {weeks.map((week) => (
              <div
                key={week.weekStart}
                style={{
                  background: 'var(--bg-panel)',
                  padding: '1rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>
                    {weekLabel(week.weekStart)}
                  </div>
                  <div
                    className="tnum"
                    style={{
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      color: week.netCents >= 0 ? 'var(--severity-healthy)' : 'var(--severity-critical)',
                    }}
                  >
                    Net: {week.netCents >= 0 ? '+' : ''}
                    {formatCents(week.netCents)}
                  </div>
                </div>

                {/* Inflow Bar */}
                <div style={{ marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                    <span>Client Inflows (Deposits/Invoices)</span>
                    <span className="tnum" style={{ color: 'var(--severity-healthy)', fontWeight: 600 }}>
                      +{formatCents(week.inflowCents)}
                    </span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      title={`Inflow ${formatCents(week.inflowCents)}`}
                      style={{
                        width: `${(week.inflowCents / scale) * 100}%`,
                        height: '100%',
                        background: 'var(--severity-healthy)',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                </div>

                {/* Outflow Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                    <span>Card Expenses (Materials/Gas/Tools)</span>
                    <span className="tnum" style={{ color: 'var(--severity-critical)', fontWeight: 600 }}>
                      -{formatCents(week.outflowCents)}
                    </span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      title={`Outflow ${formatCents(week.outflowCents)}`}
                      style={{
                        width: `${(week.outflowCents / scale) * 100}%`,
                        height: '100%',
                        background: 'var(--severity-critical)',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
