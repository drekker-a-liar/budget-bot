import { PlaidItemError, PlaidRequestError } from '@budget-bot/bank-connectors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/src/env';
import type { RunSyncResult } from '@/src/server/bank/sync';
import { loadActions } from './helpers/actionModules';

/**
 * What a server action does before it writes anything.
 *
 * Three things, in this order, and every action does all three: resolve the
 * owner from the session, validate what arrived against the domain schema, and
 * only then call a repository - with that owner, never with one the caller
 * supplied. The session, `revalidatePath` and the repositories are stubbed at
 * the module boundary; everything asserted here is the action's own decision.
 *
 * The other thing pinned here is where money becomes cents. The forms send
 * `'1,234.56'`; what reaches a repository is `123456`.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1' }, expires: '2026-09-01' })),
}));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

/**
 * The bank, as far as an action can see it: a provider, a keyring, a sync
 * service. All three are stubbed at the module boundary, because what is under
 * test here is the order an action puts them in and the owner it puts them in
 * for - not whether Plaid answers.
 */
const bank = vi.hoisted(() => ({
  createLinkToken: vi.fn(async (_args: { userId: string; redirectUri: string }) => ({
    linkToken: 'link-fake',
    expiration: '2026-08-21T12:30:00.000Z',
  })),
  exchangePublicToken: vi.fn(async (_publicToken: string) => ({
    accessToken: 'access-fake',
    itemId: 'item-fake',
    institutionId: 'ins_fake',
    institutionName: 'Fake Bank (E2E)',
  })),
  removeItem: vi.fn(async (_accessToken: string) => undefined),
  getAccounts: vi.fn(async (_accessToken: string) => [
    { externalId: 'fake-credit', name: 'Fake Business Card', mask: '4471', type: 'credit' },
    { externalId: 'fake-checking', name: 'Fake Business Checking', mask: '0000', type: 'depository' },
  ]),
  runSync: vi.fn(
    async (
      _db: unknown,
      _ownerId: string,
      _connectionId: string,
      _deps: { maxPages?: number }
    ): Promise<RunSyncResult> => ({
      added: 2,
      modified: 0,
      removed: 0,
      pages: 1,
      hasMore: false,
      unknownAccountCount: 0,
    })
  ),
}));

/** Null is a supported deployment: no credentials, and the UI says so. */
const provider = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/src/server/bank/provider', () => ({
  getBankProvider: () => provider.current,
  getBankProviderKind: () => (provider.current ? 'plaid' : null),
}));

vi.mock('@/src/server/bank/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/server/bank/sync')>()),
  runSync: bank.runSync,
}));

/** What the request said about where it arrived. Never what the caller sent. */
const requestHeaders = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(requestHeaders.current) }));

const repos = vi.hoisted(() => ({
  createProject: vi.fn(async (_db: unknown, _owner: string, input: object) => ({
    id: 'proj-1',
    ...input,
  })),
  updateProject: vi.fn(async () => ({ id: 'proj-1', status: 'completed' })),
  createTransaction: vi.fn(async (_db: unknown, _owner: string, input: object) => ({
    id: 'tx-1',
    ...input,
  })),
  updateTransaction: vi.fn(async (..._args: unknown[]) => ({ id: 'tx-1' })),
  deleteTransaction: vi.fn(async () => true),
  createLaborEntry: vi.fn(async (_db: unknown, _owner: string, input: object) => ({
    id: 'lab-1',
    ...input,
  })),
  deleteLaborEntry: vi.fn(async () => true),
  createInvoice: vi.fn(async (_db: unknown, _owner: string, input: object) => ({
    id: 'inv-1',
    ...input,
  })),
  updateInvoice: vi.fn(async () => ({ id: 'inv-1', status: 'paid' })),
  createConnection: vi.fn(async (_db: unknown, _owner: string, _input: object) => ({
    id: 'conn-1',
    provider: 'plaid',
    itemId: 'item-fake',
    institutionName: 'Fake Bank (E2E)',
  })),
  // Answers with what it was given, the way the repository answers with the
  // rows it wrote: the count the owner is shown is what was stored.
  upsertAccounts: vi.fn(async (_db: unknown, _owner: string, _id: string, accounts: unknown[]) =>
    accounts
  ),
  getConnection: vi.fn(async (_db: unknown, _owner: string, id: string) => ({
    id,
    status: 'active',
  })),
  // The one function that turns a stored token back into a string. It hands
  // the plaintext to a callback and never returns it, so the stand-in does the
  // same thing rather than resolving to a token.
  withAccessToken: vi.fn(
    async (
      _db: unknown,
      _owner: string,
      _id: string,
      _keyring: unknown,
      fn: (accessToken: string) => Promise<unknown>
    ) => fn('access-fake')
  ),
  recordSyncError: vi.fn(async () => undefined),
  // Re-link upsert (spec §5b): same connection id `createConnection` answers
  // with by default, so a test that does not care about re-auth still sees
  // the connection it expects downstream.
  replaceConnectionToken: vi.fn(
    async (
      _db: unknown,
      _owner: string,
      _input: { itemId: string; accessToken: string }
    ): Promise<{ id: string } | null> => ({
      id: 'conn-1',
    })
  ),
  markConnectionActive: vi.fn(async (_db: unknown, _owner: string, _id: string) => true),
  deleteConnection: vi.fn(async (_db: unknown, _owner: string, _id: string) => true),
  // Delete-all (spec §6): enumerated for the best-effort `removeItem` loop,
  // then swept away table by table. Empty by default so a test that does not
  // care about connections is not also on the hook for scripting one.
  listConnections: vi.fn(async (_db: unknown, _owner: string) => [] as Array<{ id: string }>),
  deleteAllConnections: vi.fn(async (_db: unknown, _owner: string) => 0),
  deleteAllTransactions: vi.fn(async (_db: unknown, _owner: string) => 0),
  deleteAllLaborEntries: vi.fn(async (_db: unknown, _owner: string) => 0),
  deleteAllInvoices: vi.fn(async (_db: unknown, _owner: string) => 0),
  deleteAllImportBatches: vi.fn(async (_db: unknown, _owner: string) => 0),
  deleteAllProjects: vi.fn(async (_db: unknown, _owner: string) => 0),
}));

