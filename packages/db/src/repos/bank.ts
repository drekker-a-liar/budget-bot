import type { CardProfile } from '@budget-bot/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database, Executor } from '../client';
import { decryptToken, encryptToken, type TokenKeyring } from '../crypto';
import { bankAccounts, bankConnections } from '../schema';
import { ConnectionNotFoundError, rejectingDuplicateConnection } from './errors';
import { isUuid, toIso, toIsoOrNull } from './rows';

/**
 * The card the dashboard shows. `CardProfile` is the prototype's shape - one
 * card, flat - while the tables model many accounts behind many connections.
 * Until the card UI is rebuilt, the profile is synthesised from the first
 * enabled *credit* account (spec §6): a view over the real tables rather than
 * a second copy of the data that could disagree with them.
 *
 * Credit, and null when there is none, because the screen this feeds draws a
 * credit card - a name behind a card icon, a balance against a limit. One
 * Plaid Item usually carries a checking account too, and it is usually the
 * older row, so without the filter the header pill labels somebody's current
 * account as their card and reports its limit as $0.
 */

export type CardProfileUpdate = Partial<Omit<CardProfile, 'id'>>;

interface CardRow {
  id: string;
  cardName: string | null;
  name: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
  limitCents: number | null;
  cycleResetDay: number | null;
  balancesUpdatedAt: Date | null;
  updatedAt: Date;
  institutionName: string | null;
}

function toCardProfile(row: CardRow): CardProfile {
  return {
    id: row.id,
    cardName: row.cardName ?? row.name ?? '',
    issuer: row.institutionName ?? '',
    last4: row.mask ?? '',
    // Not a guess: `firstEnabledCreditAccount` is the only way a row reaches
    // here, and it returns credit lines or nothing.
    cardType: 'credit',
    currentBalanceCents: (row.currentBalanceCents ?? 0) as CardProfile['currentBalanceCents'],
    creditLimitCents: (row.limitCents ?? 0) as CardProfile['creditLimitCents'],
    cycleResetDay: row.cycleResetDay ?? 1,
    lastSyncedAt: toIso(row.balancesUpdatedAt ?? row.updatedAt),
  };
}

async function firstEnabledCreditAccount(
  db: Database,
  ownerId: string
): Promise<CardRow | undefined> {
  const [row] = await db
    .select({
      id: bankAccounts.id,
      cardName: bankAccounts.cardName,
      name: bankAccounts.name,
      mask: bankAccounts.mask,
      currentBalanceCents: bankAccounts.currentBalanceCents,
      limitCents: bankAccounts.limitCents,
      cycleResetDay: bankAccounts.cycleResetDay,
      balancesUpdatedAt: bankAccounts.balancesUpdatedAt,
      updatedAt: bankAccounts.updatedAt,
      institutionName: bankConnections.institutionName,
    })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(
      and(
        eq(bankAccounts.ownerId, ownerId),
        eq(bankAccounts.isEnabled, true),
        // The whole of the fix: `created_at` alone picks whichever account the
        // provider happened to list first, which for a Plaid Item is normally
        // the checking one.
        eq(bankAccounts.type, 'credit')
      )
    )
    .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id))
    .limit(1);
  return row;
}

/** Null until the owner has an enabled credit account behind some connection. */
export async function getCardProfile(
  db: Database,
  ownerId: string
): Promise<CardProfile | null> {
  const row = await firstEnabledCreditAccount(db, ownerId);
  return row ? toCardProfile(row) : null;
}

/**
 * Writes back only the fields the card screen actually lets a user change.
 * Balances and the mask come from the provider and are not editable here.
 */
export async function updateCardProfile(
  db: Database,
  ownerId: string,
  updates: CardProfileUpdate
): Promise<CardProfile | null> {
  const existing = await firstEnabledCreditAccount(db, ownerId);
  if (!existing) return null;

  await db
    .update(bankAccounts)
    .set({
      ...(updates.cardName !== undefined && { cardName: updates.cardName }),
      ...(updates.cycleResetDay !== undefined && { cycleResetDay: updates.cycleResetDay }),
      updatedAt: new Date(),
    })
    .where(and(eq(bankAccounts.ownerId, ownerId), eq(bankAccounts.id, existing.id)));

  return getCardProfile(db, ownerId);
}

