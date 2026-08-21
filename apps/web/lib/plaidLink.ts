/**
 * The Link token, across a redirect.
 *
 * An OAuth bank takes the browser away to the bank's own site and sends it
 * back to `/plaid/oauth-return`, which is a fresh page load: the React state
 * holding the Link token is gone, and Link cannot be resumed without it. So
 * the token is stashed in `sessionStorage` on the way out and read back on the
 * way in, and the return page refuses to do anything if it is not there
 * (spec §9) - a Link session nobody started is not one to finish.
 *
 * `sessionStorage` rather than `localStorage` on purpose: the token is
 * single-use and belongs to one tab's flow, and a tab that is closed
 * mid-connect should not leave one behind.
 *
 * Every access is guarded. Safari in private browsing throws on
 * `sessionStorage` rather than returning null, and a thrown storage error in
 * the middle of connecting a bank would look to the user like the bank
 * refused them.
 */

export const LINK_TOKEN_KEY = 'plaid_link_token';

/**
 * The public token the scripted bank answers to.
 *
 * The literal, rather than an import of `FAKE_PUBLIC_TOKEN`: that module is
 * server code - it reaches for `process.env` and for the connectors package -
 * and a client component that imported it would pull all of it into the
 * browser bundle. `test/fake-provider.test.ts` asserts the two are the same
 * string, so the copy cannot drift without a test saying so.
 */
export const SCRIPTED_PUBLIC_TOKEN = 'public-fake';

export function rememberLinkToken(token: string): void {
  try {
    window.sessionStorage.setItem(LINK_TOKEN_KEY, token);
  } catch {
    // Storage is unavailable. Link still opens in this tab; only an OAuth
    // bank's round trip is lost, and that is better than failing here.
  }
}

export function storedLinkToken(): string | null {
  try {
    return window.sessionStorage.getItem(LINK_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** After the token has been exchanged, or after Link gave up on it. */
export function forgetLinkToken(): void {
  try {
    window.sessionStorage.removeItem(LINK_TOKEN_KEY);
  } catch {
    // Nothing was stored, so there is nothing to clear.
  }
}
