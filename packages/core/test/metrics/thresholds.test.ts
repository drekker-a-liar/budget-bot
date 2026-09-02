import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS,
  getGrossMarginSeverity,
  getHourlySeverity,
  getMaterialMarkupSeverity,
  getBudgetSeverity,
  getReceivablesAgeSeverity,
} from '../../src/metrics/thresholds';
import { parseMoney } from '../../src/money';

// CHARACTERIZATION: severity thresholds are the product's contract and must
// not move. Boundaries are asserted on both sides.

describe('severity thresholds (characterization)', () => {
  it('keeps the documented gross margin thresholds at 45% / 25%', () => {
    expect(THRESHOLDS.GROSS_MARGIN).toEqual({ HEALTHY: 45, CAUTION: 25 });
  });

  it.each([
    [45, 'healthy'],
    [44.9, 'caution'],
    [25, 'caution'],
    [24.9, 'critical'],
  ])('gross margin %s%% -> %s', (pct, expected) => {
    expect(getGrossMarginSeverity(pct)).toBe(expected);
  });

  it('states the hourly realization thresholds in cents per hour', () => {
    expect(THRESHOLDS.HOURLY_REALIZATION).toEqual({ HEALTHY: 8500, CAUTION: 5000 });
  });

  it.each([
    ['85.00', 'healthy'],
    ['84.99', 'caution'],
    ['50.00', 'caution'],
    ['49.99', 'critical'],
  ])('hourly realization $%s/hr -> %s', (rate, expected) => {
    expect(getHourlySeverity(parseMoney(rate))).toBe(expected);
  });

  it.each([
    [20, 'healthy'],
    [19.9, 'caution'],
    [10, 'caution'],
    [9.9, 'critical'],
  ])('materials markup %s%% -> %s', (pct, expected) => {
    expect(getMaterialMarkupSeverity(pct)).toBe(expected);
  });

  it.each([
    [90, 'healthy'],
    [90.1, 'caution'],
    [100, 'caution'],
    [100.1, 'critical'],
  ])('budget spend %s%% of quote -> %s', (pct, expected) => {
    expect(getBudgetSeverity(pct)).toBe(expected);
  });

  // These two numbers sat in THRESHOLDS unused for two phases while the
  // receivables badge graded on amount alone; now that the age of the oldest
  // overdue invoice feeds it, the boundaries are part of the contract too.
  it('keeps the documented receivables age thresholds at 14 / 30 days', () => {
    expect(THRESHOLDS.RECEIVABLES_OVERDUE_DAYS).toEqual({ HEALTHY: 14, CAUTION: 30 });
  });

  it.each([
    [1, 'healthy'],
    [13, 'healthy'],
    [14, 'caution'],
    [29, 'caution'],
    [30, 'critical'],
  ])('%s days past due -> %s', (days, expected) => {
    expect(getReceivablesAgeSeverity(days)).toBe(expected);
  });
});
