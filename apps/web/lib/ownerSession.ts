import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * Who is asking, resolved from the session and from nowhere else.
 *
 * Middleware saw a cookie; this asks the database whether that cookie is a
 * session (ADR 0003, spec §7). Every server component, server action and route
 * handler starts here, so there is no path to a repository that has not
 * answered "whose data is this?" first - and no caller ever supplies an owner
 * id of their own.
 */

/** The signed-in owner, as much of them as an action ever needs. */
export interface CurrentOwner {
  id: string;
  /** The display name the sign-in provider supplied; GitHub profiles may have none. */
  name: string | null;
}

/**
 * The signed-in owner, or null. For the few callers that need more than the
 * id - a labor entry is logged under the owner's own name - without a second
 * session lookup, which with a database session strategy is a second query.
 */
export async function currentOwner(): Promise<CurrentOwner | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return { id, name: session?.user?.name ?? null };
}

/** The signed-in owner, or null. For callers that answer for themselves. */
export async function currentOwnerId(): Promise<string | null> {
  const owner = await currentOwner();
  return owner?.id ?? null;
}

/**
 * The signed-in owner, or a redirect to the sign-in page. For pages: a browser
 * that got here without a session wants somewhere to go, not a status code.
 */
export async function requireOwnerId(): Promise<string> {
  const ownerId = await currentOwnerId();
  if (!ownerId) redirect('/login');
  return ownerId;
}