/**
 * Bank connections and the accounts behind them.
 *
 * The access token is the reason this file is careful. It is a long-lived
 * credential that can pull someone's whole transaction history, so it is
 * encrypted before it reaches the database (ADR 0002) and there is exactly one
 * function that can turn it back into a string - `withAccessToken`, which
 * hands the plaintext to a callback and never returns it. Every other read
 * here names its columns explicitly rather than selecting the row, so that
 * widening a query cannot quietly put a credential in a payload.
 */

/** A connection as the application sees it: everything except the token. */
export interface BankConnection {
  id: string;
  provider: string;
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  /** Which key wrote the ciphertext, so a rotation can find what it has left. */
  encryptionKeyId: string;
  /** The `/transactions/sync` cursor, committed only after a page lands. */
  cursor: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One linked account, in the shape the provider and the UI both speak. */
export interface BankAccount {
  id: string;
  connectionId: string;
  externalId: string;
  name: string | null;
  officialName: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  creditLimitCents: number | null;
  isoCurrencyCode: string | null;
  isEnabled: boolean;
  balancesUpdatedAt: string | null;
}

export interface NewBankConnection {
  provider?: string;
  /** The provider's identifier for the linked login (Plaid Item). */
  itemId: string;
  /** Plaintext. Encrypted inside `createConnection` and never stored as-is. */
  accessToken: string;
  institutionId?: string | null;
  institutionName?: string | null;
}

/**
 * What `upsertAccounts` needs from a provider.
 *
 * Declared here rather than imported: `@budget-bot/bank-connectors`'
 * `NormalizedAccount` satisfies it structurally, and this package has no
 * business depending on a package that speaks HTTP to Plaid.
 */
export interface BankAccountInput {
  externalId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  creditLimitCents: number | null;
  isoCurrencyCode: string | null;
}

/** What a completed sync leaves on the connection. */
export interface SyncOutcome {
  added: number;
  modified: number;
  removed: number;
  pages: number;
  hasMore: boolean;
  /**
   * Rows a page named an account for that this connection does not have.
   * Transient like the rest of this type - `recordSyncResult` does not store
   * it - because the durable trace of it is the `UNKNOWN_ACCOUNT` code
   * `runSync` records on the connection, not a count that would go stale the
   * moment the next sync ran.
   */
  unknownAccountCount: number;
}

export interface SyncFailure {
  /** The provider's error code, e.g. `ITEM_LOGIN_REQUIRED`. Never a message. */
  code: string;
  status: 'error' | 'reauth_required';
}

/**
 * Every column of a connection except the ciphertext.
 *
 * Written out rather than `select()` on purpose: this list is what makes "no
 * read path returns the token" a property of the code instead of a promise,
 * and a column added to the table later is absent here until someone decides
 * it should be visible.
 */
const CONNECTION_COLUMNS = {
  id: bankConnections.id,
  provider: bankConnections.provider,
  itemId: bankConnections.itemId,
  institutionId: bankConnections.institutionId,
  institutionName: bankConnections.institutionName,
  encryptionKeyId: bankConnections.encryptionKeyId,
  cursor: bankConnections.cursor,
  status: bankConnections.status,
  lastSyncedAt: bankConnections.lastSyncedAt,
  lastErrorCode: bankConnections.lastErrorCode,
  lastErrorAt: bankConnections.lastErrorAt,
  createdAt: bankConnections.createdAt,
  updatedAt: bankConnections.updatedAt,
};

type ConnectionRow = {
  [K in keyof typeof CONNECTION_COLUMNS]: (typeof bankConnections.$inferSelect)[K];
};

function toConnection(row: ConnectionRow): BankConnection {
  return {
    id: row.id,
    provider: row.provider,
    itemId: row.itemId,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    encryptionKeyId: row.encryptionKeyId,
    cursor: row.cursor,
    status: row.status,
    lastSyncedAt: toIsoOrNull(row.lastSyncedAt),
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: toIsoOrNull(row.lastErrorAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toAccount(row: typeof bankAccounts.$inferSelect): BankAccount {
  return {
    id: row.id,
    connectionId: row.connectionId,
    externalId: row.externalAccountId,
    name: row.name,
    officialName: row.officialName,
    mask: row.mask,
    type: row.type,
    subtype: row.subtype,
    currentBalanceCents: row.currentBalanceCents,
    availableBalanceCents: row.availableBalanceCents,
    // The column is `limit_cents`; the providers all call it a credit limit.
    creditLimitCents: row.limitCents,
    isoCurrencyCode: row.isoCurrencyCode,
    isEnabled: row.isEnabled,
    balancesUpdatedAt: toIsoOrNull(row.balancesUpdatedAt),
  };
}

/**
 * Stores a linked login, with its token encrypted under the current key.
 *
 * Two statements in one transaction because the AAD is the row's own id (ADR
 * 0002), which Postgres only tells us once the row exists: insert to get the
 * id, encrypt against it, update. The empty ciphertext the first statement
 * writes never outlives the transaction - a failure anywhere in here rolls
 * both statements back rather than leaving a connection nothing can read.
 *
 * Linking a bank that is already linked is the one failure a person can reach
 * on purpose, and it arrives here as a raw `unique_violation` on
 * `(provider, item_id)`. It leaves as `ConnectionAlreadyExistsError` so the
 * caller has something to say: by this point the public token has been spent,
 * so "try again" is advice that cannot work.
 */
export async function createConnection(
  db: Database,
  ownerId: string,
  input: NewBankConnection,
  keyring: TokenKeyring
): Promise<BankConnection> {
  return rejectingDuplicateConnection(() =>
    db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(bankConnections)
        .values({
          ownerId,
          provider: input.provider ?? 'plaid',
          itemId: input.itemId,
          institutionId: input.institutionId ?? null,
          institutionName: input.institutionName ?? null,
          accessTokenCiphertext: '',
          encryptionKeyId: keyring.current.keyId,
        })
        .returning({ id: bankConnections.id });

      const [row] = await tx
        .update(bankConnections)
        .set({
          accessTokenCiphertext: encryptToken(input.accessToken, {
            keyId: keyring.current.keyId,
            key: keyring.current.key,
            aad: inserted.id,
          }),
          updatedAt: new Date(),
        })
        .where(eq(bankConnections.id, inserted.id))
        .returning(CONNECTION_COLUMNS);

      return toConnection(row);
    })
  );
}

/**
 * Runs `fn` with the connection's access token in plaintext.
 *
 * The only place in the system a token is a string. It exists for the length
 * of the callback and is neither returned nor stored, so a caller that wants
 * to keep it has to go out of its way - which is the point. The lookup carries
 * the owner, so this is also the check that a sync cannot be pointed at
 * somebody else's Item by passing its id.
 */
export async function withAccessToken<T>(
  db: Executor,
  ownerId: string,
  connectionId: string,
  keyring: TokenKeyring,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  if (!isUuid(connectionId)) throw new ConnectionNotFoundError();

  const [row] = await db
    .select({
      id: bankConnections.id,
      accessTokenCiphertext: bankConnections.accessTokenCiphertext,
    })
    .from(bankConnections)
    .where(
      and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, connectionId))
    )
    .limit(1);
  if (!row) throw new ConnectionNotFoundError();