vi.mock('@budget-bot/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budget-bot/db')>()),
  getDb: () => ({}),
  projectsRepo: {
    createProject: repos.createProject,
    updateProject: repos.updateProject,
    deleteAllProjects: repos.deleteAllProjects,
  },
  transactionsRepo: {
    createTransaction: repos.createTransaction,
    updateTransaction: repos.updateTransaction,
    deleteTransaction: repos.deleteTransaction,
    deleteAllTransactions: repos.deleteAllTransactions,
  },
  laborRepo: {
    createLaborEntry: repos.createLaborEntry,
    deleteLaborEntry: repos.deleteLaborEntry,
    deleteAllLaborEntries: repos.deleteAllLaborEntries,
  },
  invoicesRepo: {
    createInvoice: repos.createInvoice,
    updateInvoice: repos.updateInvoice,
    deleteAllInvoices: repos.deleteAllInvoices,
  },
  bankRepo: {
    createConnection: repos.createConnection,
    upsertAccounts: repos.upsertAccounts,
    getConnection: repos.getConnection,
    withAccessToken: repos.withAccessToken,
    recordSyncError: repos.recordSyncError,
    replaceConnectionToken: repos.replaceConnectionToken,
    markConnectionActive: repos.markConnectionActive,
    deleteConnection: repos.deleteConnection,
    listConnections: repos.listConnections,
    deleteAllConnections: repos.deleteAllConnections,
  },
  importBatchesRepo: { deleteAllImportBatches: repos.deleteAllImportBatches },
}));

const { ConnectionAlreadyExistsError } = await import('@budget-bot/db');
const { auth } = await import('@/auth');
const { createProjectAction, updateProjectStatusAction } = await import(
  '@/src/server/actions/projects'
);
const {
  assignTransactionAction,
  createTransactionAction,
  deleteTransactionAction,
  updateTransactionCategoryAction,
} = await import('@/src/server/actions/transactions');
const { createLaborEntryAction, deleteLaborEntryAction } = await import(
  '@/src/server/actions/labor'
);
const { createInvoiceAction, markInvoicePaidAction } = await import(
  '@/src/server/actions/invoices'
);
const {
  createLinkTokenAction,
  exchangePublicTokenAction,
  syncNowAction,
  createReauthLinkTokenAction,
  markReconnectedAction,
  disconnectConnectionAction,
} = await import('@/src/server/actions/bank');
const { deleteAllDataAction } = await import('@/src/server/actions/account');

/**
 * Every action there is, read off disk rather than typed out.
 *
 * The gating rule - no session, no write - is pinned against *this* list, so
 * a new `src/server/actions/export.ts` that forgot `currentOwnerId()` fails
 * here on the day it is written. The list below it, which carries an input per
 * action so the signed-in half can call them for real, is checked against this
 * one, so it cannot fall behind either.
 */
const DERIVED_ACTIONS = await loadActions();

/** Seventeen today. A number here means shrinkage gets noticed, not just growth. */
const ACTION_COUNT = 17;

const A_PROJECT = { name: 'Cedar Deck', clientName: 'R Henderson', quotedTotal: '4500' };

/** Every action, with an input that would otherwise succeed. */
const EVERY_ACTION: Array<[string, (input: unknown) => Promise<unknown>, unknown]> = [
  ['createProject', createProjectAction, A_PROJECT],
  ['updateProjectStatus', updateProjectStatusAction, { id: 'proj-1', status: 'completed' }],
  ['createTransaction', createTransactionAction, { vendor: 'The Home Depot', amount: '10' }],
  ['assignTransaction', assignTransactionAction, { id: 'tx-1', projectId: 'proj-1' }],
  ['updateTransactionCategory', updateTransactionCategoryAction, { id: 'tx-1', category: 'tools' }],
  ['deleteTransaction', deleteTransactionAction, { id: 'tx-1' }],
  ['createLaborEntry', createLaborEntryAction, { projectId: 'proj-1', hours: '6' }],
  ['deleteLaborEntry', deleteLaborEntryAction, { id: 'lab-1' }],
  ['createInvoice', createInvoiceAction, { projectId: 'proj-1', invoiceNumber: 'INV-1', amount: '1950' }],
  ['markInvoicePaid', markInvoicePaidAction, { id: 'inv-1' }],
  ['createLinkToken', createLinkTokenAction, {}],
  ['exchangePublicToken', exchangePublicTokenAction, { publicToken: 'public-fake' }],
  ['syncNow', syncNowAction, { connectionId: 'conn-1' }],
  ['createReauthLinkToken', createReauthLinkTokenAction, { connectionId: 'conn-1' }],
  ['markReconnected', markReconnectedAction, { connectionId: 'conn-1' }],
  ['disconnectConnection', disconnectConnectionAction, { connectionId: 'conn-1' }],
  ['deleteAllData', deleteAllDataAction, {}],
];

