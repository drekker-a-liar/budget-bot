import { NextResponse } from 'next/server';
import { isAuthConfigured } from '@/src/env';

/**
 * Reachable without a session, on purpose: it is what an uptime check and a
 * self-hoster halfway through setup can ask. It answers two things and no
 * others - the process is up, and sign-in has been configured - because
 * anything more detailed would be a status page for people who are not
 * allowed in.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, authConfigured: isAuthConfigured() });
}