  return fn(decryptToken(row.accessTokenCiphertext, { keys: keyring.keys, aad: row.id }));
}

export async function getConnection(
  db: Executor,
  ownerId: string,
  id: string
): Promise<BankConnection | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select(CONNECTION_COLUMNS)
    .from(bankConnections)
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, id)))
    .limit(1);
  return row ? toConnection(row) : null;
}

/** What a webhook route needs to know about a connection, and nothing more. */
export interface BankConnectionByItem {
  id: string;
  ownerId: string;
  status: string;
}

/**
 * The connection a provider's item id names, across every owner.
 *
 * Cross-owner by design: a webhook arrives with an item id and nothing else -
 * there is no session on that route, and the whole point of this lookup is to
 * find out whose connection it is (spec §3). The projection is deliberately
 * narrower than `CONNECTION_COLUMNS`: a payload's signature has only just been
 * checked when this runs, and the one thing that must never be one step away
 * from a webhook body is the ciphertext column.
 */
export async function findConnectionByItemId(
  db: Executor,
  itemId: string
): Promise<BankConnectionByItem | null> {
  const [row] = await db
    .select({
      id: bankConnections.id,
      ownerId: bankConnections.ownerId,
      status: bankConnections.status,
    })
    .from(bankConnections)
    .where(eq(bankConnections.itemId, itemId))
    .limit(1);
  return row ?? null;
}

