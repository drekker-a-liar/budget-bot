'use server';

import { bankRepo, getDb } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { headers } from 'next/headers';
import { currentOwnerId } from '@/lib/ownerSession';
import { getBankProvider } from '@/src/server/bank/provider';
import { runSync, syncFailureOf, type RunSyncResult } from '@/src/server/bank/sync';
import { ExchangePublicTokenForm, SyncConnectionForm } from './inputs';
import { revalidateApp } from './revalidate';
import { failed, invalid, ok, unauthorized, type ActionResult } from './result';

/**
 * Linking a bank, and pulling from one.
 *
 * Three writes, and the same four steps as every other action module: ask who
 * is signed in, validate what arrived, do the work as that owner, invalidate
 * the pages that drew from it. What is particular to this file is two things
 * neither of the others has to think about.
 *
 * **The redirect URI is not an input.** Plaid sends the browser back to it
 * after an OAuth bank, so a caller that could name it could point a completed
 * Link flow at a page it controls. It is built from the request this action
 * arrived on, or from the deployment's own `AUTH_URL`, and from nothing else
 * (spec §9).
 *
 * **The access token is plaintext for one statement.** It exists as a string
 * inside `exchangePublicTokenAction`, for as long as it takes `createConnection`
 * to encrypt it into its row, and then nowhere: it is not returned, not
 * logged, and not part of any result a caller could log for it (ADR 0002).
 */

/** A deployment with no Plaid credentials is a supported deployment (spec §7). */
const NOT_CONFIGURED = 'Plaid is not configured on this deployment';

/** Where Plaid sends an OAuth bank's browser back to. Also `app/plaid/oauth-return`. */
const OAUTH_RETURN_PATH = '/plaid/oauth-return';

/**
 * How many pages the sync that runs straight after Link may commit.
 *
 * It runs inside the request the browser is still waiting on, and an account
 * with two years of history is a lot of pages. Five is enough for the owner to
 * see that transactions arrived; **Sync now** fetches the rest unbounded.
 */
const FIRST_SYNC_MAX_PAGES = 5;

/** What `exchangePublicTokenAction` hands back. Never the token. */
export interface ConnectedBank {
  connectionId: string;
  /** How many accounts were stored behind the new connection. */
  accounts: number;
  firstSync: FirstSyncOutcome;
}

/**
 * The first sync's outcome, or why there is not one.
 *
 * A failure here is a field on a success rather than a failure: by the time it
 * can happen the token is already encrypted into a row, and reporting the
 * whole exchange as failed would leave a connection the owner cannot see and
 * cannot retry.
 */
export type FirstSyncOutcome = RunSyncResult | { error: string };

