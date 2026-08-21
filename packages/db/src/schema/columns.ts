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
