import { vi } from 'vitest';
import { parseMoney, type CardProfile } from '@budget-bot/core';
import { aKpi, aProject, aSummary, aTransaction, anInvoice } from './props';

/**
 * The shared scaffolding for the five route-island tests.
 *
 * Each island is the interactive half of a Server Component page: it takes the
 * query's result as props and calls server actions. So every one of these
 * tests needs the same two things — a coherent page's worth of data, and the
 * framework boundaries (`next/navigation`) stubbed — and they belong here
 * rather than copied five times.
 *
 * The server actions themselves are mocked per file, at the module boundary,
 * because which actions an island wires up is the thing under test.
 */

export const CARD: CardProfile = {
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

export const PROJECTS = [
  aProject({ id: 'proj-1', name: 'Cedar Deck', status: 'in_progress' }),
  aProject({
    id: 'proj-2',
    name: 'Kitchen Island',
    clientName: 'M Thorne',
    status: 'estimating',
  }),
];

export const KPIS = [
  aKpi({ projectId: 'proj-1', projectName: 'Cedar Deck', grossMarginPct: 18.4, grossMarginSeverity: 'critical' }),
  aKpi({ projectId: 'proj-2', projectName: 'Kitchen Island' }),
];

export const TRANSACTIONS = [
  aTransaction({ id: 'tx-1', vendor: 'The Home Depot', status: 'unassigned' }),
  aTransaction({
    id: 'tx-2',
    vendor: "Lowe's Home Improvement",
    amountCents: parseMoney(219),
    status: 'matched',
    projectId: 'proj-1',
  }),
];

export const INVOICES = [
  anInvoice({ id: 'inv-1', invoiceNumber: 'INV-2026-042', status: 'sent' }),
  anInvoice({
    id: 'inv-2',
    invoiceNumber: 'INV-2026-041',
    amountCents: parseMoney(6800),
    status: 'paid',
    paidDate: '2026-08-11',
  }),
];

export const WEEKS = [
  { weekStart: '2026-08-10', inflowCents: parseMoney(1950), outflowCents: parseMoney(1124.6), netCents: parseMoney(825.4) },
  { weekStart: '2026-08-17', inflowCents: parseMoney(1800), outflowCents: parseMoney(1188.75), netCents: parseMoney(611.25) },
];

export const SUMMARY = aSummary();

/**
 * `usePathname` and `useRouter` are the framework boundary every island sits
 * on — the header reads the path, and the CSV upload refreshes the tree the
 * way an action's `revalidatePath` would.
 */
export const router = { refresh: vi.fn(), push: vi.fn() };
export const pathname = { current: '/' };

export function mockNextNavigation() {
  return {
    usePathname: () => pathname.current,
    useRouter: () => router,
    notFound: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    }),
  };
}

/** A result an action returns when it refuses. */
export const refused = (error: string) => ({ ok: false as const, error });
export const succeeded = { ok: true as const, data: null };
