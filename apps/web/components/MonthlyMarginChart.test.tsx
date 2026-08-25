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
});