/**
 * The one action that reads and writes nothing: it asks the provider for a
 * Link token and hands it back. Named here rather than leaving the two tests
 * below with a list of the ones that do write, which would be the list that a
 * new action quietly failed to join.
 */
const TOUCHES_NO_REPOSITORY = new Set(['createLinkToken']);

/**
 * Actions that reach a repository only to read, never to write - so
 * revalidating a page afterwards would be invalidating a cache for nothing
 * that changed. `createReauthLinkToken` looks the connection up to check
 * ownership and decrypts its token to mint an update-mode Link token, and
 * stops there: the connection itself is not written to until Link's
 * `onSuccess` calls `markReconnectedAction`, which does write and does
 * invalidate.
 */
const DOES_NOT_WRITE = new Set(['createLinkToken', 'createReauthLinkToken']);

const WRITING_ACTIONS = EVERY_ACTION.filter(([name]) => !TOUCHES_NO_REPOSITORY.has(name));
const INVALIDATING_ACTIONS = EVERY_ACTION.filter(([name]) => !DOES_NOT_WRITE.has(name));

/** Every repository call any action made, whichever repository it was. */
function repositoryCalls(): unknown[][] {
  return Object.values(repos).flatMap((repo) => repo.mock.calls as unknown[][]);
}

/** 32 bytes of base64 that is a sentence, so nothing here looks like a real key. */
const TEST_KEY = Buffer.from('not-a-real-key--not-a-real-key32').toString('base64');

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
  vi.stubEnv('BANK_TOKEN_ENCRYPTION_KEY', TEST_KEY);
  vi.mocked(auth).mockResolvedValue({
    user: { id: 'user-1' },
    expires: '2026-09-01',
  } as never);
  provider.current = {
    id: 'plaid',
    createLinkToken: bank.createLinkToken,
    exchangePublicToken: bank.exchangePublicToken,
    getAccounts: bank.getAccounts,
    removeItem: bank.removeItem,
  };
  requestHeaders.current = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example' };
});

describe('the actions on disk', () => {
  it('were found, so the gating test below is not checking nothing', () => {
    expect(DERIVED_ACTIONS.length).toBe(ACTION_COUNT);
  });

  it('are all functions, whatever module they came from', () => {
    const notFunctions = DERIVED_ACTIONS.filter(
      (action) => typeof action.value !== 'function'
    ).map((action) => `${action.module}:${action.name}`);

    expect(notFunctions).toEqual([]);
  });

  it('are exactly the ones the signed-in tests below have an input for', () => {
    // Those tests need a body per action and cannot be derived. This is what
    // keeps the two lists the same list.
    expect(DERIVED_ACTIONS.map((action) => action.name).sort()).toEqual(
      EVERY_ACTION.map(([name]) => `${name}Action`).sort()
    );
  });
});