/** A forwarded header may be a list; the first hop is the one that matters. */
function firstHop(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

function isLoopback(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/**
 * Where this request thinks it arrived, as a scheme and an authority.
 *
 * The `Host` header is not a secret and not a promise - it is whatever reached
 * the server - so this is deliberately *not* the last word: `AUTH_URL` is
 * asked when the request says nothing, and Plaid refuses any redirect URI that
 * is not registered against the client id, which is the backstop that makes a
 * forged host a failed Link token rather than anybody's problem.
 */
async function requestOrigin(): Promise<string | null> {
  const received = await headers();

  const host = firstHop(received.get('x-forwarded-host')) ?? firstHop(received.get('host'));
  if (!host) return null;

  // No TLS assumed for a loopback host: a developer running `next dev` is on
  // http, and an https redirect URI there sends the browser nowhere.
  const proto = firstHop(received.get('x-forwarded-proto')) ?? (isLoopback(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** What the operator configured this deployment's own URL to be. */
function configuredOrigin(): string | null {
  const configured = process.env.AUTH_URL;
  if (!configured) return null;
  try {
    // The origin, not the string: `AUTH_URL` is allowed to carry Auth.js's own
    // path, and `https://books.example/api/auth/plaid/oauth-return` is not a
    // page this app serves.
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

async function oauthReturnUri(): Promise<string | null> {
  const origin = (await requestOrigin()) ?? configuredOrigin();
  return origin === null ? null : `${origin}${OAUTH_RETURN_PATH}`;
}

/**
 * A Link token, bound to the signed-in owner.
 *
 * The token is short-lived and carries `client_user_id`, so the one this
 * returns can only ever open Link for the person who asked for it.
 */
export async function createLinkTokenAction(): Promise<ActionResult<{ linkToken: string }>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const provider = getBankProvider();
  if (!provider) return failed(NOT_CONFIGURED);

  const redirectUri = await oauthReturnUri();
  if (!redirectUri) {
    return failed(
      'This deployment does not know its own address, so Plaid cannot be told where to send you back. Set AUTH_URL.'
    );
  }

  const { linkToken } = await provider.createLinkToken({ userId: ownerId, redirectUri });
  return ok({ linkToken });
}

/**
 * The public token Link handed the browser, turned into a stored connection.
 *
 * The order is the one spec §6 sets and each step needs the one before it:
 * exchange for the long-lived token, store it encrypted, list the accounts the
 * owner just consented to, then pull a first bounded page of transactions so
 * the inbox has something in it when the screen comes back.
 */
export async function exchangePublicTokenAction(
  input: unknown
): Promise<ActionResult<ConnectedBank>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = ExchangePublicTokenForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const provider = getBankProvider();
  if (!provider) return failed(NOT_CONFIGURED);

  const db = getDb();
  const keyring = loadKeysFromEnv();

  // The plaintext token's whole life is these few lines. It is handed to
  // `createConnection`, which encrypts it against the row's own id, and to the
  // account listing, which is the one call that has to happen before the row
  // can be read back through `withAccessToken`.
  const item = await provider.exchangePublicToken(parsed.data.publicToken);
  const connection = await bankRepo.createConnection(
    db,
    ownerId,
    {
      provider: provider.id,
      itemId: item.itemId,
      accessToken: item.accessToken,
      institutionId: item.institutionId ?? null,
      institutionName: item.institutionName ?? null,
    },
    keyring
  );
  const stored = await bankRepo.upsertAccounts(
    db,
    ownerId,
    connection.id,
    await provider.getAccounts(item.accessToken)
  );

  let firstSync: FirstSyncOutcome;
  try {
    firstSync = await runSync(db, ownerId, connection.id, {
      provider,
      keyring,
      maxPages: FIRST_SYNC_MAX_PAGES,
    });
  } catch (error) {
    // The connection is stored, and `runSync` has already recorded why it
    // stopped. Losing an encrypted token over a sync that can be retried from
    // the screen would be the worst trade available here.
    firstSync = { error: syncFailureOf(error).code };
  }

  revalidateApp();
  return ok({ connectionId: connection.id, accounts: stored.length, firstSync });
}

/** What a failed run should say to the person who pressed the button. */
function readable(code: string, status: 'error' | 'reauth_required'): string {
  if (status === 'reauth_required') {
    return 'Your bank needs you to sign in again before it will share transactions. Reconnect it to carry on.';
  }
  // The code, never the provider's message: the message is free text from
  // somebody else's system and this is a screen (spec §9).
  return `The sync stopped: ${code}. Nothing already imported was lost - try again in a minute.`;
}

/**
 * Everything the bank has, now.
 *
 * Unbounded, unlike the sync after Link: somebody pressed a button and is
 * waiting for all of it, and `runSync` commits page by page anyway, so a run
 * that is cut short by a timeout still keeps what it had fetched.
 */
export async function syncNowAction(input: unknown): Promise<ActionResult<RunSyncResult>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = SyncConnectionForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const provider = getBankProvider();
  if (!provider) return failed(NOT_CONFIGURED);

  const db = getDb();
  // Whose connection this is, asked before anything else happens with it.
  // Null means no connection of that id belongs to this owner; whether it
  // never existed or belongs to someone else is not something to say out loud.
  const connection = await bankRepo.getConnection(db, ownerId, parsed.data.connectionId);
  if (!connection) return failed('Connection not found');

  let result: RunSyncResult;
  try {
    result = await runSync(db, ownerId, connection.id, {
      provider,
      keyring: loadKeysFromEnv(),
    });
  } catch (error) {
    // `runSync` recorded the failure on the connection before it threw, so the
    // screen has to be re-read for the owner to see it.
    revalidateApp();
    const failure = syncFailureOf(error);
    return failed(readable(failure.code, failure.status));
  }

  revalidateApp();

  // A rate limit is an unfinished sync, not a failed one: everything the run
  // committed stands, and the connection records why it stopped. Reporting it
  // as a success would put "synced" on a screen for a connection that is still
  // behind, so it is a message with the provider's own wait in it.
  if ('retryAfterSeconds' in result && result.retryAfterSeconds !== undefined) {
    return failed(
      `Your bank is asking for a pause. ${result.added} added so far; try again in ${result.retryAfterSeconds} seconds.`
    );
  }

  return ok(result);
}
