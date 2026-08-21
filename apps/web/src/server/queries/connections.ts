import 'server-only';
import { cache } from 'react';
import {
  bankRepo,
  getDb,
  transactionsRepo,
  type BankAccount,
  type BankConnection,
} from '@budget-bot/db';
import { getBankProviderKind, type BankProviderKind } from '@/src/server/bank/provider';
import { countUnassigned } from './projects';

/**
 * What the connections screen reads.
 *
 * `configured` is the part that is not a database read. A deployment with no
 * Plaid credentials is a supported deployment (spec §7), and the screen has to
 * say so rather than offering a "Connect a bank" button that can only fail. So
 * the provider factory is asked here, on the server, and the answer travels to
 * the island as a prop - the browser never learns anything about the
 * environment beyond which of two screens it is looking at.
 *
 * `kind` goes with it because the two providers are connected differently: a
 * real one opens Plaid Link, and the scripted one behind the `E2E=1` door has
 * no UI to open at all.
 */

export interface ConnectionsPageData {
  /** False when this deployment has no bank provider configured. */
  configured: boolean;
  kind: BankProviderKind | null;
  connections: Array<BankConnection & { accounts: BankAccount[] }>;
  /** For the header badge, which every page carries. */
  unassignedCount: number;
}

export const getConnectionsPage = cache(
  async (ownerId: string): Promise<ConnectionsPageData> => {
    const db = getDb();
    const kind = getBankProviderKind();

    const [connections, transactions] = await Promise.all([
      // Never the token: `listConnections` names its columns, and the
      // ciphertext is not one of them (ADR 0002).
      bankRepo.listConnections(db, ownerId),
      transactionsRepo.listTransactions(db, ownerId),
    ]);

    return {
      configured: kind !== null,
      kind,
      connections,
      unassignedCount: countUnassigned(transactions),
    };
  }
);
