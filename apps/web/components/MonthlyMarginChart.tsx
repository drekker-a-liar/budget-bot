'use client';

import React from 'react';
import type { MonthlyMargin } from '@budget-bot/core';

/**
 * Trailing-12-month gross margin, cash basis, as a hand-rolled SVG (spec §4:
 * no chart library - d3-scale/d3-shape are used only for the scales and the
 * line path generator, every element below is written JSX).
 */

interface MonthlyMarginChartProps {
  /** Oldest first; the last entry is always the current month to date (spec §3). */
  months: MonthlyMargin[];
  caption?: string;
}

const DEFAULT_CAPTION = 'Cash basis: paid invoices vs. posted costs.';

export function MonthlyMarginChart({ months, caption = DEFAULT_CAPTION }: MonthlyMarginChartProps) {
  // Nothing to draw a shape from is not the same as a zero chart: a bar at
  // 0% height reads as "we checked and there is nothing", a blank card reads
  // as "we forgot to check". Say which one this is.
  const isEmpty = months.every((month) => month.revenueCents === 0 && month.cogs.total === 0);

  return (
    <div className="swiss-card">
      <div className="swiss-card-header">
        <div>
          <div className="swiss-header" style={{ fontSize: '1.05rem', fontWeight: 800 }}>
            Monthly Gross Margin
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{caption}</div>
        </div>
      </div>

      {isEmpty ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          No paid invoices yet
        </div>
      ) : null}
    </div>
  );
}
