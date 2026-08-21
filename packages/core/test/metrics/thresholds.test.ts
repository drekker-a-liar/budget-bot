import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS,
  getGrossMarginSeverity,
  getHourlySeverity,
  getMaterialMarkupSeverity,
  getBudgetSeverity,
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
});
