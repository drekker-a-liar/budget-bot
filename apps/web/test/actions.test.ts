import { beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

vi.mock('@budget-bot/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budget-bot/db')>()),
  getDb: () => ({}),
  projectsRepo: { createProject: repos.createProject, updateProject: repos.updateProject },
  transactionsRepo: {
    createTransaction: repos.createTransaction,
    updateTransaction: repos.updateTransaction,
    deleteTransaction: repos.deleteTransaction,
  },
  laborRepo: {
    createLaborEntry: repos.createLaborEntry,
    deleteLaborEntry: repos.deleteLaborEntry,
  },
  invoicesRepo: { createInvoice: repos.createInvoice, updateInvoice: repos.updateInvoice },
}));

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

/** Ten today. A number here means shrinkage gets noticed, not just growth. */
const ACTION_COUNT = 10;

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
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: 'user-1' },
    expires: '2026-09-01',
  } as never);
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
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

describe('with a session', () => {
  it.each(EVERY_ACTION)('%s writes as the signed-in owner', async (_name, action, input) => {
    // Not as an owner the caller named: no action takes one, and this is the
    // assertion that would fail if any of them started to.
    const result = await action(input);

    expect(result).toMatchObject({ ok: true });
    const called = Object.values(repos).filter((repo) => repo.mock.calls.length > 0);
    expect(called.length).toBe(1);
    expect(called[0]).toHaveBeenCalledWith({}, 'user-1', ...called[0].mock.calls[0].slice(2));
    expect(called[0].mock.calls[0][1]).toBe('user-1');
  });

  it.each(EVERY_ACTION)('%s invalidates the pages that drew from it', async (_name, action, input) => {
    await action(input);

    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
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
