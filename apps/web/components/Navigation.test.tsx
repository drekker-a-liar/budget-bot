// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMoney, type CardProfile } from '@budget-bot/core';
import { Navigation } from './Navigation';

/**
 * The header. Two things on it are load-bearing: the count of card charges
 * waiting to be filed - the one number that says there is work to do - and
 * which page the reader is on. `usePathname` is mocked because it is the
 * framework boundary this component sits on; everything else is real.
 */

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const CARD: CardProfile = {
  id: 'card-1',
  cardName: 'Spark Business Cash',
  issuer: 'Capital One',
  last4: '4892',
  cardType: 'credit',
  currentBalanceCents: parseMoney(3248.65),
  creditLimitCents: parseMoney(25000),
  cycleResetDay: 28,
  lastSyncedAt: '2026-08-19T18:30:00.000Z',
};

beforeEach(() => {
  pathname.current = '/';
});

afterEach(cleanup);

describe('Navigation', () => {
  it('badges the card inbox with the number of charges still unfiled', () => {
    render(<Navigation unassignedCount={3} />);

    const inbox = screen.getByRole('link', { name: /card inbox/i });
    expect(inbox).toHaveTextContent('3');
  });

  it('shows no badge at all when nothing is waiting', () => {
    // A zero badge is a red circle that means "relax", which nobody reads that
    // way. Absence is the correct rendering of nothing to do.
    render(<Navigation unassignedCount={0} />);

    expect(screen.getByRole('link', { name: /card inbox/i })).toHaveTextContent(
      /^Card Inbox$/
    );
  });

  it.each([
    ['/', 'Overview'],
    ['/projects', 'Projects & Margins'],
    ['/transactions', 'Card Inbox'],
    ['/cashflow', 'Cash Flow & Runway'],
    ['/margin', 'Margin'],
    ['/settings/connections', 'Connections'],
  ])('marks %s as the page being read', (path, label) => {
    pathname.current = path;
    render(<Navigation />);

    // Anchored: "Margin" is also a substring of "Projects & Margins", and an
    // unanchored match would find both links instead of the one this page is.
    const active = screen.getByRole('link', { name: new RegExp(`^${label}$`, 'i') });
    expect(active).toHaveStyle({ fontWeight: '700' });

    const other = screen.getByRole('link', {
      name: label === 'Overview' ? /projects & margins/i : /overview/i,
    });
    expect(other).not.toHaveStyle({ fontWeight: '700' });
  });

  it('offers the trailing-12-month margin page', () => {
    render(<Navigation />);

    expect(screen.getByRole('link', { name: /^margin$/i })).toHaveAttribute('href', '/margin');
  });

  it('shows the connected card and its balance when there is one', () => {
    render(<Navigation cardProfile={CARD} />);

    expect(screen.getByText(/4892/)).toBeInTheDocument();
    expect(screen.getByText('$3,248.65')).toBeInTheDocument();
  });

  it('calls the card what the bank calls it', () => {
    // It used to say "Spark" for everybody. That was true of one card on one
    // machine, and a wrong fact about a real card on every other deployment.
    render(<Navigation cardProfile={CARD} />);

    expect(screen.getByText(/Spark Business Cash ••• 4892/)).toBeInTheDocument();
  });

  it('falls back to the issuer when the bank gave the account no name', () => {
    render(<Navigation cardProfile={{ ...CARD, cardName: '' }} />);

    expect(screen.getByText(/Capital One ••• 4892/)).toBeInTheDocument();
  });

  it('still says something when the bank gave neither', () => {
    render(<Navigation cardProfile={{ ...CARD, cardName: '', issuer: '' }} />);

    expect(screen.getByText(/Card ••• 4892/)).toBeInTheDocument();
  });

  it('offers the connections screen, which is where a card comes from', () => {
    render(<Navigation />);

    expect(screen.getByRole('link', { name: /connections/i })).toHaveAttribute(
      'href',
      '/settings/connections'
    );
  });

  it('says nothing about a card before one is linked', () => {
    render(<Navigation cardProfile={null} />);

    expect(screen.queryByText(/•••/)).not.toBeInTheDocument();
  });

  it.each([
    [/\+ Receipt/, 'expense'],
    [/\+ Labor/, 'labor'],
    [/\+ New Project/, 'project'],
  ])('opens quick add on the %s tab', async (name, tab) => {
    const onOpenQuickAdd = vi.fn();
    render(<Navigation onOpenQuickAdd={onOpenQuickAdd} />);

    await userEvent.click(screen.getByRole('button', { name }));

    expect(onOpenQuickAdd).toHaveBeenCalledWith(tab);
  });

  it('offers no quick actions on a page that has no modal to open', () => {
    render(<Navigation />);

    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
