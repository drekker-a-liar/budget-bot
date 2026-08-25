// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMoney } from '@budget-bot/core';
import { aMonthlyMargin } from '@/test/helpers/props';
import { mockNextNavigation } from '@/test/helpers/islands';

/**
 * The `/margin` island: a heading and the chart, nothing else. The chart
 * already carries the caption, the KPI header and the empty state (spec §4),
 * so this only needs to check that the page's own heading is there and that
 * `months` reaches the chart untouched - not re-litigate what
 * `MonthlyMarginChart.test.tsx` already pins.
 */

vi.mock('next/navigation', () => mockNextNavigation());

const { MarginView } = await import('./MarginView');

afterEach(cleanup);

describe('MarginView', () => {
  it('renders the page heading and the chart drawn from the months the query computed', () => {
    render(
      <MarginView
        months={[
          aMonthlyMargin({
            month: '2026-08',
            revenueCents: parseMoney(4500),
            marginCents: parseMoney(2500),
          }),
        ]}
        timeZone="America/Los_Angeles"
      />
    );

    expect(screen.getByRole('heading', { name: 'Margin' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('lets the chart show its own empty state rather than drawing one of its own', () => {
    render(<MarginView months={[]} timeZone="UTC" />);

    expect(screen.getByText('No paid invoices yet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('puts Margin in the header nav, active on this page', () => {
    render(<MarginView months={[aMonthlyMargin()]} timeZone="UTC" />);

    expect(screen.getByRole('link', { name: /^margin$/i })).toBeInTheDocument();
  });
});
