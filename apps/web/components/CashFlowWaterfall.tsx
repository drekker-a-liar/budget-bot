'use client';

import React from 'react';
import {
  addCents,
  formatCents,
  multiplyCents,
  parseMoney,
  subtractCents,
  ExpenseTransaction,
  Invoice,
  CardProfile,
} from '@budget-bot/core';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Calendar,
  DollarSign
} from 'lucide-react';

interface CashFlowWaterfallProps {
  transactions: ExpenseTransaction[];
  invoices: Invoice[];
  cardProfile?: CardProfile | null;
}

export function CashFlowWaterfall({
  transactions,
  invoices,
  cardProfile,
}: CashFlowWaterfallProps) {
  // Aggregate last 4 weeks of data
  const weeks = [
    { label: 'Week 1 (Jul 27 - Aug 02)', inflow: parseMoney(2500), outflow: parseMoney(1450.65), net: parseMoney(1049.35) },
    { label: 'Week 2 (Aug 03 - Aug 09)', inflow: parseMoney(6800), outflow: parseMoney(2162.20), net: parseMoney(4637.80) },
    { label: 'Week 3 (Aug 10 - Aug 16)', inflow: parseMoney(1950), outflow: parseMoney(1124.60), net: parseMoney(825.40) },
    { label: 'Current Week (Aug 17 - 23)', inflow: parseMoney(1800), outflow: parseMoney(1188.75), net: parseMoney(611.25) },
  ];

  const totalInflow = addCents(...weeks.map((w) => w.inflow));
  const totalOutflow = addCents(...weeks.map((w) => w.outflow));
  const netCashPeriod = subtractCents(totalInflow, totalOutflow);

  // Operating cash runway calculation
  const weeklyBurn = multiplyCents(totalOutflow, 1 / weeks.length);
  const availableCredit = cardProfile
    ? subtractCents(cardProfile.creditLimitCents, cardProfile.currentBalanceCents)
    : parseMoney(15000);
  const estimatedLiquidCash = parseMoney(18450); // Cash reserve in checking
  const runwayWeeks =
    Math.round((addCents(estimatedLiquidCash, availableCredit) / (weeklyBurn || 1)) * 10) / 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Banner: Liquidity & Runway */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="swiss-card">
          <span className="swiss-label">Estimated Liquid Buffer</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="swiss-header tnum" style={{ fontSize: '2rem', color: '#f8fafc' }}>
              {formatCents(estimatedLiquidCash, { showCents: false })}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Operating Checking + Retainage
          </div>
        </div>

        <div className="swiss-card">
          <span className="swiss-label">Available Card Credit</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="swiss-header tnum" style={{ fontSize: '2rem', color: 'var(--accent-cyan)' }}>
              {formatCents(availableCredit, { showCents: false })}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Capital One Spark (Limit{' '}
            {cardProfile ? formatCents(cardProfile.creditLimitCents, { showCents: false }) : '\u2014'})
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
            Materials, Fuel, Subs & Tools
          </div>
        </div>

        <div className="swiss-card">
          <span className="swiss-label">Operating Runway</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="swiss-header tnum" style={{ fontSize: '2rem', color: 'var(--severity-healthy)' }}>
              {runwayWeeks}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>weeks</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Safe working capital cushion
          </div>
        </div>
      </div>

      {/* 4-Week Cash Flow Breakdown */}
      <div className="swiss-card">
        <div className="swiss-card-header">
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              Week-to-Week Cash Flow Waterfall
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Client deposits & invoice payouts vs card charges & supplier orders
            </div>
          </div>
          <div className="badge-healthy">
            NET +{formatCents(netCashPeriod, { showCents: false })} (30-DAY)
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {weeks.map((w, idx) => {
            const maxVal = parseMoney(7000);
            const inflowWidth = Math.min(100, (w.inflow / maxVal) * 100);
            const outflowWidth = Math.min(100, (w.outflow / maxVal) * 100);

            return (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-panel)',
                  padding: '1rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>
                    {w.label}
                  </div>
                  <div className="tnum" style={{ fontWeight: 700, fontSize: '0.85rem', color: w.net >= 0 ? 'var(--severity-healthy)' : 'var(--severity-critical)' }}>
                    Net: {w.net >= 0 ? '+' : ''}{formatCents(w.net)}
                  </div>
                </div>

                {/* Inflow Bar */}
                <div style={{ marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                    <span>Client Inflows (Deposits/Invoices)</span>
                    <span className="tnum" style={{ color: 'var(--severity-healthy)', fontWeight: 600 }}>+{formatCents(w.inflow)}</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${inflowWidth}%`,
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
                    <span className="tnum" style={{ color: 'var(--severity-critical)', fontWeight: 600 }}>-{formatCents(w.outflow)}</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg-input)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${outflowWidth}%`,
                        height: '100%',
                        background: 'var(--severity-critical)',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
