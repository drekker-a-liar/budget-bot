import 'server-only';
import { cache } from 'react';
import { bankRepo, getDb, transactionsRepo } from '@budget-bot/db';
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
 *
 * ## Why these are view types rather than the repository's rows
 *
 * Everything a Server Component hands a client component is serialised into
 * the RSC payload, which is HTML the browser can read. The connection row
 * carries three columns the screen has no use for and nobody should be shipped
 * a copy of: `cursor` is the provider's pagination state, `itemId` is Plaid's
 * own identifier for the login, and `encryptionKeyId` names which key wrote
 * the token's ciphertext. None is a secret on its own; all three are internal,
 * and the reason to build the payload out of a named list rather than a spread
 * is the same reason `CONNECTION_COLUMNS` is a named list in the repository -
 * so that a column added later is absent from it until somebody decides it
 * should be visible.
 */

/** One linked account, as the table on the screen draws it. */
export interface AccountView {
  id: string;
  name: string | null;
  officialName: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalanceCents: number | null;
  creditLimitCents: number | null;
}

/** One connection, as the card on the screen draws it. */
export interface ConnectionView {
  id: string;
  institutionName: string | null;
  status: string;
  /** The code a failed sync recorded. Never a provider's message (spec §9). */
  lastErrorCode: string | null;
  lastSyncedAt: string | null;
  accounts: AccountView[];
}

export interface ConnectionsPageData {
  /** False when this deployment has no bank provider configured. */
  configured: boolean;
  kind: BankProviderKind | null;
  connections: ConnectionView[];
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
      connections: connections.map((connection) => ({
        id: connection.id,
        institutionName: connection.institutionName,
        status: connection.status,
        lastErrorCode: connection.lastErrorCode,
        lastSyncedAt: connection.lastSyncedAt,
        accounts: connection.accounts.map((account) => ({
          id: account.id,
          name: account.name,
          officialName: account.officialName,
          mask: account.mask,
          type: account.type,
          subtype: account.subtype,
          currentBalanceCents: account.currentBalanceCents,
          creditLimitCents: account.creditLimitCents,
        })),
      })),
      unassignedCount: countUnassigned(transactions),
    };
  }
);
