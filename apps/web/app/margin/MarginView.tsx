'use client';

import React from 'react';
import type { MonthlyMargin } from '@budget-bot/core';
import { MonthlyMarginChart } from '@/components/MonthlyMarginChart';
import { Navigation } from '@/components/Navigation';

/**
 * The interactive half of `/margin`: a heading and the chart.
 *
 * The chart already carries the caption, the trailing-12 KPI header and the
 * empty state (spec §4), so this island has nothing left to add - there is
 * no equivalent-to-cashflow's timezone caption on any neighbouring page
 * (spec §4 last paragraph), so it stays minimal rather than inventing one.
 */

interface MarginViewProps {
  months: MonthlyMargin[];
  timeZone: string;
}

export function MarginView({ months }: MarginViewProps) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
            Profitability
          </div>
          <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
            Margin
          </h1>
        </div>

        <MonthlyMarginChart months={months} />
      </div>
    </div>
  );
}
