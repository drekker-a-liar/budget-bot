// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_TOKEN_KEY, REAUTH_CONNECTION_KEY } from '@/lib/plaidLink';
import { mockNextNavigation, refused, router } from '@/test/helpers/islands';

/**
 * The button on a broken connection's banner: "Reconnect".
 *
 * It is `ConnectBankButton`'s shape, aimed at a different pair of actions.
 * Against a real deployment it fetches an *update-mode* Link token bound to
 * the connection's existing access token and opens Plaid's own UI with it;
 * Link ends that flow with no public token to exchange (spec §5a), so
 * `onSuccess` calls `markReconnectedAction` directly rather than an exchange.
 * Behind the `E2E=1` door the scripted bank has no UI to resume, so the click
 * goes straight to `markReconnectedAction`.
 */

const link = vi.hoisted(() => ({
  options: null as null | {
    token: string | null;
    onSuccess: (publicToken: string | null, metadata: unknown) => void;
    onExit?: (error: unknown, metadata: unknown) => void;
  },
  open: vi.fn(),
  ready: true,
}));

vi.mock('react-plaid-link', () => ({
  usePlaidLink: (options: NonNullable<typeof link.options>) => {
    link.options = options;
    return { open: link.open, ready: link.ready, error: null, exit: vi.fn(), submit: vi.fn() };
  },
}));

vi.mock('next/navigation', () => mockNextNavigation());

vi.mock('@/src/server/actions/bank', () => ({
  createReauthLinkTokenAction: vi.fn(async () => ({
    ok: true as const,
    data: { linkToken: 'link-sandbox-reauth-1' },
  })),
  markReconnectedAction: vi.fn(async () => ({
    ok: true as const,
    data: { added: 1, modified: 0, removed: 0, pages: 1, hasMore: false },
  })),
}));

const { createReauthLinkTokenAction, markReconnectedAction } = await import(
  '@/src/server/actions/bank'
);
const { ReconnectButton } = await import('./ReconnectButton');

beforeEach(() => {
  vi.clearAllMocks();
  link.options = null;
  link.ready = true;
  window.sessionStorage.clear();
});

afterEach(cleanup);

const clickReconnect = () => userEvent.click(screen.getByRole('button', { name: /reconnect/i }));

describe('the scripted bank, behind the E2E door', () => {
  it('marks the connection reconnected without any Link UI', async () => {
    render(<ReconnectButton kind="fake" connectionId="conn-1" />);

    await clickReconnect();

    expect(markReconnectedAction).toHaveBeenCalledWith({ connectionId: 'conn-1' });
    expect(createReauthLinkTokenAction).not.toHaveBeenCalled();
    expect(link.open).not.toHaveBeenCalled();
  });

  it('never loads Plaid’s script for a bank that does not exist', () => {
    render(<ReconnectButton kind="fake" connectionId="conn-1" />);

    expect(link.options).toBeNull();
  });

  it('re-reads the page once the connection is healthy again', async () => {
    render(<ReconnectButton kind="fake" connectionId="conn-1" />);

    await clickReconnect();

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('shows a refusal where the reader is looking, rather than swallowing it', async () => {
    vi.mocked(markReconnectedAction).mockResolvedValueOnce(refused('Connection not found'));
    render(<ReconnectButton kind="fake" connectionId="conn-1" />);

    await clickReconnect();

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection not found');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('a real bank, through Plaid Link update mode', () => {
  it('fetches an update-mode Link token for this connection, and opens Link with it', async () => {
    render(<ReconnectButton kind="plaid" connectionId="conn-7" />);

    await clickReconnect();

    expect(createReauthLinkTokenAction).toHaveBeenCalledWith({ connectionId: 'conn-7' });
    await waitFor(() => expect(link.open).toHaveBeenCalled());
    expect(link.options?.token).toBe('link-sandbox-reauth-1');
  });

  it('stashes the token and this connection’s id before Link opens, for an OAuth bank’s round trip', async () => {
    render(<ReconnectButton kind="plaid" connectionId="conn-7" />);

    await clickReconnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    // `/plaid/oauth-return` reads both back: the token to resume Link, and
    // the connection id to know this is a reconnect rather than a brand-new
    // bank - so `onSuccess` there calls `markReconnectedAction`, not an
    // exchange.
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBe('link-sandbox-reauth-1');
    expect(window.sessionStorage.getItem(REAUTH_CONNECTION_KEY)).toBe('conn-7');
  });

  it('marks the connection reconnected on success, with no public token to exchange, and clears the stash', async () => {
    render(<ReconnectButton kind="plaid" connectionId="conn-7" />);
    await clickReconnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      // Update mode hands Link's callback nothing worth exchanging.
      link.options?.onSuccess(null, {});
    });

    expect(markReconnectedAction).toHaveBeenCalledWith({ connectionId: 'conn-7' });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(REAUTH_CONNECTION_KEY)).toBeNull();
  });

  it('says why rather than opening Link with no token', async () => {
    vi.mocked(createReauthLinkTokenAction).mockResolvedValueOnce(
      refused('Connection not found')
    );
    render(<ReconnectButton kind="plaid" connectionId="conn-7" />);

    await clickReconnect();

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection not found');
    expect(link.open).not.toHaveBeenCalled();
  });

  it('reports a reconnect the server refused', async () => {
    vi.mocked(markReconnectedAction).mockResolvedValueOnce(refused('Connection not found'));
    render(<ReconnectButton kind="plaid" connectionId="conn-7" />);
    await clickReconnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess(null, {});
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection not found');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('does nothing when the user closes Link without finishing, but clears the stash', async () => {
    render(<ReconnectButton kind="plaid" connectionId="conn-7" />);
    await clickReconnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onExit?.(null, {});
    });

    expect(markReconnectedAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(REAUTH_CONNECTION_KEY)).toBeNull();
  });
});

describe('when the action itself throws', () => {
  it.each([
    ['fake', async () => vi.mocked(markReconnectedAction).mockRejectedValueOnce(new Error('502'))],
    ['plaid', async () => vi.mocked(createReauthLinkTokenAction).mockRejectedValueOnce(new Error('502'))],
  ] as const)('says something went wrong and re-enables the button (%s)', async (kind, arrange) => {
    await arrange();
    render(<ReconnectButton kind={kind} connectionId="conn-1" />);

    await clickReconnect();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeEnabled();
  });
});
