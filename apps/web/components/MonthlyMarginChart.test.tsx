// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { aMonthlyMargin } from '@/test/helpers/props';
import { MonthlyMarginChart } from './MonthlyMarginChart';

/**
 * `MonthlyMarginChart` is presentational: every figure on it - the bars, the
 * margin-% line, the trailing-12 KPI header - comes from the `months` prop,
 * oldest first, with the last entry always the current month to date (spec
 * §3). These tests care about the same things the neighbouring components'
 * do: that the chart draws what its props say and nothing it invented, and
 * that a month with nothing in it renders as an honest empty state rather
 * than a zero-height bar nobody can distinguish from "we checked and it was
 * zero" (spec §4, §5).
 */

afterEach(cleanup);

/** The chart's own month-label format ("Aug 26"), duplicated here so titles are checkable. */
function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

const ZERO_COGS = {
  materials: parseMoney(0),
  labor: parseMoney(0),
  subcontractor: parseMoney(0),
  otherDirect: parseMoney(0),
  total: parseMoney(0),
};

/**
 * Five months: three with distinct severities, one with zero revenue (a
 * `marginPct` of null, severity `'none'`), and a last one standing in for
 * the current month to date - the shape `getMonthlyMargins` always hands the
 * chart (spec §3): trailing full months, then MTD, oldest first.
 */
const MONTHS = [
  aMonthlyMargin({
    month: '2026-04',
    revenueCents: parseMoney(4000),
    marginCents: parseMoney(2000),
    marginPct: 50,
    severity: 'healthy',
  }),
  aMonthlyMargin({
    month: '2026-05',
    revenueCents: parseMoney(4000),
    marginCents: parseMoney(1200),
    marginPct: 30,
    severity: 'caution',
  }),
  aMonthlyMargin({
    month: '2026-06',
    revenueCents: parseMoney(4000),
    marginCents: parseMoney(400),
    marginPct: 10,
    severity: 'critical',
  }),
  aMonthlyMargin({
    month: '2026-07',
    revenueCents: parseMoney(0),
    cogs: ZERO_COGS,
    marginCents: parseMoney(0),
    marginPct: null,
    severity: 'none',
  }),
  aMonthlyMargin({
    month: '2026-08',
    revenueCents: parseMoney(9000),
    marginCents: parseMoney(4500),
    marginPct: 50,
    severity: 'healthy',
  }),
];

/**
 * A bar's identity lives in its child `<title>` (the SVG a11y idiom the spec
 * calls for, unlike the HTML `title` attribute `MarginGauge`'s divs use) -
 * so look a bar up by that text instead of an attribute selector.
 */
function barTitled(prefix: string): SVGElement {
  const titleEl = Array.from(document.querySelectorAll('title')).find((el) =>
    (el.textContent ?? '').startsWith(prefix)
  );
  if (!titleEl?.parentElement) throw new Error(`no bar titled "${prefix}..."`);
  return titleEl.parentElement as unknown as SVGElement;
}

