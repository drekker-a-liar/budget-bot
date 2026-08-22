// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_TOKEN_KEY, REAUTH_CONNECTION_KEY } from '@/lib/plaidLink';
import { mockNextNavigation, refused, router } from '@/test/helpers/islands';

/**
 * Where an OAuth bank sends the browser back to.
 *
 * This is a fresh page load in the middle of a Link flow: everything the
 * connections page knew is gone, and the only way to resume is the Link token
 * stashed in `sessionStorage` on the way out. So the first thing pinned here
 * is the refusal - no stashed token, no Link session to finish, and a page
 * that says so rather than initialising Link with nothing. The second is
 * `receivedRedirectUri`, which is how Link knows which flow it is resuming and
 * without which it starts a new one from the beginning.
 */

const link = vi.hoisted(() => ({
  options: null as null | {
    token: string | null;
    receivedRedirectUri?: string;
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
  exchangePublicTokenAction: vi.fn(async () => ({
    ok: true as const,
    data: {
      connectionId: 'conn-1',
      accounts: 2,
      firstSync: { added: 3, modified: 0, removed: 0, pages: 1, hasMore: false },
    },
  })),
  markReconnectedAction: vi.fn(async () => ({
    ok: true as const,
    data: { added: 0, modified: 0, removed: 0, pages: 0, hasMore: false },
  })),
}));

const { exchangePublicTokenAction, markReconnectedAction } = await import(
  '@/src/server/actions/bank'
);
const { OAuthReturn } = await import('./OAuthReturn');

beforeEach(() => {
  vi.clearAllMocks();
  link.options = null;
  link.ready = true;
  window.sessionStorage.clear();
});

afterEach(cleanup);

describe('with no stashed link token', () => {
  it('says there is nothing to finish, and offers the way back', async () => {
    render(<OAuthReturn />);

    expect(await screen.findByText(/nothing to finish here/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /connections/i })).toHaveAttribute(
      'href',
      '/settings/connections'
    );
  });

  it('never opens Link, because there is no session to resume', async () => {
    render(<OAuthReturn />);

    await screen.findByText(/nothing to finish here/i);
    expect(link.open).not.toHaveBeenCalled();
    expect(link.options?.token ?? null).toBeNull();
  });
});

describe('with the token the connections page stashed', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(LINK_TOKEN_KEY, 'link-sandbox-1');
  });

  it('resumes that flow rather than starting a new one', async () => {
    render(<OAuthReturn />);

    await waitFor(() => expect(link.open).toHaveBeenCalled());
    expect(link.options?.token).toBe('link-sandbox-1');
    expect(link.options?.receivedRedirectUri).toBe(window.location.href);
  });

  it('exchanges the public token, clears the stash, and goes to the connections page', async () => {
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess('public-sandbox-9', {});
    });

    expect(exchangePublicTokenAction).toHaveBeenCalledWith({ publicToken: 'public-sandbox-9' });
    // No stashed connection id, so this is an ordinary connect - never a
    // reconnect wearing the wrong flow.
    expect(markReconnectedAction).not.toHaveBeenCalled();
    // Single-use, and this page is reachable by anyone who presses Back.
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    // Replaced, not pushed: Back should not return to a spent Link flow.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/settings/connections'));
  });

  it('stays put and says what went wrong when the exchange is refused', async () => {
    vi.mocked(exchangePublicTokenAction).mockResolvedValueOnce(
      refused('Plaid is not configured on this deployment')
    );
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess('public-sandbox-9', {});
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/not configured/i);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('clears the stash when the user closes Link instead of finishing', async () => {
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onExit?.(null, {});
    });

    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });

  it('says something went wrong when the action never comes back', async () => {
    // Not a refusal, which is a value with a message on it - the call itself
    // failing. Without a catch this is an unhandled rejection and the page
    // sits on "Finishing the connection…" for ever.
    vi.mocked(exchangePublicTokenAction).mockRejectedValueOnce(new Error('502'));
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess('public-sandbox-9', {});
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('clears the stash when the bank sends the browser back with nothing', async () => {
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess(null, {});
    });

    expect(exchangePublicTokenAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });
});

/**
 * Resuming Link's update mode, not a brand-new connection (spec §5a).
 *
 * The stashed connection id - written by `ReconnectButton` alongside the
 * token - is what tells this page the two flows apart. Update mode ends with
 * no public token worth exchanging, so `onSuccess` here has to call
 * `markReconnectedAction` instead of `exchangePublicTokenAction`, or an OAuth
 * bank's reconnect would silently try to link a second, redundant
 * connection.
 */
describe('with a reconnect the connections page stashed', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(LINK_TOKEN_KEY, 'link-sandbox-reauth-1');
    window.sessionStorage.setItem(REAUTH_CONNECTION_KEY, 'conn-7');
  });

  it('resumes update mode rather than starting a new Link session', async () => {
    render(<OAuthReturn />);

    await waitFor(() => expect(link.open).toHaveBeenCalled());
    expect(link.options?.token).toBe('link-sandbox-reauth-1');
  });

  it('marks the connection reconnected, clears both stashed keys, and goes back', async () => {
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      // Update mode hands the callback nothing worth exchanging.
      link.options?.onSuccess(null, {});
    });

    expect(markReconnectedAction).toHaveBeenCalledWith({ connectionId: 'conn-7' });
    expect(exchangePublicTokenAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(REAUTH_CONNECTION_KEY)).toBeNull();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/settings/connections'));
  });

  it('stays put and says what went wrong when the reconnect is refused', async () => {
    vi.mocked(markReconnectedAction).mockResolvedValueOnce(refused('Connection not found'));
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess(null, {});
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection not found');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says something went wrong when the action never comes back', async () => {
    vi.mocked(markReconnectedAction).mockRejectedValueOnce(new Error('502'));
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess(null, {});
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('clears both stashed keys when the user closes Link instead of finishing', async () => {
    render(<OAuthReturn />);
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onExit?.(null, {});
    });

    expect(markReconnectedAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(REAUTH_CONNECTION_KEY)).toBeNull();
  });
});

describe('with a stashed connection id but no link token', () => {
  it('falls back to "nothing to finish", the same as no stash at all', async () => {
    // Should not happen in practice - `ReconnectButton` writes both keys
    // together - but a corrupt or partially-cleared stash must not resume a
    // Link session with no token to give it.
    window.sessionStorage.setItem(REAUTH_CONNECTION_KEY, 'conn-7');

    render(<OAuthReturn />);

    expect(await screen.findByText(/nothing to finish here/i)).toBeInTheDocument();
    expect(link.open).not.toHaveBeenCalled();
    expect(markReconnectedAction).not.toHaveBeenCalled();
  });
});
