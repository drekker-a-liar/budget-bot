import { describe, expect, it } from 'vitest';
import type { AdapterAccount } from 'next-auth/adapters';
import { stripAccountTokens } from '@/lib/stripAccountTokens';

/**
 * The `accounts` row must never hold a live provider credential (Phase 5
 * audit): the GitHub access token is used once, during the sign-in userinfo
 * request, and nothing reads it back from the database - so a database dump
 * that ADR 0002 keeps from reading a bank must not hand over GitHub instead.
 * Migration 0002 clears what earlier sign-ins stored; this pins what new
 * sign-ins write.
 */

const GITHUB_ACCOUNT: AdapterAccount = {
  userId: 'user-1',
  type: 'oauth',
  provider: 'github',
  providerAccountId: '10392988',
  access_token: 'gho_live-token-from-the-handshake',
  refresh_token: 'ghr_refresh-token',
  id_token: 'header.payload.signature',
  token_type: 'bearer',
  scope: 'read:user,user:email',
};

describe('stripAccountTokens', () => {
  it('removes every provider credential before the row is written', () => {
    const stripped = stripAccountTokens(GITHUB_ACCOUNT);

    expect(stripped.access_token).toBeUndefined();
    expect(stripped.refresh_token).toBeUndefined();
    expect(stripped.id_token).toBeUndefined();
  });

  it('keeps the linkage Auth.js actually needs', () => {
    const stripped = stripAccountTokens(GITHUB_ACCOUNT);

    expect(stripped).toMatchObject({
      userId: 'user-1',
      type: 'oauth',
      provider: 'github',
      providerAccountId: '10392988',
      scope: 'read:user,user:email',
    });
  });

  it('does not mutate its input - the live token is still needed for the userinfo fetch', () => {
    const account = { ...GITHUB_ACCOUNT };
    stripAccountTokens(account);

    expect(account.access_token).toBe('gho_live-token-from-the-handshake');
  });
});
