import type { Cents } from '../money';
import { SeverityLevel } from '../types';

// Severity Threshold Constants
export const THRESHOLDS = {
  GROSS_MARGIN: {
    HEALTHY: 45, // >= 45% is green
    CAUTION: 25, // 25% - 44% is yellow, < 25% is red
  },
  // Rates are cents per hour, like every other money value (ADR 0007), and
  // branded as such so a display can hand them straight to `formatCents`.
  HOURLY_REALIZATION: {
    HEALTHY: 8500 as Cents, // >= $85.00/hr is green
    CAUTION: 5000 as Cents, // $50.00 - $84.99/hr is yellow, < $50.00 is red
  },
  MATERIAL_MARKUP: {
    HEALTHY: 20, // >= 20% is green
    CAUTION: 10, // 10% - 19% is yellow, < 10% is red
  },
  BUDGET_VARIANCE: {
    HEALTHY: 90, // <= 90% is green
    CAUTION: 100, // 91% - 100% is yellow, > 100% is red
  },
  RECEIVABLES_OVERDUE_DAYS: {
    HEALTHY: 14,
    CAUTION: 30,
  },
};

export function getGrossMarginSeverity(marginPct: number): SeverityLevel {
  if (marginPct >= THRESHOLDS.GROSS_MARGIN.HEALTHY) return 'healthy';
  if (marginPct >= THRESHOLDS.GROSS_MARGIN.CAUTION) return 'caution';
  return 'critical';
}

export function getHourlySeverity(hourlyRateCents: Cents): SeverityLevel {
  if (hourlyRateCents >= THRESHOLDS.HOURLY_REALIZATION.HEALTHY) return 'healthy';
  if (hourlyRateCents >= THRESHOLDS.HOURLY_REALIZATION.CAUTION) return 'caution';
  return 'critical';
}

export function getMaterialMarkupSeverity(markupPct: number): SeverityLevel {
  if (markupPct >= THRESHOLDS.MATERIAL_MARKUP.HEALTHY) return 'healthy';
  if (markupPct >= THRESHOLDS.MATERIAL_MARKUP.CAUTION) return 'caution';
  return 'critical';
}

export function getBudgetSeverity(spentRatioPct: number): SeverityLevel {
  if (spentRatioPct <= THRESHOLDS.BUDGET_VARIANCE.HEALTHY) return 'healthy';
  if (spentRatioPct <= THRESHOLDS.BUDGET_VARIANCE.CAUTION) return 'caution';
  return 'critical';
}
