'use client';

import React from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { formatCents, type MonthlyMargin, type SeverityLevel } from '@budget-bot/core';

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
const EM_DASH = '—';

const WIDTH = 880;
const HEIGHT = 320;
const PLOT_MARGIN = { top: 16, right: 56, bottom: 40, left: 64 };
const PLOT_WIDTH = WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right;
const PLOT_HEIGHT = HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom;

/** "Aug 26" - short enough to fit 13 months of ticks without crowding. */
function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/** `55.6` -> `"55.6%"`; null (zero revenue, spec §2) -> an em dash, never a fabricated number. */
function pctLabel(pct: number | null): string {
  return pct === null ? EM_DASH : `${pct}%`;
}

/** The margin bar's fill: the same `var(--severity-*)` tokens `MarginGauge` paints its segments with. */
function severityFill(severity: SeverityLevel | 'none'): string {
  if (severity === 'healthy') return 'var(--severity-healthy)';
  if (severity === 'caution') return 'var(--severity-caution)';
  if (severity === 'critical') return 'var(--severity-critical)';
  return 'var(--text-secondary)';
}

export function MonthlyMarginChart({ months, caption = DEFAULT_CAPTION }: MonthlyMarginChartProps) {
  // Nothing to draw a shape from is not the same as a zero chart: a bar at
  // 0% height reads as "we checked and there is nothing", a blank card reads
  // as "we forgot to check". Say which one this is.
  const isEmpty = months.every((month) => month.revenueCents === 0 && month.cogs.total === 0);

  let chart: React.ReactNode = null;

  if (!isEmpty) {
    const xScale = scaleBand<string>()
      .domain(months.map((month) => month.month))
      .range([0, PLOT_WIDTH])
      .paddingInner(0.35)
      .paddingOuter(0.2);

    // One shared money scale for both bar series, so a margin bar is always
    // legible against the revenue bar it sits in front of. Domain reaches
    // below zero when a month's margin is a loss, so that bar draws downward
    // from the baseline instead of clipping at it.
    const moneyValues = months.flatMap((month) => [month.revenueCents, month.marginCents]);
    const moneyScale = scaleLinear()
      .domain([Math.min(0, ...moneyValues), Math.max(1, ...moneyValues)])
      .range([PLOT_HEIGHT, 0]);
    const baselineY = moneyScale(0);

    chart = (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" width="100%">
        <g transform={`translate(${PLOT_MARGIN.left}, ${PLOT_MARGIN.top})`}>
          {months.map((month) => {
            const bandX = xScale(month.month) ?? 0;
            const bandwidth = xScale.bandwidth();
            const label = monthLabel(month.month);

            const revenueTop = Math.min(moneyScale(month.revenueCents), baselineY);
            const revenueHeight = Math.abs(moneyScale(month.revenueCents) - baselineY);

            const marginBarWidth = bandwidth * 0.55;
            const marginBarX = bandX + (bandwidth - marginBarWidth) / 2;
            const marginTop = Math.min(moneyScale(month.marginCents), baselineY);
            const marginHeight = Math.abs(moneyScale(month.marginCents) - baselineY);

            return (
              <g key={month.month}>
                <rect
                  className="revenue-bar"
                  x={bandX}
                  y={revenueTop}
                  width={bandwidth}
                  height={revenueHeight}
                  style={{ fill: 'var(--text-muted)', opacity: 0.35 }}
                >
                  <title>{`${label} revenue: ${formatCents(month.revenueCents)}`}</title>
                </rect>
                <rect
                  className="margin-bar"
                  x={marginBarX}
                  y={marginTop}
                  width={marginBarWidth}
                  height={marginHeight}
                  style={{ fill: severityFill(month.severity) }}
                >
                  <title>{`${label} margin: ${formatCents(month.marginCents)} (${pctLabel(month.marginPct)})`}</title>
                </rect>
              </g>
            );
          })}
        </g>
      </svg>
    );
  }

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
      ) : (
        chart
      )}
    </div>
  );
}
