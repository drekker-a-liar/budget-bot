import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the connections screen is handed, and what it is not.
 *
 * Everything a Server Component passes to a client component is serialised
 * into the RSC payload, which is HTML anybody with the page can read. The
 * connection row carries three columns the screen has no use for - the
 * provider's pagination cursor, Plaid's own identifier for the login, and
 * which key wrote the token's ciphertext - and the query hands over a named
 * view instead of the row. This is the test that keeps it named: a column
 * added to `bank_connections` later is absent from the payload until somebody
 * decides it should be there, and this fails if the mapping is ever replaced
 * by a spread.
 */

// `import 'server-only'` throws outside a React Server Component. That is the
// point of it; here it is the module boundary this test reaches past.
vi.mock('server-only', () => ({}));

const repos = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [
    {
      id: 'conn-1',
      provider: 'plaid',
      itemId: 'item-fake',
      institutionId: 'ins_fake',
      institutionName: 'Fake Bank (E2E)',
      encryptionKeyId: 'k-9f2c',
      cursor: 'fake-2',
      status: 'active',
      lastSyncedAt: '2026-08-20T12:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
      accounts: [
        {
          id: 'acct-1',
          connectionId: 'conn-1',
          externalId: 'fake-credit',
          name: 'Fake Business Card',
          officialName: 'Fake Bank Business Rewards Card',
          mask: '4471',
          type: 'credit',
          subtype: 'credit card',
          currentBalanceCents: 264956,
          availableBalanceCents: 235044,
          creditLimitCents: 500000,
          isoCurrencyCode: 'USD',
          isEnabled: true,
          balancesUpdatedAt: '2026-08-20T12:00:00.000Z',
        },
      ],
    },
  ]),
  listTransactions: vi.fn(async () => [
    { id: 'tx-1', status: 'unassigned' },
    { id: 'tx-2', status: 'matched' },
  ]),
}));

vi.mock('@budget-bot/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budget-bot/db')>()),
  getDb: () => ({}),
  bankRepo: { listConnections: repos.listConnections },
  transactionsRepo: { listTransactions: repos.listTransactions },
}));

const kind = vi.hoisted(() => ({ current: 'plaid' as 'fake' | 'plaid' | null }));
vi.mock('@/src/server/bank/provider', () => ({ getBankProviderKind: () => kind.current }));

const { getConnectionsPage } = await import('@/src/server/queries/connections');

beforeEach(() => {
  vi.clearAllMocks();
  kind.current = 'plaid';
});

describe('getConnectionsPage', () => {
  it('reads as the owner it was given, and never one of its own', async () => {
    await getConnectionsPage('user-1');

    expect(repos.listConnections).toHaveBeenCalledWith({}, 'user-1');
    expect(repos.listTransactions).toHaveBeenCalledWith({}, 'user-1');
  });

  it('hands the screen a named view of a connection, not the row', async () => {
    const page = await getConnectionsPage('user-1');

    expect(Object.keys(page.connections[0]).sort()).toEqual([
      'accounts',
      'id',
      'institutionName',
      'lastErrorCode',
      'lastSyncedAt',
      'status',
    ]);
  });

  it('leaves the cursor, the item id and the key id out of the payload', async () => {
    const page = await getConnectionsPage('user-1');

    // Spelled out as well as pinned by the key list above, because these three
    // are the reason the key list exists.
    const serialised = JSON.stringify(page);
    expect(serialised).not.toContain('fake-2');
    expect(serialised).not.toContain('item-fake');
    expect(serialised).not.toContain('k-9f2c');
  });

  it('hands over only the account columns the table draws', async () => {
    const page = await getConnectionsPage('user-1');

    expect(Object.keys(page.connections[0].accounts[0]).sort()).toEqual([
      'creditLimitCents',
      'currentBalanceCents',
      'id',
      'mask',
      'name',
      'officialName',
      'subtype',
      'type',
    ]);
  });

  it('says the deployment is configured, and with which provider', async () => {
    await expect(getConnectionsPage('user-1')).resolves.toMatchObject({
      configured: true,
      kind: 'plaid',
    });
  });

  it('says it is not configured when there is no provider at all', async () => {
    kind.current = null;

    await expect(getConnectionsPage('user-1')).resolves.toMatchObject({
      configured: false,
      kind: null,
    });
  });

  it('counts the unfiled charges for the header badge every page carries', async () => {
    await expect(getConnectionsPage('user-1')).resolves.toMatchObject({ unassignedCount: 1 });
  });
});
