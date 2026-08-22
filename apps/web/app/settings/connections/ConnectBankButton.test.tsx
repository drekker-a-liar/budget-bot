// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_TOKEN_KEY, REAUTH_CONNECTION_KEY } from '@/lib/plaidLink';
import { mockNextNavigation, refused, router } from '@/test/helpers/islands';

/**
 * The button that connects a bank.
 *
 * It has two entirely different jobs behind one label. Against a real
 * deployment it fetches a Link token, stashes it where the OAuth return page
 * can find it, and opens Plaid's own UI - which is a third-party script, so it
 * is mocked here at the module boundary and what is asserted is what this
 * component asks of it. Behind the `E2E=1` door there is no UI to open at all:
 * the scripted bank has already "returned" its public token, so the click goes
 * straight to the exchange. That second path is what makes the Playwright
 * journey possible without Plaid credentials, and the last case below pins the
 * thing that would quietly break it - loading Plaid's script anyway.
 */

const link = vi.hoisted(() => ({
  /** The options the component handed the hook, for assertions. */
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
  createLinkTokenAction: vi.fn(async () => ({
    ok: true as const,
    data: { linkToken: 'link-sandbox-1' },
  })),
  exchangePublicTokenAction: vi.fn(async () => ({
    ok: true as const,
    data: {
      connectionId: 'conn-1',
      accounts: 2,
      firstSync: { added: 3, modified: 0, removed: 0, pages: 1, hasMore: false },
    },
  })),
}));

const { createLinkTokenAction, exchangePublicTokenAction } = await import(
  '@/src/server/actions/bank'
);
const { ConnectBankButton } = await import('./ConnectBankButton');

beforeEach(() => {
  vi.clearAllMocks();
  link.options = null;
  link.ready = true;
  window.sessionStorage.clear();
});

afterEach(cleanup);

const clickConnect = () => userEvent.click(screen.getByRole('button', { name: /connect a bank/i }));

describe('the scripted bank, behind the E2E door', () => {
  it('exchanges its public token without any Link UI', async () => {
    render(<ConnectBankButton kind="fake" />);

    await clickConnect();

    expect(exchangePublicTokenAction).toHaveBeenCalledWith({ publicToken: 'public-fake' });
    expect(createLinkTokenAction).not.toHaveBeenCalled();
    expect(link.open).not.toHaveBeenCalled();
  });

  it('never loads Plaid’s script for a bank that does not exist', () => {
    // `usePlaidLink` fetches `link-initialize.js` from Plaid's CDN on mount,
    // whatever token it was given. A test suite and an end-to-end run that is
    // supposed to need no Plaid at all would be making a network call to Plaid
    // on every render of this screen.
    render(<ConnectBankButton kind="fake" />);

    expect(link.options).toBeNull();
  });

  it('re-reads the page so the new connection appears on it', async () => {
    render(<ConnectBankButton kind="fake" />);

    await clickConnect();

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('a real bank, through Plaid Link', () => {
  it('fetches a link token, stashes it, and opens Link with it', async () => {
    render(<ConnectBankButton kind="plaid" />);

    await clickConnect();

    expect(createLinkTokenAction).toHaveBeenCalled();
    await waitFor(() => expect(link.open).toHaveBeenCalled());
    expect(link.options?.token).toBe('link-sandbox-1');
    // Stashed because an OAuth bank takes the browser away and sends it back
    // to a fresh page load, where this component's state no longer exists.
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBe('link-sandbox-1');
  });

  it('clears a stale reconnect stash rather than letting it hijack a fresh connect', async () => {
    // An abandoned reconnect - the user navigated away before Link's onExit
    // ever fired - can leave `REAUTH_CONNECTION_KEY` behind. Left in place,
    // an OAuth bank taken through *this* brand-new connect would come back to
    // `/plaid/oauth-return` and be read as resuming that old reconnect:
    // `markReconnectedAction` on somebody else's connection instead of
    // exchanging the public token this flow actually produced.
    window.sessionStorage.setItem(REAUTH_CONNECTION_KEY, 'conn-abandoned');
    render(<ConnectBankButton kind="plaid" />);

    await clickConnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    expect(window.sessionStorage.getItem(REAUTH_CONNECTION_KEY)).toBeNull();
  });

  it('exchanges the public token Link hands back, and clears the stash', async () => {
    render(<ConnectBankButton kind="plaid" />);
    await clickConnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess('public-sandbox-9', {});
    });

    expect(exchangePublicTokenAction).toHaveBeenCalledWith({ publicToken: 'public-sandbox-9' });
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('says why rather than opening Link with no token', async () => {
    vi.mocked(createLinkTokenAction).mockResolvedValueOnce(
      refused('Plaid is not configured on this deployment')
    );
    render(<ConnectBankButton kind="plaid" />);

    await clickConnect();

    expect(await screen.findByRole('alert')).toHaveTextContent(/not configured/i);
    expect(link.open).not.toHaveBeenCalled();
  });

  it('reports an exchange the server refused', async () => {
    vi.mocked(exchangePublicTokenAction).mockResolvedValueOnce(refused('Connection not found'));
    render(<ConnectBankButton kind="plaid" />);
    await clickConnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess('public-sandbox-9', {});
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection not found');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('ignores a Link success that carried no token, and clears the stash anyway', async () => {
    render(<ConnectBankButton kind="plaid" />);
    await clickConnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onSuccess(null, {});
    });

    expect(exchangePublicTokenAction).not.toHaveBeenCalled();
    // Spent regardless: Link has finished with this token, and a stash left
    // behind is one the OAuth return page would try to resume.
    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });

  it('clears the stash when the user closes Link without finishing', async () => {
    render(<ConnectBankButton kind="plaid" />);
    await clickConnect();
    await waitFor(() => expect(link.open).toHaveBeenCalled());

    await act(async () => {
      link.options?.onExit?.(null, {});
    });

    expect(window.sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });
});

/**
 * An action that rejects rather than answering.
 *
 * A server action can fail as an exception - the deployment is down, the
 * request never arrives - and the `await` in this component is what receives
 * it. Without a `catch` that is an unhandled rejection, `setBusy(false)` never
 * runs, and the button says "Connecting…" for the rest of the session with
 * nothing on screen to say why.
 */
describe('when the action itself throws', () => {
  it.each([
    ['fake', async () => vi.mocked(exchangePublicTokenAction).mockRejectedValueOnce(new Error('502'))],
    ['plaid', async () => vi.mocked(createLinkTokenAction).mockRejectedValueOnce(new Error('502'))],
  ] as const)('says something went wrong and re-enables the button (%s)', async (kind, arrange) => {
    await arrange();
    render(<ConnectBankButton kind={kind} />);

    await clickConnect();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect a bank/i })).toBeEnabled();
  });
});
