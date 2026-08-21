import { requireOwnerId } from '@/lib/ownerSession';
import { OAuthReturn } from './OAuthReturn';

/**
 * Where Plaid returns an OAuth bank's browser to.
 *
 * A shell, because everything this page does needs a browser: the Link token
 * is in `sessionStorage` and the URL the bank came back to is
 * `window.location`. What the server contributes is the one thing the client
 * cannot be trusted with - the session check. Finishing a Link flow ends in
 * storing a bank credential against an owner, so this route is gated exactly
 * like every other page and the allow list does not change (spec §6).
 */
export default async function PlaidOAuthReturnPage() {
  await requireOwnerId();

  return <OAuthReturn />;
}
