import { SeverityLevel } from '../types';

// Severity Threshold Constants
export const THRESHOLDS = {
  GROSS_MARGIN: {
    HEALTHY: 45, // >= 45% is green
    CAUTION: 25, // 25% - 44% is yellow, < 25% is red
  },
  HOURLY_REALIZATION: {
    HEALTHY: 85, // >= $85/hr is green
    CAUTION: 50, // $50 - $84/hr is yellow, < $50 is red
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

export function getHourlySeverity(hourlyRate: number): SeverityLevel {
  if (hourlyRate >= THRESHOLDS.HOURLY_REALIZATION.HEALTHY) return 'healthy';
  if (hourlyRate >= THRESHOLDS.HOURLY_REALIZATION.CAUTION) return 'caution';
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
