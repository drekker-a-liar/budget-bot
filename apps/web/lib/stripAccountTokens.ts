import type { AdapterAccount } from 'next-auth/adapters';

/**
 * The OAuth account row, with the provider's credentials removed.
 *
 * ADR 0002 exists so a database dump alone cannot read a bank; the same dump
 * must not hand over a live GitHub token instead. The app uses the GitHub
 * `access_token` exactly once - fetching the verified profile inside the
 * sign-in userinfo request - and never reads it back from the `accounts`
 * table, so the stored copy was a credential with no reader (Phase 5 audit).
 * Auth.js only needs the row itself to link the provider account to the
 * user; the token columns can hold nulls.
 */
export function stripAccountTokens(account: AdapterAccount): AdapterAccount {
  return {
    ...account,
    access_token: undefined,
    refresh_token: undefined,
    id_token: undefined,
  };
}
