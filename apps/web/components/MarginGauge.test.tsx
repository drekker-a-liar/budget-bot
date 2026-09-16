// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMoney, THRESHOLDS } from '@budget-bot/core';
import { aKpi } from '@/test/helpers/props';
import { MarginGauge } from './MarginGauge';

/**
 * The gauge is a cost structure drawn to scale, so the thing worth pinning is
 * the arithmetic that turns cents into widths - and that the profit segment
 * takes the colour the severity earned, because that colour is the whole
 * reason a contractor looks at this bar rather than at the numbers.
 */

afterEach(cleanup);

/** The segments carry a `title`; that is how a reader identifies them too. */
function segment(prefix: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[title^="${prefix}"]`);
  if (!found) throw new Error(`no gauge segment titled "${prefix}..."`);
  return found;
}

describe('MarginGauge', () => {
  it('sizes each segment as its share of revenue', () => {
    render(
      <MarginGauge
        kpi={aKpi({
          revenueCents: parseMoney(4000),
          actualMaterialsCostCents: parseMoney(1000), // 25%
          actualLaborCostCents: parseMoney(800), // 20%
          subcontractorCostCents: parseMoney(200), // 5% with other
          otherDirectCostsCents: parseMoney(0),
          grossProfitCents: parseMoney(2000),
        })}
      />
    );

    expect(segment('Materials')).toHaveStyle({ width: '25%' });
    expect(segment('Labor')).toHaveStyle({ width: '20%' });
    expect(segment('Subs & Disposal')).toHaveStyle({ width: '5%' });
    // Whatever revenue the costs did not consume is profit: 100 - 25 - 20 - 5.
    expect(segment('Profit Margin')).toHaveStyle({ width: '50%' });
  });

  it.each([
    ['healthy' as const, 'var(--severity-healthy)'],
    ['caution' as const, 'var(--severity-caution)'],
    ['critical' as const, 'var(--severity-critical)'],
  ])('paints the profit segment %s', (grossMarginSeverity, expected) => {
    render(<MarginGauge kpi={aKpi({ grossMarginSeverity })} />);

    expect(segment('Profit Margin')).toHaveStyle({ backgroundColor: expected });
  });

  it('reports the margin percentage the KPI carries, not one of its own', () => {
    render(<MarginGauge kpi={aKpi({ grossMarginPct: 33.3 })} />);

    expect(screen.getByText(/33\.3%/)).toBeInTheDocument();
  });

  it('draws a job with no revenue as all profit rather than dividing by zero', () => {
    // A quote with nothing invoiced yet: the bar has to render something, and
    // NaN% would render as an empty div with no explanation.
    render(
      <MarginGauge
        kpi={aKpi({
          revenueCents: parseMoney(0),
          actualMaterialsCostCents: parseMoney(0),
          actualLaborCostCents: parseMoney(0),
          subcontractorCostCents: parseMoney(0),
          otherDirectCostsCents: parseMoney(0),
          grossProfitCents: parseMoney(0),
        })}
      />
    );

    expect(segment('Profit Margin')).toHaveStyle({ width: '100%' });
  });

  it('shows an em dash, not "null%", for a job with no revenue to take a margin of', () => {
    // A quote with nothing invoiced has no margin. The legend used to
    // interpolate the field straight into the string, which for a zero-quote
    // job printed "(null%)" next to a real dollar figure.
    render(<MarginGauge kpi={aKpi({ grossMarginPct: null, grossMarginSeverity: null })} />);

    expect(screen.getByText(/Profit Margin:/).textContent).toContain('(—)');
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it('draws the target notch where the healthy-margin threshold puts it', () => {
    // The notch is the cost ceiling that still leaves THRESHOLDS.GROSS_MARGIN.HEALTHY
    // as profit. It was once typed as 55%; if the threshold moves and the line
    // does not, the bar contradicts the badge next to it.
    render(<MarginGauge kpi={aKpi()} />);
    const notch = segment('Target Cost Ceiling');

    expect(notch).toHaveStyle({ left: `${100 - THRESHOLDS.GROSS_MARGIN.HEALTHY}%` });
    expect(notch.getAttribute('title')).toContain(`${THRESHOLDS.GROSS_MARGIN.HEALTHY}% Margin`);
  });

  it('hides the legend when the caller only wants the bar', () => {
    render(<MarginGauge kpi={aKpi()} showLabels={false} />);

    expect(screen.queryByText(/Profit Margin:/)).not.toBeInTheDocument();
    expect(segment('Profit Margin')).toBeInTheDocument();
  });
});
