'use client';

import React from 'react';
import { addCents, formatCents, ProjectFinancialKPIs, THRESHOLDS } from '@budget-bot/core';
import { SeverityBadge } from './SeverityBadge';

interface MarginGaugeProps {
  kpi: ProjectFinancialKPIs;
  showLabels?: boolean;
}

export function MarginGauge({ kpi, showLabels = true }: MarginGaugeProps) {
  const otherCostsCents = addCents(kpi.subcontractorCostCents, kpi.otherDirectCostsCents);
  const revenue = kpi.revenueCents > 0 ? kpi.revenueCents : 1;
  const materialsPct = Math.min(100, Math.round((kpi.actualMaterialsCostCents / revenue) * 1000) / 10);
  const laborPct = Math.min(100 - materialsPct, Math.round((kpi.actualLaborCostCents / revenue) * 1000) / 10);
  const otherPct = Math.min(
    100 - materialsPct - laborPct,
    Math.round((otherCostsCents / revenue) * 1000) / 10
  );
  const profitPct = Math.max(0, 100 - materialsPct - laborPct - otherPct);

  // The notch marks the direct-cost ceiling that still leaves a healthy margin.
  // It is derived from the threshold rather than typed as 55 so that a change
  // to THRESHOLDS moves the line and the badge together; a marker that stays
  // put while the badge turns yellow would be worse than no marker at all.
  const costCeilingPct = 100 - THRESHOLDS.GROSS_MARGIN.HEALTHY;

  // Severity color for profit section
  let profitColor = 'var(--severity-healthy)';
  if (kpi.grossMarginSeverity === 'caution') profitColor = 'var(--severity-caution)';
  if (kpi.grossMarginSeverity === 'critical') profitColor = 'var(--severity-critical)';

  return (
    <div style={{ width: '100%' }}>
      {/* Gauge Bar */}
      <div
        style={{
          width: '100%',
          height: '14px',
          backgroundColor: 'var(--bg-input)',
          borderRadius: '4px',
          overflow: 'hidden',
          display: 'flex',
          border: '1px solid var(--border-subtle)',
          position: 'relative',
        }}
      >
        {/* Materials Segment */}
        {materialsPct > 0 && (
          <div
            style={{
              width: `${materialsPct}%`,
              backgroundColor: 'var(--accent-cyan)',
              height: '100%',
              transition: 'width 0.3s ease',
            }}
            title={`Materials: ${formatCents(kpi.actualMaterialsCostCents)} (${materialsPct}%)`}
          />
        )}

        {/* Labor Segment */}
        {laborPct > 0 && (
          <div
            style={{
              width: `${laborPct}%`,
              backgroundColor: 'var(--accent-indigo)',
              height: '100%',
              transition: 'width 0.3s ease',
            }}
            title={`Labor: ${formatCents(kpi.actualLaborCostCents)} (${laborPct}%)`}
          />
        )}

        {/* Other / Subs Segment */}
        {otherPct > 0 && (
          <div
            style={{
              width: `${otherPct}%`,
              backgroundColor: 'var(--text-muted)',
              height: '100%',
              transition: 'width 0.3s ease',
            }}
            title={`Subs & Disposal: ${formatCents(otherCostsCents)} (${otherPct}%)`}
          />
        )}

        {/* Gross Profit Margin Segment */}
        {profitPct > 0 && (
          <div
            style={{
              width: `${profitPct}%`,
              backgroundColor: profitColor,
              height: '100%',
              transition: 'width 0.3s ease',
            }}
            title={`Profit Margin: ${formatCents(kpi.grossProfitCents)} (${profitPct}%)`}
          />
        )}

        {/* Target margin notch line */}
        <div
          style={{
            position: 'absolute',
            left: `${costCeilingPct}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: 'var(--text-bright)',
            opacity: 0.7,
            zIndex: 2,
          }}
          title={`Target Cost Ceiling (${costCeilingPct}% / ${THRESHOLDS.GROSS_MARGIN.HEALTHY}% Margin)`}
        />
      </div>

      {/* Legend & Breakdown */}
      {showLabels && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.72rem',
            color: 'var(--text-secondary)',
            marginTop: '0.5rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: 'var(--accent-cyan)' }} />
              Materials: <strong className="tnum" style={{ color: 'var(--text-primary)' }}>{formatCents(kpi.actualMaterialsCostCents)}</strong> ({materialsPct}%)
            </span>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: 'var(--accent-indigo)' }} />
              Labor: <strong className="tnum" style={{ color: 'var(--text-primary)' }}>{formatCents(kpi.actualLaborCostCents)}</strong> ({laborPct}%)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: profitColor }} />
            Profit Margin: <strong className="tnum" style={{ color: profitColor }}>{formatCents(kpi.grossProfitCents)} ({kpi.grossMarginPct === null ? '—' : `${kpi.grossMarginPct}%`})</strong>
          </div>
        </div>
      )}
    </div>
  );
}
