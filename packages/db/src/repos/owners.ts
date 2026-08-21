import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { users } from '../schema';

/**
 * Resolving who owns a row. Auth.js creates the `users` row on first sign-in
 * (ADR 0003); nothing here ever does, so an unknown email is an error the
 * caller has to report rather than a row to conjure up.
 *
 * The comparison folds case on both sides. `email` is a plain text column
 * holding whatever casing the OAuth provider sent, so lowercasing only the
 * input would miss a stored `Mike@Example.com` entirely.
 */
export async function findOwnerIdByEmail(
  db: Database,
  email: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row?.id;
}