describe('with no session', () => {
  it.each(DERIVED_ACTIONS.map((action) => [action.name, action.value] as const))(
    '%s refuses, and touches no repository',
    async (_name, action) => {
      vi.mocked(auth).mockResolvedValue(null as never);

      // Called with an empty input on purpose: `currentOwnerId()` is asked
      // before anything is validated, so an action that refuses only because
      // the body was wrong would be a different test passing by accident.
      await expect((action as (input: unknown) => Promise<unknown>)({})).resolves.toEqual({
        ok: false,
        error: 'Unauthorized',
      });
      for (const repo of Object.values(repos)) expect(repo).not.toHaveBeenCalled();
      // The bank is a repository too, as far as this rule is concerned: an
      // unauthenticated caller must not be able to mint a Link token or make
      // this deployment talk to Plaid on somebody's behalf.
      for (const call of Object.values(bank)) expect(call).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

describe('with a session', () => {
  it.each(EVERY_ACTION)('%s names the signed-in owner, and no other', async (_name, action, input) => {
    // Not an owner the caller named: no action takes one, and this is the
    // assertion that would fail if any of them started to. Every repository
    // call, not just the first, because an action that stores a connection and
    // then lists its accounts makes two.
    const result = await action(input);

    expect(result).toMatchObject({ ok: true });
    for (const call of repositoryCalls()) expect(call[1]).toBe('user-1');
  });

  it.each(WRITING_ACTIONS)('%s reaches a repository at all', async (_name, action, input) => {
    await action(input);

    expect(repositoryCalls().length).toBeGreaterThan(0);
  });

  it.each(INVALIDATING_ACTIONS)(
    '%s invalidates the pages that drew from it',
    async (_name, action, input) => {
      await action(input);

      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    }
  );

  it('mints a Link token without invalidating anything, because nothing changed', () => {
    // Spelled out so that "every action revalidates" narrowing to fewer than
    // all of them is a decision on the record rather than a list somebody
    // shortened.
    expect([...DOES_NOT_WRITE].sort()).toEqual(['createLinkToken', 'createReauthLinkToken']);
  });
});

describe('money', () => {
  it('reaches the repository as cents, however the user wrote it', async () => {
    await createProjectAction({
      name: 'Cedar Deck',
      clientName: 'R Henderson',
      quotedTotal: '$1,234.56',
      quotedMaterials: '750',
    });

    expect(repos.createProject).toHaveBeenCalledWith(
      {},
      'user-1',
      expect.objectContaining({ quotedTotalCents: 123456, quotedMaterialsCents: 75000 })
    );
  });

  it('falls back to the documented defaults for amounts left blank', async () => {
    await createProjectAction({ ...A_PROJECT, quotedMaterials: '', targetHourlyRate: '' });

    expect(repos.createProject).toHaveBeenCalledWith(
      {},
      'user-1',
      expect.objectContaining({ quotedMaterialsCents: 0, targetHourlyRateCents: 8500 })
    );
  });

  it('reads an accounting negative on an expense the way the bank wrote it', async () => {
    await createTransactionAction({ vendor: 'REFUND', amount: '(114.75)' });

    expect(repos.createTransaction).toHaveBeenCalledWith(
      {},
      'user-1',
      // Negative is money in (spec §8), and defaults to ignored so that a
      // refund is not counted as an expense - the same rule the CSV importer
      // applies, whether the row was typed or uploaded.
      expect.objectContaining({ amountCents: -11475, status: 'ignored' })
    );
  });

  it('files a positive expense against the job it was given', async () => {
    await createTransactionAction({ vendor: 'LOWES', amount: '10', projectId: 'proj-1' });

    expect(repos.createTransaction).toHaveBeenCalledWith(
      {},
      'user-1',
      expect.objectContaining({ status: 'matched', projectId: 'proj-1' })
    );
  });

  it('leaves a positive expense with no job in the inbox', async () => {
    await createTransactionAction({ vendor: 'LOWES', amount: '10' });

    expect(repos.createTransaction).toHaveBeenCalledWith(
      {},
      'user-1',
      expect.objectContaining({ status: 'unassigned' })
    );
  });
});

describe('what a form got wrong', () => {
  it('names the field rather than throwing, so nothing typed is lost', async () => {
    const result = await createProjectAction({ ...A_PROJECT, quotedTotal: 'about five grand' });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { quotedTotal: ['Enter an amount like 1,234.56'] },
    });
    expect(repos.createProject).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports a required field with the message a person can act on', async () => {
    const result = await createProjectAction({ clientName: 'R Henderson', quotedTotal: '10' });

    expect(result).toMatchObject({
      ok: false,
      error: 'Give the project a name',
      fieldErrors: { name: ['Give the project a name'] },
    });
  });

  it('reports several bad fields at once', async () => {
    const result = await createProjectAction({ quotedTotal: 'nope' });

    expect(result).toMatchObject({ ok: false });
    const { fieldErrors } = result as { fieldErrors: Record<string, string[]> };
    expect(Object.keys(fieldErrors).sort()).toEqual(['clientName', 'name', 'quotedTotal']);
  });

  it('refuses hours that are not a number', async () => {
    const result = await createLaborEntryAction({ projectId: 'proj-1', hours: 'eight' });

    expect(result).toMatchObject({ ok: false, fieldErrors: { hours: expect.any(Array) } });
    expect(repos.createLaborEntry).not.toHaveBeenCalled();
  });
});

describe('assigning a charge', () => {
  it('marks it matched against the job it was filed under', async () => {
    await assignTransactionAction({ id: 'tx-1', projectId: 'proj-9' });

    expect(repos.updateTransaction).toHaveBeenCalledWith({}, 'user-1', 'tx-1', {
      projectId: 'proj-9',
      status: 'matched',
      userEditedAt: expect.any(String),
    });
  });

  it('puts it back in the inbox when the job is cleared', async () => {
    // `null` rather than `undefined`: the repository reads an absent key as
    // "leave the filing alone", so undefined would leave the row pointing at
    // the job it was just taken off.
    await assignTransactionAction({ id: 'tx-1', projectId: '' });

    expect(repos.updateTransaction).toHaveBeenCalledWith({}, 'user-1', 'tx-1', {
      projectId: null,
      status: 'unassigned',
      userEditedAt: expect.any(String),
    });
  });

  it('reports a project that is not this owner’s as the caller’s mistake', async () => {
    const { UnknownProjectError } = await import('@budget-bot/db');
    repos.updateTransaction.mockRejectedValueOnce(new UnknownProjectError('proj-x') as never);

    const result = await assignTransactionAction({ id: 'tx-1', projectId: 'proj-x' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('proj-x') });
  });

  it('says so when the charge does not exist, without saying whose it might be', async () => {
    repos.updateTransaction.mockResolvedValueOnce(null as never);

    const result = await assignTransactionAction({ id: 'tx-nope', projectId: '' });

    expect(result).toEqual({ ok: false, error: 'No such charge.', fieldErrors: undefined });
  });
});

/**
 * `user_edited_at` is the whole of the sync merge rule's memory (ADR 0004):
 * once it is set, a re-sync stops overwriting the category, the vendor and
 * whether the charge is deductible. Nothing below the action can set it - a
 * repository is called the same way by a bank feed - so these two writes are
 * where a correction becomes a recorded fact, and this is the test that keeps
 * them that way.
 */
describe('correcting a charge', () => {
  it('records when the user touched it, so a re-sync stops overwriting them', async () => {
    const before = Date.now();

    await updateTransactionCategoryAction({ id: 'tx-1', category: 'tools' });

    expect(repos.updateTransaction).toHaveBeenCalledWith({}, 'user-1', 'tx-1', {
      category: 'tools',
      userEditedAt: expect.any(String),
    });
    const { userEditedAt } = repos.updateTransaction.mock.calls[0][3] as {
      userEditedAt: string;
    };
    expect(Date.parse(userEditedAt)).toBeGreaterThanOrEqual(before);
  });

  it('records it when a charge is filed against a job as well', async () => {
    await assignTransactionAction({ id: 'tx-1', projectId: 'proj-9' });

    const { userEditedAt } = repos.updateTransaction.mock.calls[0][3] as {
      userEditedAt: string;
    };
    expect(Number.isNaN(Date.parse(userEditedAt))).toBe(false);
  });
});

describe('marking an invoice paid', () => {
  it('records the date as well as the status, because revenue is dated', async () => {
    // Cash basis (ADR 0006): a `paid` invoice with no `paidDate` drops out of
    // every figure the payment should have appeared in.
    await markInvoicePaidAction({ id: 'inv-1' });

    expect(repos.updateInvoice).toHaveBeenCalledWith({}, 'user-1', 'inv-1', {
      status: 'paid',
      paidDate: new Date().toISOString().slice(0, 10),
    });
  });

  it('takes a date the caller supplies, for a payment recorded late', async () => {
    await markInvoicePaidAction({ id: 'inv-1', paidDate: '2026-08-11' });

    expect(repos.updateInvoice).toHaveBeenCalledWith(
      {},
      'user-1',
      'inv-1',
      expect.objectContaining({ paidDate: '2026-08-11' })
    );
  });
});

/**
 * Connecting a bank.
 *
 * Two things here are security decisions rather than features. The redirect
 * URI Plaid is told to send the browser back to is built from the request and
 * from `AUTH_URL`, never from anything the caller sent - a caller that could
 * name it could point a completed Link flow at a page it controls. And the
 * access token exists in plaintext for exactly as long as it takes to encrypt
 * it into a row: it is never returned, so it can never be logged by a caller
 * that logged an action's result (spec §9).
 */
describe('connecting a bank', () => {
  it('builds the redirect uri from the request, never from what was sent', async () => {
    await createLinkTokenAction();

    expect(bank.createLinkToken).toHaveBeenCalledWith({
      userId: 'user-1',
      redirectUri: 'https://app.example/plaid/oauth-return',
    });
  });

  it('reads the host directly when nothing is forwarding, and does not assume TLS', async () => {
    requestHeaders.current = { host: 'localhost:3000' };

    await createLinkTokenAction();

    expect(bank.createLinkToken).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'http://localhost:3000/plaid/oauth-return' })
    );
  });

  it('falls back to the deployment url when the request says nothing about itself', async () => {
    requestHeaders.current = {};
    // Through the validated `env`, not `process.env`: one schema decides what
    // a variable may be, and this is the last reader that was going round it.
    // The proxy memoizes its parse, so a stubbed variable needs the reset.
    vi.stubEnv('DATABASE_URL', 'postgres://stub/stub');
    vi.stubEnv('AUTH_URL', 'https://books.example/');
    resetEnvCache();

    await createLinkTokenAction();

    expect(bank.createLinkToken).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'https://books.example/plaid/oauth-return' })
    );
  });

  it('hands the browser the link token and nothing else', async () => {
    const result = await createLinkTokenAction();

    expect(result).toEqual({ ok: true, data: { linkToken: 'link-fake' } });
  });

  it.each([
    ['createLinkToken', () => createLinkTokenAction()],
    ['exchangePublicToken', () => exchangePublicTokenAction({ publicToken: 'public-fake' })],
    ['syncNow', () => syncNowAction({ connectionId: 'conn-1' })],
  ])('%s says so when this deployment has no Plaid credentials', async (_name, call) => {
    // A deployment with no credentials is a supported deployment: the screen
    // says Plaid is not configured. None of this throws.
    provider.current = null;

    await expect(call()).resolves.toMatchObject({
      ok: false,
      error: 'Plaid is not configured on this deployment',
    });
  });
});

