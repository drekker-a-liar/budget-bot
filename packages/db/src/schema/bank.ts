import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { cents, createdAt, ownerId, ownerIdNullable, updatedAt } from './columns';

/**
 * The bank-feed tables (spec §5, ADR 0002, ADR 0004). They are created now and
 * left empty so that the sub-project which adds Plaid is purely additive: no
 * migration of live data, no schema change under a running deployment.
 */

export const bankConnections = pgTable(
  'bank_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerId(),
    provider: text('provider').notNull().default('plaid'),
    /** The provider's identifier for the linked institution login (Plaid Item). */
    itemId: text('item_id').notNull(),
    institutionId: text('institution_id'),
    institutionName: text('institution_name'),
    /**
     * AES-256-GCM ciphertext, `v1:<keyId>:<iv>:<tag>:<ct>`, AAD = this row's
     * id (ADR 0002). The plaintext token never reaches the database.
     */
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    encryptionKeyId: text('encryption_key_id').notNull(),
    /** `/transactions/sync` cursor, committed only after a page is applied. */
    cursor: text('cursor'),
    status: text('status').notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('bank_connections_provider_item_key').on(table.provider, table.itemId),
    index('bank_connections_owner_idx').on(table.ownerId),
  ]
);

/**
 * One linked account. This absorbs the prototype's `CardProfile`: `cardName`
 * and `cycleResetDay` have no provider equivalent but the card UI reads them,
 * so they live here rather than in a table that exists only to keep one screen
 * working.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => bankConnections.id, { onDelete: 'cascade' }),
    externalAccountId: text('external_account_id').notNull(),
    name: text('name'),
    officialName: text('official_name'),
    /** Last four digits. Never a full card number - spec §7, "No PAN, ever". */
    mask: text('mask'),
    type: text('type'),
    subtype: text('subtype'),
    currentBalanceCents: cents('current_balance_cents'),
    availableBalanceCents: cents('available_balance_cents'),
    limitCents: cents('limit_cents'),
    isoCurrencyCode: text('iso_currency_code'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    balancesUpdatedAt: timestamp('balances_updated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    /** Day of month the statement cycle resets. User-supplied, not from Plaid. */
    cycleResetDay: integer('cycle_reset_day'),
    /** The user's own name for the card, shown in place of the bank's. */
    cardName: text('card_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('bank_accounts_connection_external_key').on(
      table.connectionId,
      table.externalAccountId
    ),
    index('bank_accounts_owner_enabled_idx').on(table.ownerId, table.isEnabled),
  ]
);

/**
 * Replay protection for provider webhooks: the body hash is unique, so a
 * redelivered payload is recognised rather than re-applied (spec §7). Rows are
 * kept 30 days.
 *
 * The owner is nullable here and nowhere else - a payload is recorded when it
 * arrives, which is before its item has been resolved to an owner, and some
 * payloads name an item this deployment has never seen. See `ownerIdNullable`.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerIdNullable(),
    provider: text('provider').notNull().default('plaid'),
    itemId: text('item_id'),
    webhookType: text('webhook_type'),
    webhookCode: text('webhook_code'),
    bodyHash: text('body_hash').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('webhook_events_body_hash_key').on(table.bodyHash),
    index('webhook_events_received_idx').on(table.receivedAt),
  ]
);
