// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SeverityLevel } from '@budget-bot/core';
import { SeverityBadge } from './SeverityBadge';

/**
 * The badge is the one place a severity level becomes something a contractor
 * can see across the room, so what is asserted here is the mapping from level
 * to class and to words - not the icon, not the padding.
 */

afterEach(cleanup);

describe('SeverityBadge', () => {
  it.each([
    ['healthy' as const, 'badge-healthy', 'HEALTHY'],
    ['caution' as const, 'badge-caution', 'WATCH'],
    ['critical' as const, 'badge-critical', 'CRITICAL'],
  ])('renders %s as %s', (level: SeverityLevel, expectedClass, expectedLabel) => {
    render(<SeverityBadge level={level} />);

    const badge = screen.getByText(expectedLabel).parentElement;
    expect(badge).toHaveClass(expectedClass);
  });

  it('says there was nothing to measure rather than blaming the reader', () => {
    // A null level is "no data to judge", which must not look like a failure:
    // no severity colour, and words that say why the number is missing.
    render(<SeverityBadge level={null} />);

    const badge = screen.getByText('NO DATA').parentElement;
    expect(badge).toHaveClass('badge-neutral');
    expect(badge).not.toHaveClass('badge-critical');
  });

  it('lets a caller say why, keeping the colour the level earned', () => {
    render(<SeverityBadge level={null} label="NO HOURS LOGGED" />);

    const badge = screen.getByText('NO HOURS LOGGED').parentElement;
    expect(badge).toHaveClass('badge-neutral');
    expect(screen.queryByText('NO DATA')).not.toBeInTheDocument();
  });

  it('shows the subtext next to the label when there is one', () => {
    render(<SeverityBadge level="caution" label="33%" subtext="target 45%" />);

    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('(target 45%)')).toBeInTheDocument();
  });

  it('leaves out the subtext entirely when there is none', () => {
    render(<SeverityBadge level="healthy" />);

    expect(screen.getByText('HEALTHY').parentElement?.textContent).toBe('HEALTHY');
  });
});
