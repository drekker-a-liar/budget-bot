// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockNextNavigation, refused, router } from '@/test/helpers/islands';

/**
 * The connections screen.
 *
 * Its job is to answer three questions without the reader having to ask
 * anybody: which banks are linked, what is behind each of them, and whether
 * the last sync worked. The third is the one worth testing hardest — a
 * connection whose token has expired looks exactly like a healthy one if the
 * screen only ever draws the happy state, and the owner finds out weeks later
 * that no transactions have arrived.
 */

vi.mock('next/navigation', () => mockNextNavigation());

vi.mock('@/src/server/actions/bank', () => ({
  createLinkTokenAction: vi.fn(),
  exchangePublicTokenAction: vi.fn(),
  syncNowAction: vi.fn(async () => ({
    ok: true as const,
    data: { added: 3, modified: 1, removed: 0, pages: 2, hasMore: false },
  })),
}));

const { syncNowAction } = await import('@/src/server/actions/bank');
const { ConnectionsView } = await import('./ConnectionsView');

/**
 * The props, named off the component itself.
 *
 * Deliberately not the repository's row types: the query hands this screen a
 * view with the cursor, the item id and the encryption key id left out, and a
 * fixture built from the wider row would let the screen start reading one of
 * them without anything noticing.
 */
type Connection = Parameters<typeof ConnectionsView>[0]['connections'][number];
type Account = Connection['accounts'][number];

function anAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acct-1',
    name: 'Fake Business Card',
    officialName: 'Fake Bank Business Rewards Card',
    mask: '4471',
    type: 'credit',
    subtype: 'credit card',
    currentBalanceCents: 264956,
    creditLimitCents: 500000,
    ...overrides,
  };
}

function aConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    institutionName: 'Fake Bank (E2E)',
    status: 'active',
    lastSyncedAt: '2026-08-20T12:00:00.000Z',
    lastErrorCode: null,
    accounts: [
      anAccount(),
      anAccount({
        id: 'acct-2',
        name: 'Fake Business Checking',
        officialName: 'Fake Bank Business Interest Checking',
        mask: '0000',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: 1298011,
        creditLimitCents: null,
      }),
    ],
    ...overrides,
  };
}

function renderView(overrides: Partial<Parameters<typeof ConnectionsView>[0]> = {}) {
  render(
    <ConnectionsView
      configured
      kind="plaid"
      connections={[aConnection()]}
      unassignedCount={3}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('what is linked', () => {
  it('names the institution behind each connection', () => {
    renderView();

    expect(screen.getByText('Fake Bank (E2E)')).toBeInTheDocument();
  });

  it('lists every account, with its mask and what kind it is', () => {
    renderView();

    expect(screen.getByText(/Fake Business Card/)).toBeInTheDocument();
    expect(screen.getByText(/4471/)).toBeInTheDocument();
    expect(screen.getByText(/Fake Business Checking/)).toBeInTheDocument();
    expect(screen.getByText(/0000/)).toBeInTheDocument();
  });

  it('shows the balance the bank last reported, and a credit line’s limit', () => {
    renderView();

    expect(screen.getByText('$2,649.56')).toBeInTheDocument();
    expect(screen.getByText(/\$5,000\.00/)).toBeInTheDocument();
    expect(screen.getByText('$12,980.11')).toBeInTheDocument();
  });

  it('says when it last synced', () => {
    renderView();

    expect(screen.getByText(/Aug 20, 2026/)).toBeInTheDocument();
  });

  it('says a connection has never synced rather than showing an empty date', () => {
    renderView({ connections: [aConnection({ lastSyncedAt: null })] });

    expect(screen.getByText(/never synced/i)).toBeInTheDocument();
  });

  it('invites a first bank when none are linked', () => {
    renderView({ connections: [] });

    expect(screen.getByText(/No banks connected yet/i)).toBeInTheDocument();
  });

  it('carries the inbox count into the header', () => {
    renderView();

    expect(screen.getByRole('link', { name: /card inbox/i })).toHaveTextContent('3');
  });
});

describe('how the last sync went', () => {
  it('shows a healthy connection as connected', () => {
    renderView();

    expect(screen.getByText('Connected')).toHaveClass('badge-healthy');
  });

  it('says when the bank wants the owner to sign in again', () => {
    renderView({
      connections: [
        aConnection({ status: 'reauth_required', lastErrorCode: 'ITEM_LOGIN_REQUIRED' }),
      ],
    });

    expect(screen.getByText(/sign in again/i)).toHaveClass('badge-critical');
  });

  it('names the code a failing connection recorded, because that is what support asks for', () => {
    renderView({
      connections: [aConnection({ status: 'error', lastErrorCode: 'RATE_LIMIT_EXCEEDED' })],
    });

    expect(screen.getByText(/RATE_LIMIT_EXCEEDED/)).toBeInTheDocument();
  });
});

describe('syncing on demand', () => {
  it('syncs the connection whose button was pressed', async () => {
    renderView({ connections: [aConnection(), aConnection({ id: 'conn-2', accounts: [] })] });

    await userEvent.click(screen.getAllByRole('button', { name: /sync now/i })[1]);

    expect(syncNowAction).toHaveBeenCalledWith({ connectionId: 'conn-2' });
  });

  it('reports what the run actually did', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Synced: 3 added, 1 modified, 0 removed'
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says another sync already has the connection', async () => {
    vi.mocked(syncNowAction).mockResolvedValueOnce({ ok: true, data: { skipped: true } });
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/already running/i);
  });

  it('shows a refusal where the reader is looking, rather than swallowing it', async () => {
    vi.mocked(syncNowAction).mockResolvedValueOnce(
      refused('Your bank is asking for a pause. 3 added so far; try again in 45 seconds.')
    );
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('try again in 45 seconds');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('gives the button back when the call itself never comes back', async () => {
    // An action can fail as an exception rather than as a value: the
    // deployment is down, or `syncNowAction` throws before its own guards -
    // `loadKeysFromEnv()` runs outside every `try` in it. Without a catch the
    // rejection is unhandled, `setSyncing(null)` never runs, and the button
    // reads "Syncing…" until the next navigation.
    vi.mocked(syncNowAction).mockRejectedValueOnce(new Error('the deployment went away'));
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(await screen.findByRole('button', { name: /sync now/i })).toBeEnabled();
    // And it says nothing about what: the component does not know, and the
    // thrown message is not a sentence anybody wrote for a screen.
    expect(screen.getByRole('alert')).not.toHaveTextContent('the deployment went away');
  });
});

describe('a deployment with no Plaid credentials', () => {
  it('says so instead of offering a button that can only fail', () => {
    renderView({ configured: false, kind: null, connections: [] });

    expect(screen.getByText(/not configured on this deployment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect a bank/i })).not.toBeInTheDocument();
  });

  it('still shows the connections that were linked before it was switched off', () => {
    // Credentials removed from an environment do not remove the rows, and a
    // screen that hid them would look like the bank had been disconnected.
    renderView({ configured: false, kind: null });

    expect(screen.getByText('Fake Bank (E2E)')).toBeInTheDocument();
  });
});