describe('exchanging the public token', () => {
  it('stores the connection, loads its accounts, and runs a bounded first sync', async () => {
    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(result).toEqual({
      ok: true,
      data: {
        connectionId: 'conn-1',
        accounts: 2,
        firstSync: {
          added: 2,
          modified: 0,
          removed: 0,
          pages: 1,
          hasMore: false,
          unknownAccountCount: 0,
        },
      },
    });
    expect(repos.createConnection).toHaveBeenCalledWith(
      {},
      'user-1',
      expect.objectContaining({ itemId: 'item-fake', accessToken: 'access-fake' }),
      expect.anything()
    );
    expect(repos.upsertAccounts).toHaveBeenCalledWith(
      {},
      'user-1',
      'conn-1',
      expect.arrayContaining([expect.objectContaining({ externalId: 'fake-credit' })])
    );
    // Bounded, because this one runs inside the request that Link just
    // finished: a first sync of a long history must not hold it open.
    expect(bank.runSync).toHaveBeenCalledWith(
      {},
      'user-1',
      'conn-1',
      expect.objectContaining({ maxPages: 5 })
    );
  });

  it('never lets the access token out in what it returns', async () => {
    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(JSON.stringify(result)).not.toContain('access-fake');
  });

  it('keeps the stored connection when the first sync throws', async () => {
    // The token is already encrypted into a row by this point. Reporting the
    // whole thing as a failure would leave a connection nobody can see and
    // nobody can retry, so the sync's failure is a field on a success: the
    // connections screen shows it, and "Sync now" tries again.
    bank.runSync.mockRejectedValueOnce(new Error('the database went away mid-page'));

    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(result).toMatchObject({
      ok: true,
      data: { connectionId: 'conn-1', firstSync: { error: 'SYNC_FAILED' } },
    });
    expect(repos.createConnection).toHaveBeenCalled();
    // The code, never the message: a provider's message is free text from
    // somebody else's system and this one ends up on a settings screen.
    expect(JSON.stringify(result)).not.toContain('the database went away');
  });

  it('carries the provider’s own code when the first sync is refused', async () => {
    bank.runSync.mockRejectedValueOnce(
      new PlaidItemError('ITEM_LOGIN_REQUIRED', 'the user must log in again')
    );

    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(result).toMatchObject({
      ok: true,
      data: { firstSync: { error: 'ITEM_LOGIN_REQUIRED' } },
    });
  });

  it('refuses an empty public token before it talks to anybody', async () => {
    const result = await exchangePublicTokenAction({ publicToken: '' });

    expect(result).toMatchObject({ ok: false, fieldErrors: { publicToken: expect.any(Array) } });
    expect(bank.exchangePublicToken).not.toHaveBeenCalled();
  });

  describe('re-linking a bank that is already connected', () => {
    it('replaces the stored token and syncs, rather than refusing (spec §5b)', async () => {
      // Re-running Link against a bank that is already linked. Phase 2 refused
      // this outright; Phase 3 upserts onto the existing row instead - same
      // connection, a new token.
      repos.createConnection.mockRejectedValueOnce(new ConnectionAlreadyExistsError());

      const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

      expect(repos.replaceConnectionToken).toHaveBeenCalledWith(
        {},
        'user-1',
        expect.objectContaining({ itemId: 'item-fake', accessToken: 'access-fake' })
      );
      expect(result).toMatchObject({
        ok: true,
        data: { connectionId: 'conn-1' },
      });
      // The same refresh-then-sync the create path runs, because a new token
      // deserves the same first look as a brand-new connection.
      expect(repos.upsertAccounts).toHaveBeenCalled();
      expect(bank.runSync).toHaveBeenCalled();
    });

    it('keeps the Phase 2 message when the item belongs to a different owner', async () => {
      // The ownership check inside `replaceConnectionToken` is the one that
      // matters here: ConnectionAlreadyExistsError alone does not say whose
      // row it is, and a different owner's row must not be overwritten.
      repos.createConnection.mockRejectedValueOnce(new ConnectionAlreadyExistsError());
      repos.replaceConnectionToken.mockResolvedValueOnce(null);

      const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

      expect(result).toEqual({
        ok: false,
        error: 'This bank is already connected. Use Sync now on the existing connection.',
      });
      // Nothing was written, so nothing downstream ran either.
      expect(repos.upsertAccounts).not.toHaveBeenCalled();
      expect(bank.runSync).not.toHaveBeenCalled();
    });
  });
});

