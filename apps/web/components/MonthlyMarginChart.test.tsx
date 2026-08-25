// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('MonthlyMarginChart', () => {
  describe('empty state', () => {
    it('says there is nothing to show rather than drawing a zero chart', () => {
      render(
        <MonthlyMarginChart
          months={[
            aMonthlyMargin({
              month: '2026-08',
              revenueCents: 0,
              cogs: { materials: 0, labor: 0, subcontractor: 0, otherDirect: 0, total: 0 },
              marginCents: 0,
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
});
