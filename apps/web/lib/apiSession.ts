import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { storeFor } from './db';
import type { Store } from './store';

/**
 * The authoritative gate on an API route (ADR 0003, spec §7).
 *
 * Middleware saw a cookie; this asks the database whether that cookie is a
 * session, and hands back a store already scoped to whoever it belongs to.
 * Every route handler starts with these two lines, so there is no way to reach
 * a repository without having answered "whose data is this?" first.
 */

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** The signed-in user's store, or null when nobody is signed in. */
export async function storeForSession(): Promise<Store | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return storeFor(session.user.id);
}