describe('syncing on demand', () => {
  it('refuses a connection this owner does not have, without saying whose it might be', async () => {
    repos.getConnection.mockResolvedValueOnce(null as never);

    const result = await syncNowAction({ connectionId: 'conn-9' });

    expect(result).toMatchObject({ ok: false, error: 'Connection not found' });
    expect(bank.runSync).not.toHaveBeenCalled();
  });

  it('pulls every page there is, because a person is waiting for all of it', async () => {
    await syncNowAction({ connectionId: 'conn-1' });

    const [, , , deps] = bank.runSync.mock.calls[0];
    expect(deps.maxPages).toBeUndefined();
  });

  it('reports what the run actually did', async () => {
    const result = await syncNowAction({ connectionId: 'conn-1' });

    expect(result).toEqual({
      ok: true,
      data: { added: 2, modified: 0, removed: 0, pages: 1, hasMore: false, unknownAccountCount: 0 },
    });
  });

  it('tells the owner when to come back rather than calling a rate limit a sync', async () => {
    // Everything the run committed stands - `runSync` returns rather than
    // throwing - but it did not finish, and a screen saying "synced" would be
    // a lie about a connection that is still behind.
    bank.runSync.mockResolvedValueOnce({
      added: 3,
      modified: 0,
      removed: 0,
      pages: 2,
      hasMore: true,
      unknownAccountCount: 0,
      retryAfterSeconds: 45,
    });

    const result = await syncNowAction({ connectionId: 'conn-1' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('45 seconds') });
  });

  it('asks the owner to reconnect when the bank wants them to sign in again', async () => {
    bank.runSync.mockRejectedValueOnce(
      new PlaidItemError('ITEM_LOGIN_REQUIRED', 'the user must log in again')
    );

    const result = await syncNowAction({ connectionId: 'conn-1' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('sign in again') });
    expect(JSON.stringify(result)).not.toContain('the user must log in again');
  });

  it('names the code and nothing else when the run fails some other way', async () => {
    bank.runSync.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.4:5432'));

    const result = await syncNowAction({ connectionId: 'conn-1' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('SYNC_FAILED') });
    expect(JSON.stringify(result)).not.toContain('10.0.0.4');
  });

  it('says another sync already has the connection, rather than reporting nothing', async () => {
    bank.runSync.mockResolvedValueOnce({ skipped: true });

    const result = await syncNowAction({ connectionId: 'conn-1' });

    expect(result).toMatchObject({ ok: true, data: { skipped: true } });
  });
});