/** What the cron sync (spec §4) needs to reach a connection - nothing else. */
export interface ActiveConnectionByOwner {
  id: string;
  ownerId: string;
}

/**
 * Every connection with `status = 'active'`, across every owner.
 *
 * Cross-owner by design, the same way `findConnectionByItemId` is: the daily
 * cron sync has no owner of its own to run as - it exists to catch up
 * whatever the webhook path missed, for everyone (spec §4). The projection is
 * narrower than `CONNECTION_COLUMNS` for the same reason it is there: the
 * ciphertext column must never be one step away from a caller with no session
 * to scope it. Token access for the connections this returns happens
 * per-connection, through `withAccessToken`.
 */
export async function listActiveConnectionsAllOwners(
  db: Executor
): Promise<ActiveConnectionByOwner[]> {
  return db
    .select({ id: bankConnections.id, ownerId: bankConnections.ownerId })
    .from(bankConnections)
    .where(eq(bankConnections.status, 'active'))
    .orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
}

/** Every connection the owner has linked, each with the accounts behind it. */
export async function listConnections(
  db: Executor,
  ownerId: string
): Promise<Array<BankConnection & { accounts: BankAccount[] }>> {
  const rows = await db
    .select(CONNECTION_COLUMNS)
    .from(bankConnections)
    .where(eq(bankConnections.ownerId, ownerId))
    .orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
  if (rows.length === 0) return [];

  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.ownerId, ownerId))
    .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id));

  return rows.map((row) => ({
    ...toConnection(row),
    accounts: accounts
      .filter((account) => account.connectionId === row.id)
      .map(toAccount),
  }));
}

/** One connection, projected to what an export may carry (spec §6). */
export interface ExportConnection {
  institutionName: string | null;
  status: string;
  createdAt: string;
  lastSyncedAt: string | null;
  accounts: Array<{
    name: string | null;
    mask: string | null;
    type: string | null;
    subtype: string | null;
    isEnabled: boolean;
  }>;
}

/**
 * Every connection the owner has linked, projected down to what `/api/export`
 * may hand back (spec §6): never the ciphertext, the cursor, the item id or
 * the encryption key id - and no id at all, for the connection or for an
 * account, because an export describes what is connected rather than handing
 * out a handle back into this database. `CONNECTION_COLUMNS` is deliberately
 * not reused here: it is already narrower than the table, but still carries
 * `cursor` and `encryptionKeyId`, which is exactly the pair this projection
 * exists to drop.
 */
export async function listConnectionsForExport(
  db: Executor,
  ownerId: string
): Promise<ExportConnection[]> {
  const rows = await db
    .select({
      id: bankConnections.id,
      institutionName: bankConnections.institutionName,
      status: bankConnections.status,
      createdAt: bankConnections.createdAt,
      lastSyncedAt: bankConnections.lastSyncedAt,
    })
    .from(bankConnections)
    .where(eq(bankConnections.ownerId, ownerId))
    .orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
  if (rows.length === 0) return [];

  const accounts = await db
    .select({
      connectionId: bankAccounts.connectionId,
      name: bankAccounts.name,
      mask: bankAccounts.mask,
      type: bankAccounts.type,
      subtype: bankAccounts.subtype,
      isEnabled: bankAccounts.isEnabled,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.ownerId, ownerId))
    .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id));

  return rows.map((row) => ({
    institutionName: row.institutionName,
    status: row.status,
    createdAt: toIso(row.createdAt),
    lastSyncedAt: toIsoOrNull(row.lastSyncedAt),
    accounts: accounts
      .filter((account) => account.connectionId === row.id)
      .map(({ name, mask, type, subtype, isEnabled }) => ({ name, mask, type, subtype, isEnabled })),
  }));
}

