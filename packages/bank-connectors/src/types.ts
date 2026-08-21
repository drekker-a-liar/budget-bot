import type { Cents } from '@budget-bot/core';

/**
 * The contract every source of bank data satisfies (spec §8).
 *
 * It is written down in full now, with only the CSV provider behind it,
 * because the shape is the decision: `PlaidProvider` arrives in sub-project 2
 * and must not be able to change what the application above it expects. A
 * provider is stateless - it maps between one bank's wire format and these
 * types, and knows nothing about owners, storage, or what the user has
 * already filed.
 *
 * ## The sign convention
 *
 * **Positive is money out.** A $114.75 purchase at a hardware store is
 * `+11475`. A refund, a card payment and a deposit are all negative. Plaid
 * uses this convention and the database column repeats it (ADR 0004), so the
 * one place it could be inverted is here, in a provider - which is why it is
 * written on the field itself as well as on this interface.
 *
 * Negative rows are stored rather than dropped, and default to
 * `status: 'ignored'`: a card payment is real, but counting it as an expense
 * would double-count the purchases it settles.
 */

/** Which provider a row, an account or a connection came from. */
export type BankProviderId = 'plaid' | 'csv';

/** One transaction, in the shape the application stores (spec §5). */
export interface NormalizedTransaction {
  /**
   * The provider's identity for this transaction, stable across syncs. The
   * partial unique index `(provider, bank_account_id, external_id)` upserts on
   * it, so a provider that cannot produce a stable one has to derive it.
   */
  externalId: string;
  /** The provider's id for the account this belongs to. */
  accountExternalId: string;
  /** Posting date as `YYYY-MM-DD`, which is what the ledger sorts on. */
  date: string;
  /** When it posted, to the second, when the provider says. */
  postedAt: Date | null;
  /** When the card was actually swiped, when the provider distinguishes. */
  authorizedDate: string | null;
  /** Positive is money out. See the sign convention above. */
  amountCents: Cents;
  /** The bank's own text, verbatim - never cleaned up, never truncated. */
  rawDescriptor: string;
  /** The merchant, when the provider resolves one out of the descriptor. */
  merchantName: string | null;
  /** Still authorizing: the amount and the date can both still change. */
  pending: boolean;
  /** Set on a posted row that supersedes a pending one, so it can inherit it. */
  pendingTransactionId: string | null;
  /** The provider's guess at a category. A hint: the user's choice wins. */
  categoryHintPrimary: string | null;
  categoryHintDetailed: string | null;
  /** ISO 4217, when the provider says. */
  isoCurrencyCode: string | null;
}

/** One account behind a connection. */
export interface NormalizedAccount {
  externalId: string;
  name: string;
  officialName: string | null;
  /**
   * The last four digits, and never anything more: no full number reaches this
   * system from any provider, by design (spec §7).
   */
  mask: string | null;
  /** `credit`, `depository`, ... - whatever the provider calls it. */
  type: string;
  subtype: string | null;
  currentBalanceCents: Cents | null;
  availableBalanceCents: Cents | null;
  creditLimitCents: Cents | null;
  isoCurrencyCode: string | null;
}

/** One page of a cursor-based sync (ADR 0004). */
export interface SyncResult {
  added: NormalizedTransaction[];
  modified: NormalizedTransaction[];
  /** External ids the provider says are gone. */
  removed: string[];
  /** Commit this after the page lands, not before. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** A webhook the provider sent, once its signature has been checked. */
export interface WebhookEvent {
  /** The provider's event type, e.g. `TRANSACTIONS`. */
  type: string;
  /** The provider's event code, e.g. `SYNC_UPDATES_AVAILABLE`. */
  code: string | null;
  /** The connection this is about, when the payload names one. */
  itemId: string | null;
  /** Hash of the raw body: the replay ledger's key (spec §7). */
  bodyHash: string;
  /** The payload as it arrived, for the parts this system does not model. */
  payload: unknown;
}

export interface CreateLinkTokenArgs {
  /** The signed-in user, as the provider should see them. */
  userId: string;
  /** Where the provider sends the user back after an OAuth institution. */
  redirectUri?: string;
  /** An existing connection to re-authorize rather than create. */
  accessToken?: string;
  /**
   * Where the provider should post updates for this connection. Optional
   * because it is only useful once there is a public URL to post to, and a
   * local development run has none.
   */
  webhookUrl?: string;
}

export interface LinkToken {
  linkToken: string;
  /** ISO 8601. Link tokens are short-lived. */
  expiration: string;
}

export interface ExchangedItem {
  /** Encrypted before it reaches the database (ADR 0002). */
  accessToken: string;
  itemId: string;
  institutionId?: string;
  institutionName?: string;
}

export interface BankProvider {
  readonly id: BankProviderId;

  createLinkToken(args: CreateLinkTokenArgs): Promise<LinkToken>;
  exchangePublicToken(publicToken: string): Promise<ExchangedItem>;
  getAccounts(accessToken: string): Promise<NormalizedAccount[]>;
  syncTransactions(accessToken: string, cursor: string | null): Promise<SyncResult>;
  removeItem(accessToken: string): Promise<void>;
  verifyAndParseWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<WebhookEvent>;
}