/**
 * What happens when the bank says no.
 *
 * The first thing an owner does with a fresh deployment is press Connect, and
 * the most likely thing to happen is a Plaid failure: a `redirect_uri` that is
 * not registered against the client id, credentials from the wrong
 * environment, a public token that has already been spent. None of those are
 * exceptional - they are the ordinary first run - and an action that throws
 * out of them takes the browser to an error boundary, or worse, leaves the
 * island's `await` rejected with a button that says "Connecting…" for ever.
 *
 * So a provider failure is a value here, mapped by the same `syncFailureOf`
 * the connection's recorded state uses, and rendered as the code rather than
 * as the provider's message.
 */
describe('when the provider refuses', () => {
  it('reports a refused link token rather than throwing out of the action', async () => {
    bank.createLinkToken.mockRejectedValueOnce(
      new PlaidRequestError('INVALID_FIELD', 'redirect_uri must be registered: https://app.example')
    );

    const result = await createLinkTokenAction();

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('INVALID_FIELD') });
    // The code, not Plaid's sentence - and certainly not a URL it echoed back.
    expect(JSON.stringify(result)).not.toContain('must be registered');
  });

  it('reports a refused exchange, and stores no connection at all', async () => {
    bank.exchangePublicToken.mockRejectedValueOnce(
      new PlaidRequestError('INVALID_PUBLIC_TOKEN', 'public token has already been exchanged')
    );

    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('INVALID_PUBLIC_TOKEN'),
    });
    expect(repos.createConnection).not.toHaveBeenCalled();
    expect(bank.runSync).not.toHaveBeenCalled();
  });

  it('keeps the connection when the accounts cannot be listed, and says none were stored', async () => {
    // The token is encrypted into a row by this point. Throwing would strand
    // it; storing zero accounts and calling it a success would be worse still,
    // because every synced transaction would name an account that is not there
    // and be dropped. So: an honest count, the reason, and no sync to run.
    bank.getAccounts.mockRejectedValueOnce(
      new PlaidRequestError('PRODUCT_NOT_READY', 'the item is still being prepared')
    );

    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(result).toMatchObject({
      ok: true,
      data: { connectionId: 'conn-1', accounts: 0, firstSync: { error: 'PRODUCT_NOT_READY' } },
    });
    expect(repos.createConnection).toHaveBeenCalled();
    expect(bank.runSync).not.toHaveBeenCalled();
  });

  it('says a bank needs signing into again rather than naming a code at the owner', async () => {
    bank.exchangePublicToken.mockRejectedValueOnce(
      new PlaidItemError('ITEM_LOGIN_REQUIRED', 'the user must log in again')
    );

    const result = await exchangePublicTokenAction({ publicToken: 'public-fake' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('sign in again') });
  });
});

/**
 * Sync now refreshes the account list first.
 *
 * Two reasons, and the second is why it is unconditional. Balances move, and a
 * screen showing last week's is a screen nobody trusts. And a connection that
 * was stored without accounts - `getAccounts` failed straight after Link -
 * cannot sync at all: every transaction names an account that is not there, so
 * every page is dropped as `UNKNOWN_ACCOUNT` and the connection is permanently
 * useless. Refreshing here is what heals it, without a repair path anybody has
 * to know exists.
 */
describe('refreshing the accounts before a sync', () => {
  it('lists them through the stored token and upserts them before pulling anything', async () => {
    await syncNowAction({ connectionId: 'conn-1' });

    expect(repos.withAccessToken).toHaveBeenCalledWith(
      {},
      'user-1',
      'conn-1',
      expect.anything(),
      expect.any(Function)
    );
    expect(bank.getAccounts).toHaveBeenCalledWith('access-fake');
    expect(repos.upsertAccounts).toHaveBeenCalledWith(
      {},
      'user-1',
      'conn-1',
      expect.arrayContaining([expect.objectContaining({ externalId: 'fake-credit' })])
    );
    expect(repos.upsertAccounts.mock.invocationCallOrder[0]).toBeLessThan(
      bank.runSync.mock.invocationCallOrder[0]
    );
  });

  it('records why it stopped when the refresh itself fails, so the screen agrees', async () => {
    bank.getAccounts.mockRejectedValueOnce(
      new PlaidItemError('ITEM_LOGIN_REQUIRED', 'the user must log in again')
    );

    const result = await syncNowAction({ connectionId: 'conn-1' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('sign in again') });
    expect(repos.recordSyncError).toHaveBeenCalledWith({}, 'user-1', 'conn-1', {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'reauth_required',
    });
    expect(bank.runSync).not.toHaveBeenCalled();
  });
});

