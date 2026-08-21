// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMoney, type WeeklyCashFlow } from '@budget-bot/core';
import { CashFlowWaterfall } from './CashFlowWaterfall';

/**
 * The waterfall used to contain four weeks of hardcoded literals and an
 * `estimatedLiquidCash = 18450` that was nobody's bank balance, all rendered
 * next to real figures and indistinguishable from them. So the thing these
 * tests are really for is that every number on it came from a prop, and that
 * what cannot be computed reads as an em dash rather than as a plausible
 * default.
 */

afterEach(cleanup);

const week = (weekStart: string, inflow: number, outflow: number): WeeklyCashFlow => ({
  weekStart,
  inflowCents: parseMoney(inflow),
  outflowCents: parseMoney(outflow),
  netCents: parseMoney(inflow - outflow),
});

const WEEKS = [
  week('2026-07-27', 2500, 1450.65),
  week('2026-08-03', 6800, 2162.2),
  week('2026-08-10', 1950, 1124.6),
  week('2026-08-17', 1800, 1188.75),
];

function bar(kind: 'Inflow' | 'Outflow', formatted: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[title="${kind} ${formatted}"]`);
  if (!found) throw new Error(`no ${kind} bar for ${formatted}`);
  return found;
}

describe('CashFlowWaterfall', () => {
  it('labels each week by the days it covers, from the Monday it starts on', () => {
    render(<CashFlowWaterfall weeks={WEEKS} />);

    expect(screen.getByText('Jul 27 - Aug 02')).toBeInTheDocument();
    expect(screen.getByText('Aug 17 - Aug 23')).toBeInTheDocument();
  });

  it('renders each week from its own figures', () => {
    render(<CashFlowWaterfall weeks={[week('2026-08-17', 1800, 1188.75)]} />);

    expect(screen.getByText('+$1,800.00')).toBeInTheDocument();
    expect(screen.getByText('-$1,188.75')).toBeInTheDocument();
    expect(screen.getByText('Net: +$611.25')).toBeInTheDocument();
  });

  it('shows a losing week as a negative net', () => {
    render(<CashFlowWaterfall weeks={[week('2026-08-17', 500, 1200)]} />);

    expect(screen.getByText('Net: -$700.00')).toBeInTheDocument();
  });

  it('scales the bars against the largest figure in the window', () => {
    render(<CashFlowWaterfall weeks={WEEKS} />);

    // $6,800 is the biggest thing in the period, so it is the full width and
    // everything else is read against it.
    expect(bar('Inflow', '$6,800.00')).toHaveStyle({ width: '100%' });
    expect(bar('Outflow', '$1,450.65')).toHaveStyle({
      width: `${(145065 / 680000) * 100}%`,
    });
  });

  it('totals the period, and says whether it was up or down', () => {
    render(<CashFlowWaterfall weeks={WEEKS} />);

    // 13,050 in against 5,926.20 out.
    expect(screen.getByText(/NET \+\$7,124/)).toBeInTheDocument();
  });

  it('reports a period that lost money as a loss, not as a negative gain', () => {
    render(<CashFlowWaterfall weeks={[week('2026-08-17', 100, 900)]} />);

    const badge = screen.getByText(/NET -\$800/);
    expect(badge).toHaveClass('badge-critical');
  });

  it('averages the outflow over the weeks it was given', () => {
    render(<CashFlowWaterfall weeks={WEEKS} />);

    // 5,926.20 over four weeks.
    expect(screen.getByText('$1,482')).toBeInTheDocument();
  });

  describe('what it will not invent', () => {
    it('shows an em dash for the credit on a card nobody has linked', () => {
      render(<CashFlowWaterfall weeks={WEEKS} />);

      expect(screen.getByText('No card linked yet')).toBeInTheDocument();
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('shows no runway when there is no credit line to run on', () => {
      render(<CashFlowWaterfall weeks={WEEKS} />);

      expect(screen.getByText('Needs a linked card and some spend')).toBeInTheDocument();
      expect(screen.queryByText('weeks')).not.toBeInTheDocument();
    });

    it('computes the runway once there is a card and some spend', () => {
      render(
        <CashFlowWaterfall
          weeks={WEEKS}
          availableCreditCents={parseMoney(21751.35)}
          creditLimitCents={parseMoney(25000)}
        />
      );

      // $21,751.35 of credit at $1,481.55 a week.
      expect(screen.getByText('14.7')).toBeInTheDocument();
      expect(screen.getByText('Limit $25,000')).toBeInTheDocument();
    });

    it('shows no runway when nothing has been spent to measure a burn from', () => {
      render(
        <CashFlowWaterfall
          weeks={[week('2026-08-17', 1000, 0)]}
          availableCreditCents={parseMoney(21751.35)}
        />
      );

      expect(screen.queryByText('weeks')).not.toBeInTheDocument();
    });

    it('says there is nothing to show rather than drawing an empty chart', () => {
      render(<CashFlowWaterfall weeks={[]} />);

      expect(screen.getByText('No cash movement recorded yet.')).toBeInTheDocument();
    });
  });
});