export async function listAccounts(
  db: Executor,
  ownerId: string,
  connectionId: string
): Promise<BankAccount[]> {
  if (!isUuid(connectionId)) return [];
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.ownerId, ownerId),
        eq(bankAccounts.connectionId, connectionId)
      )
    )
    .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id));
  return rows.map(toAccount);
}

/**
 * Applies the account list a provider returned, keyed on
 * `(connection, external id)`.
 *
 * The same split as the transaction merge rule (ADR 0004): balances, names and
 * masks come from the bank and are overwritten every time; `is_enabled`,
 * `card_name` and `cycle_reset_day` are the user's and are not in the set
 * clause at all. Re-listing an account the owner switched off is not an
 * argument for switching it back on.
 */
export async function upsertAccounts(
  db: Executor,
  ownerId: string,
  connectionId: string,
  accounts: BankAccountInput[]
): Promise<BankAccount[]> {
  const connection = await getConnection(db, ownerId, connectionId);
  if (!connection) throw new ConnectionNotFoundError();
  if (accounts.length === 0) return [];

  const now = new Date();
  const rows = await db
    .insert(bankAccounts)
    .values(
      accounts.map((account) => ({
        ownerId,
        connectionId,
        externalAccountId: account.externalId,
        name: account.name,
        officialName: account.officialName,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        currentBalanceCents: account.currentBalanceCents,
        availableBalanceCents: account.availableBalanceCents,
        limitCents: account.creditLimitCents,
        isoCurrencyCode: account.isoCurrencyCode,
        balancesUpdatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [bankAccounts.connectionId, bankAccounts.externalAccountId],
      set: {
        name: sql`excluded.name`,
        officialName: sql`excluded.official_name`,
        mask: sql`excluded.mask`,
        type: sql`excluded.type`,
        subtype: sql`excluded.subtype`,
        currentBalanceCents: sql`excluded.current_balance_cents`,
        availableBalanceCents: sql`excluded.available_balance_cents`,
        limitCents: sql`excluded.limit_cents`,
        isoCurrencyCode: sql`excluded.iso_currency_code`,
        balancesUpdatedAt: now,
        updatedAt: now,
      },
      setWhere: eq(bankAccounts.ownerId, ownerId),
    })
    .returning();

  return rows.map(toAccount);
}

/**
 * Commits the cursor a page was applied under.
 *
 * Called with the page's transaction so the two commit together: a cursor that
 * moved without its page would skip transactions permanently, which is the one
 * failure `/transactions/sync` cannot recover from (ADR 0004).
 */
export async function setCursor(
  db: Executor,
  ownerId: string,
  id: string,
  cursor: string
): Promise<void> {
  if (!isUuid(id)) return;
  await db
    .update(bankConnections)
    .set({ cursor, updatedAt: new Date() })
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, id)));
}

/**
 * Marks a sync as finished, clearing whatever the last one left behind.
 *
 * The counts are not stored: there is no column for them and inventing one for
 * a number nothing reads would be worse than passing it. They are in the
 * signature because a sync reports its outcome in one place, and that place
 * should be the one that also clears the error.
 */
export async function recordSyncResult(
  db: Executor,
  ownerId: string,
  id: string,
  _outcome: SyncOutcome
): Promise<void> {
  if (!isUuid(id)) return;
  await db
    .update(bankConnections)
    .set({
      status: 'active',
      lastSyncedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, id)));
}

/**
 * Records why a sync stopped.
 *
 * The code only, never the provider's message: a message is free text from
 * somebody else's system, it ends up on a settings screen, and the one thing
 * that must never reach a screen or a log is the token (spec §9).
 */
export async function recordSyncError(
  db: Executor,
  ownerId: string,
  id: string,
  failure: SyncFailure
): Promise<void> {
  if (!isUuid(id)) return;
  await db
    .update(bankConnections)
    .set({
      status: failure.status,
      lastErrorCode: failure.code,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, id)));
}

/** What the re-link upsert needs to replace a stored token with a new one. */
export interface ReplaceConnectionTokenInput {
  /** The provider's identifier for the linked login (Plaid Item). */
  itemId: string;
  /** Plaintext. Encrypted inside this function and never stored as-is. */
  accessToken: string;
  keyring: TokenKeyring;
}