describe('MonthlyMarginChart', () => {
  describe('empty state', () => {
    it('says there is nothing to show rather than drawing a zero chart', () => {
      render(
        <MonthlyMarginChart
          months={[
            aMonthlyMargin({
              month: '2026-08',
              revenueCents: parseMoney(0),
              cogs: ZERO_COGS,
              marginCents: parseMoney(0),
              marginPct: null,
              severity: 'none',
            }),
          ]}
        />
      );

      expect(screen.getByText('No paid invoices yet')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('is empty vacuously when there are no months at all', () => {
      render(<MonthlyMarginChart months={[]} />);

      expect(screen.getByText('No paid invoices yet')).toBeInTheDocument();
    });
  });

  describe('caption', () => {
    it('renders the spec sentence verbatim by default', () => {
      render(<MonthlyMarginChart months={[aMonthlyMargin()]} />);

      expect(
        screen.getByText('Cash basis: paid invoices vs. posted costs.')
      ).toBeInTheDocument();
    });

    it('lets a caller override the caption', () => {
      render(<MonthlyMarginChart months={[aMonthlyMargin()]} caption="Custom caption text." />);

      expect(screen.getByText('Custom caption text.')).toBeInTheDocument();
      expect(
        screen.queryByText('Cash basis: paid invoices vs. posted costs.')
      ).not.toBeInTheDocument();
    });
  });

  describe('bars', () => {
    it('draws one revenue bar and one margin bar per month', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      expect(container.querySelectorAll('.revenue-bar')).toHaveLength(MONTHS.length);
      expect(container.querySelectorAll('.margin-bar')).toHaveLength(MONTHS.length);
    });

    it('paints every revenue bar the same muted treatment, whatever the month', () => {
      render(<MonthlyMarginChart months={MONTHS} />);

      for (const month of MONTHS) {
        expect(barTitled(`${monthLabel(month.month)} revenue`)).toHaveStyle({
          fill: 'var(--text-muted)',
        });
      }
    });

    it.each([
      ['2026-04', 'healthy' as const, 'var(--severity-healthy)'],
      ['2026-05', 'caution' as const, 'var(--severity-caution)'],
      ['2026-06', 'critical' as const, 'var(--severity-critical)'],
    ])('fills the %s margin bar with the %s severity token', (month, _severity, expectedFill) => {
      render(<MonthlyMarginChart months={MONTHS} />);

      expect(barTitled(`${monthLabel(month)} margin`)).toHaveStyle({ fill: expectedFill });
    });

    it('gives a zero-revenue month a neutral fill, not a fabricated severity', () => {
      render(<MonthlyMarginChart months={MONTHS} />);

      expect(barTitled(`${monthLabel('2026-07')} margin`)).not.toHaveStyle({
        fill: 'var(--severity-healthy)',
      });
      expect(barTitled(`${monthLabel('2026-07')} margin`)).not.toHaveStyle({
        fill: 'var(--severity-caution)',
      });
      expect(barTitled(`${monthLabel('2026-07')} margin`)).not.toHaveStyle({
        fill: 'var(--severity-critical)',
      });
    });

    it('gives every bar a title identifying its month, dollars, and percentage', () => {
      render(<MonthlyMarginChart months={MONTHS} />);

      expect(
        barTitled(`${monthLabel('2026-04')} revenue`).querySelector('title')?.textContent
      ).toBe(`${monthLabel('2026-04')} revenue: $4,000.00`);
      expect(
        barTitled(`${monthLabel('2026-04')} margin`).querySelector('title')?.textContent
      ).toBe(`${monthLabel('2026-04')} margin: $2,000.00 (50%)`);
    });

    it('reads a null margin percentage as an em dash, not a blank', () => {
      render(<MonthlyMarginChart months={MONTHS} />);

      expect(
        barTitled(`${monthLabel('2026-07')} margin`).querySelector('title')?.textContent
      ).toBe(`${monthLabel('2026-07')} margin: $0.00 (—)`);
    });
  });

  describe('margin-% line', () => {
    it('plots one point per month that has a margin percentage', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      // Four of the five months have a marginPct; 2026-07's is null (zero
      // revenue), and null.defined() in the d3-shape line generator means
      // that month draws no point and breaks the line rather than
      // interpolating through a percentage that was never computed.
      expect(container.querySelectorAll('.margin-point')).toHaveLength(4);
    });

    it('draws no point for the null-percentage month specifically', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      const points = Array.from(container.querySelectorAll('.margin-point'));
      expect(points).toHaveLength(4);
      expect(points.some((point) => point.getAttribute('data-month') === '2026-07')).toBe(false);
    });

    it('draws a single connected path for the line', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      const path = container.querySelector('path.margin-line');
      expect(path).toBeInTheDocument();
      expect(path?.getAttribute('d')).toBeTruthy();
    });
  });

  describe('current month to date', () => {
    it('hatches only the last month - the one standing in for MTD', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      const hatched = container.querySelectorAll('.mtd-hatch');
      expect(hatched).toHaveLength(1);
      expect(hatched[0].getAttribute('data-month')).toBe('2026-08');
    });

    it('labels only the last month "MTD"', () => {
      render(<MonthlyMarginChart months={MONTHS} />);

      expect(screen.getAllByText('MTD')).toHaveLength(1);
    });
  });

  describe('reference lines', () => {
    it('draws dashed lines at 45% and 25% on the percentage axis', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      const lines = container.querySelectorAll('.margin-reference-line');
      const values = Array.from(lines).map((line) => line.getAttribute('data-value'));
      expect(values.sort()).toEqual(['25', '45']);
      lines.forEach((line) => {
        expect(line.getAttribute('stroke-dasharray')).toBeTruthy();
      });
    });
  });

  describe('KPI header', () => {
    it('sums only the trailing full months, excluding the current month to date', () => {
      render(<MonthlyMarginChart months={MONTHS} />);

      // Full months (2026-04 through -07): $4,000 + $4,000 + $4,000 + $0
      // revenue, $2,000 + $1,200 + $400 + $0 margin. Including 2026-08's
      // $9,000/$4,500 MTD figures would change both totals and the blended
      // percentage - this is the fixture that would catch that mistake.
      expect(screen.getByText('Trailing 12 months')).toBeInTheDocument();
      expect(screen.getByText('$12,000')).toBeInTheDocument();
      expect(screen.getByText('$3,600')).toBeInTheDocument();
      expect(screen.getByText('30%')).toBeInTheDocument();
      expect(screen.queryByText('$21,000')).not.toBeInTheDocument();
      expect(screen.queryByText('$8,100')).not.toBeInTheDocument();
    });

    it('shows an em dash for blended margin when the full months had no revenue', () => {
      render(
        <MonthlyMarginChart
          months={[
            aMonthlyMargin({
              month: '2026-07',
              revenueCents: parseMoney(0),
              cogs: ZERO_COGS,
              marginCents: parseMoney(0),
              marginPct: null,
              severity: 'none',
            }),
            aMonthlyMargin({
              month: '2026-08',
              revenueCents: parseMoney(5000),
              marginCents: parseMoney(2500),
              marginPct: 50,
              severity: 'healthy',
            }),
          ]}
        />
      );

      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('computes blended margin as the ratio of the trailing totals, not an average of monthly percentages', () => {
      render(
        <MonthlyMarginChart
          months={[
            aMonthlyMargin({
              month: '2026-06',
              revenueCents: parseMoney(1000),
              marginCents: parseMoney(500),
              marginPct: 50,
              severity: 'healthy',
            }),
            aMonthlyMargin({
              month: '2026-07',
              revenueCents: parseMoney(9000),
              marginCents: parseMoney(900),
              marginPct: 10,
              severity: 'critical',
            }),
            aMonthlyMargin({
              month: '2026-08',
              revenueCents: parseMoney(2000),
              marginCents: parseMoney(1000),
              marginPct: 50,
              severity: 'healthy',
            }),
          ]}
        />
      );

      // Full months: $1,000/$500 (50%) and $9,000/$900 (10%). The ratio of
      // totals is $1,400 / $10,000 = 14% - the correct blended figure.
      // Averaging the two months' own percentages instead - (50 + 10) / 2 -
      // gives 30%, a different number this unequal-revenue fixture can tell
      // apart from the right one (equal-revenue months can't: both formulas
      // land on the same value by coincidence).
      expect(screen.getByText('14%')).toBeInTheDocument();
      expect(screen.queryByText('30%')).not.toBeInTheDocument();
    });
  });

  describe('loss months', () => {
    it('draws a negative margin below the baseline, not as a negative-height rect', () => {
      const { container } = render(
        <MonthlyMarginChart
          months={[
            aMonthlyMargin({
              month: '2026-06',
              revenueCents: parseMoney(4000),
              marginCents: parseMoney(-1500),
              marginPct: -37.5,
              severity: 'critical',
            }),
            aMonthlyMargin({
              month: '2026-07',
              revenueCents: parseMoney(5000),
              marginCents: parseMoney(2500),
              marginPct: 50,
              severity: 'healthy',
            }),
          ]}
        />
      );

      // The shared money scale's baseline is wherever $0 maps to; a positive
      // month's revenue bar always runs from that baseline up to its own
      // top, so its bottom edge (y + height) is the baseline in pixels -
      // read it off the loss month's own revenue bar rather than
      // recomputing the scale here.
      const lossRevenueBar = barTitled(`${monthLabel('2026-06')} revenue`);
      const baselineY =
        Number(lossRevenueBar.getAttribute('y')) + Number(lossRevenueBar.getAttribute('height'));

      const lossMarginBar = barTitled(`${monthLabel('2026-06')} margin`);
      const marginY = Number(lossMarginBar.getAttribute('y'));
      const marginHeight = Number(lossMarginBar.getAttribute('height'));

      // SVG has no negative-height rects: a loss bar's top sits at the
      // baseline and its (always positive) height extends downward from it.
      expect(marginHeight).toBeGreaterThan(0);
      expect(marginY).toBeCloseTo(baselineY, 5);

      // -37.5% is below +50% on the percent axis (larger y is lower on an
      // SVG y-axis), not clipped at 0% or dropped from the line entirely.
      const lossPoint = container.querySelector('.margin-point[data-month="2026-06"]');
      const healthyPoint = container.querySelector('.margin-point[data-month="2026-07"]');
      expect(lossPoint).toBeInTheDocument();
      expect(Number(lossPoint?.getAttribute('cy'))).toBeGreaterThan(
        Number(healthyPoint?.getAttribute('cy'))
      );
      expect(container.querySelector('path.margin-line')?.getAttribute('d')).toBeTruthy();
    });
  });

  describe('single month (MTD only, no full month behind it yet)', () => {
    it('renders without a completed month and reports the KPI header as zero', () => {
      render(
        <MonthlyMarginChart
          months={[
            aMonthlyMargin({
              month: '2026-08',
              revenueCents: parseMoney(3000),
              marginCents: parseMoney(1200),
              marginPct: 40,
              severity: 'caution',
            }),
          ]}
        />
      );

      // `fullMonths` (`months.slice(0, -1)`) is empty when the only entry is
      // the current month to date - nothing to sum, so the header shows $0
      // revenue, $0 margin, and a null (0/0) blended percentage as an em
      // dash rather than a fabricated number.
      expect(screen.getAllByText('$0')).toHaveLength(2);
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('summarizes the latest full month in the chart’s accessible name', () => {
      const { container } = render(<MonthlyMarginChart months={MONTHS} />);

      const svg = container.querySelector('svg[role="img"]');
      expect(svg?.getAttribute('aria-label')).toContain(monthLabel('2026-07'));
    });
  });
});