/**
 * Re-authentication, path a: Link's update mode (spec §5a).
 *
 * `createReauthLinkTokenAction` is the first half - it decrypts the stored
 * token and hands it to the provider so Link can re-authorize the same item
 * rather than create a new one. `markReconnectedAction` is the second half,
 * reached from `onSuccess` once update mode finishes with no public token to
 * exchange: it flips the connection back to healthy and runs the same
 * refresh-then-sync `syncNowAction` does, so a reconnect behaves exactly like
 * pressing "Sync now" the moment it succeeds.
 */
describe('minting an update-mode Link token', () => {
  it('checks ownership, then passes the existing access token through', async () => {
    await createReauthLinkTokenAction({ connectionId: 'conn-1' });

    expect(repos.getConnection).toHaveBeenCalledWith({}, 'user-1', 'conn-1');
    expect(repos.withAccessToken).toHaveBeenCalledWith(
      {},
      'user-1',
      'conn-1',
      expect.anything(),
      expect.any(Function)
    );
    expect(bank.createLinkToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', accessToken: 'access-fake' })
    );
  });

  it('refuses a connection this owner does not have, without asking Plaid for anything', async () => {
    repos.getConnection.mockResolvedValueOnce(null as never);

    const result = await createReauthLinkTokenAction({ connectionId: 'conn-9' });

    expect(result).toMatchObject({ ok: false, error: 'Connection not found' });
    expect(bank.createLinkToken).not.toHaveBeenCalled();
  });

  it('reports a refusal from the provider rather than throwing out of the action', async () => {
    bank.createLinkToken.mockRejectedValueOnce(
      new PlaidRequestError('INVALID_ACCESS_TOKEN', 'the access token is no longer valid')
    );

    const result = await createReauthLinkTokenAction({ connectionId: 'conn-1' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('INVALID_ACCESS_TOKEN') });
  });
});

describe('reconnecting once Link’s update mode succeeds', () => {
  it('activates the connection before refreshing and syncing it', async () => {
    const result = await markReconnectedAction({ connectionId: 'conn-1' });

    expect(repos.markConnectionActive).toHaveBeenCalledWith({}, 'user-1', 'conn-1');
    expect(repos.markConnectionActive.mock.invocationCallOrder[0]).toBeLessThan(
      bank.runSync.mock.invocationCallOrder[0]
    );
    expect(bank.getAccounts).toHaveBeenCalledWith('access-fake');
    expect(result).toMatchObject({
      ok: true,
      data: { added: 2, modified: 0, removed: 0, pages: 1, hasMore: false },
    });
  });

  it('refuses a connection this owner does not have', async () => {
    repos.markConnectionActive.mockResolvedValueOnce(false);

    const result = await markReconnectedAction({ connectionId: 'conn-9' });

    expect(result).toMatchObject({ ok: false, error: 'Connection not found' });
    expect(bank.getAccounts).not.toHaveBeenCalled();
    expect(bank.runSync).not.toHaveBeenCalled();
  });
});

/**
 * Disconnecting a bank (spec §6).
 *
 * `removeItem` is best-effort: the bank refusing to forget an item is not a
 * reason to keep showing a connection the owner asked to remove, so the
 * deletion runs either way and the provider's failure only shows up as
 * `removed: false` on an otherwise successful result.
 */
describe('disconnecting a bank', () => {
  it('checks ownership, tells the provider to forget the item, then deletes the connection', async () => {
    const result = await disconnectConnectionAction({ connectionId: 'conn-1' });

    expect(repos.getConnection).toHaveBeenCalledWith({}, 'user-1', 'conn-1');
    expect(repos.withAccessToken).toHaveBeenCalledWith(
      {},
      'user-1',
      'conn-1',
      expect.anything(),
      expect.any(Function)
    );
    expect(bank.removeItem).toHaveBeenCalledWith('access-fake');
    expect(repos.deleteConnection).toHaveBeenCalledWith({}, 'user-1', 'conn-1');
    // Deleted after the provider was asked, not before - a delete that ran
    // first would leave nothing for `withAccessToken` to decrypt.
    expect(bank.removeItem.mock.invocationCallOrder[0]).toBeLessThan(
      repos.deleteConnection.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({ ok: true, data: { removed: true } });
  });

  it('refuses a connection this owner does not have, without touching the provider', async () => {
    repos.getConnection.mockResolvedValueOnce(null as never);

    const result = await disconnectConnectionAction({ connectionId: 'conn-9' });

    expect(result).toMatchObject({ ok: false, error: 'Connection not found' });
    expect(bank.removeItem).not.toHaveBeenCalled();
    expect(repos.deleteConnection).not.toHaveBeenCalled();
  });

  it('still deletes the connection when the provider refuses to remove the item', async () => {
    bank.removeItem.mockRejectedValueOnce(
      new PlaidRequestError('INVALID_ACCESS_TOKEN', 'the access token is no longer valid')
    );

    const result = await disconnectConnectionAction({ connectionId: 'conn-1' });

    expect(repos.deleteConnection).toHaveBeenCalledWith({}, 'user-1', 'conn-1');
    // Success, not a refusal: the owner asked for this bank to be gone, and
    // it is. `removed: false` is the only trace the provider's own failure
    // leaves - never a message from Plaid reaching this screen.
    expect(result).toEqual({ ok: true, data: { removed: false } });
  });
});
