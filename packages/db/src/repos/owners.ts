import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { users } from '../schema';

/**
 * Resolving who owns a row. Auth.js creates the `users` row on first sign-in
 * (ADR 0003); nothing here ever does, so an unknown email is an error the
 * caller has to report rather than a row to conjure up.
 */
export async function findOwnerIdByEmail(
  db: Database,
  email: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return row?.id;
}
