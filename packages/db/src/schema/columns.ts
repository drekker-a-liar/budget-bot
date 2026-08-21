import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './auth';

/**
 * The three column shapes every domain table repeats. They are helpers rather
 * than copied lines so that "every table carries owner_id" (spec §5) is one
 * decision in one place: a table that forgets to call `ownerId()` is missing
 * something visible, not something subtly different.
 */

/** The row's owner. Deleting a user takes their data with it. */
export const ownerId = () =>
  text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/**
 * The one exception to "every row has an owner": `webhook_events`. Its body
 * hash is the replay defence, and it has to be recorded the moment a payload
 * arrives - before the item has been resolved to an owner, and for payloads
 * whose item this deployment does not recognise at all. Requiring the owner
 * first would mean the unrecognised payloads are the ones with no replay
 * protection, which is exactly backwards.
 *
 * Deleting a user clears the reference rather than cascading, for the same
 * reason: the hash has to outlive the account for its retention window, or a
 * payload redelivered just after an account is closed stops being recognised
 * as a redelivery. What is left behind is a provider name, an item id and a
 * hash - no financial data.
 */
export const ownerIdNullable = () =>
  text('owner_id').references(() => users.id, { onDelete: 'set null' });

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/**
 * Money is a whole number of cents (ADR 0007). `bigint` because Postgres
 * `numeric` arrives as a string and would put a parse on every read; `mode:
 * 'number'` because 2^53 cents is roughly $90 trillion, far past anything this
 * product will hold.
 */
export const cents = (name: string) => bigint(name, { mode: 'number' });
