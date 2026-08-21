import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * The Auth.js Drizzle adapter's Postgres tables (ADR 0003). The adapter maps
 * its fields to *TypeScript property names*, not SQL column names, so the
 * property names below are the adapter's verbatim - `providerAccountId`,
 * `refresh_token` - while the SQL columns stay snake_case like the rest of the
 * database. Task 4 passes these tables to `DrizzleAdapter` and must not need
 * to change them.
 *
 * `settings` is this application's own addition: per-user preferences, of
 * which `timeZone` is the one the metrics need (spec §5).
 */

export interface UserSettings {
  /** IANA zone the user's months and weeks are bucketed in, e.g. 'America/Los_Angeles'. */
  timeZone?: string;
}

export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name'),
    email: text('email').notNull().unique(),
    emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
    image: text('image'),
    settings: jsonb('settings').$type<UserSettings>().notNull().default({}),
  },
  (table) => [
    // The column's own UNIQUE is case-sensitive, so `Mike@x.com` and
    // `mike@x.com` are two rows to Postgres and one person to everyone else.
    // The allow list and `findOwnerIdByEmail` both fold case; this makes the
    // database agree, so a provider that changes its casing cannot quietly
    // create a second set of books.
    uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`),
  ]
);

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<'oauth' | 'oidc' | 'email' | 'webauthn'>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })]
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);