/**
 * Re-authentication, path b: a second Link run against a bank that is already
 * connected (spec §5).
 *
 * The caller reaches here from `ConnectionAlreadyExistsError`, which names an
 * item id and nothing else - there is no connection id, because the point of
 * that error is that the row already existed before this call started. So
 * this looks the row up itself and re-encrypts against its own id, the same
 * two-step `createConnection` uses (ADR 0002): the AAD is the *existing* row's
 * id, not a fresh one, because this is the same connection wearing a new
 * token.
 *
 * `null` means the item is somebody else's - the row is left completely
 * alone, not even touched by a query, so that a cross-tenant re-link cannot
 * overwrite a token it has no business replacing. The caller falls back to
 * the Phase 2 message: "This bank is already connected."
 *
 * The cursor is deliberately absent from the `set`: it is the same Plaid Item,
 * so `/transactions/sync`'s cursor is still valid, and clearing it would
 * re-fetch the item's entire history for no reason.
 */
export async function replaceConnectionToken(
  db: Executor,
  ownerId: string,
  input: ReplaceConnectionTokenInput
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: bankConnections.id, ownerId: bankConnections.ownerId })
    .from(bankConnections)
    .where(and(eq(bankConnections.provider, 'plaid'), eq(bankConnections.itemId, input.itemId)))
    .limit(1);
  if (!row || row.ownerId !== ownerId) return null;

  await db
    .update(bankConnections)
    .set({
      accessTokenCiphertext: encryptToken(input.accessToken, {
        keyId: input.keyring.current.keyId,
        key: input.keyring.current.key,
        aad: row.id,
      }),
      encryptionKeyId: input.keyring.current.keyId,
      status: 'active',
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, row.id)));

  return { id: row.id };
}

/**
 * Re-authentication, path a: Link's update mode ends with no public token
 * exchange, so there is nothing here to re-encrypt (spec §5) - just the same
 * "healthy again" state `recordSyncResult` and `replaceConnectionToken` both
 * leave behind. `false` for the id, so the action can say "not found" rather
 * than silently doing nothing.
 */
export async function markConnectionActive(
  db: Executor,
  ownerId: string,
  connectionId: string
): Promise<boolean> {
  if (!isUuid(connectionId)) return false;
  const rows = await db
    .update(bankConnections)
    .set({
      status: 'active',
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, connectionId)))
    .returning({ id: bankConnections.id });
  return rows.length > 0;
}

/**
 * Disconnecting a bank (spec §6).
 *
 * The owner-scoped `WHERE` is on the `DELETE` itself, the same shape
 * `markConnectionActive` uses: a connection id that belongs to somebody else
 * and one that does not exist are the same miss, `false`, with the row left
 * completely alone either way.
 *
 * The rest of the work is two foreign keys, not this function: `bank_accounts
 * .connection_id` is `ON DELETE CASCADE`, so the accounts behind this
 * connection go with it, and `transactions.bank_account_id` is `ON DELETE SET
 * NULL`, so a charge that was already filed keeps its category, its project
 * and its place in the ledger - it only stops pointing at an account that no
 * longer exists.
 */
export async function deleteConnection(
  db: Executor,
  ownerId: string,
  connectionId: string
): Promise<boolean> {
  if (!isUuid(connectionId)) return false;
  const rows = await db
    .delete(bankConnections)
    .where(and(eq(bankConnections.ownerId, ownerId), eq(bankConnections.id, connectionId)))
    .returning({ id: bankConnections.id });
  return rows.length > 0;
}

/**
 * Every connection the owner has, gone at once (spec §6, delete-all). Same
 * cascade `deleteConnection` relies on - `bank_accounts` goes with each row -
 * in a single statement rather than one per connection, since what delete-all
 * reports is a count of connections, not how many round trips it took.
 */
export async function deleteAllConnections(db: Executor, ownerId: string): Promise<number> {
  const rows = await db
    .delete(bankConnections)
    .where(eq(bankConnections.ownerId, ownerId))
    .returning({ id: bankConnections.id });
  return rows.length;
}
