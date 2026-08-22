'use server';

import type { BankProvider } from '@budget-bot/bank-connectors';
import {
  ConnectionAlreadyExistsError,
  bankRepo,
  getDb,
  type BankAccount,
  type Database,
} from '@budget-bot/db';
import { loadKeysFromEnv, type TokenKeyring } from '@budget-bot/db/crypto';
import { headers } from 'next/headers';
import { currentOwnerId } from '@/lib/ownerSession';
import { env } from '@/src/env';
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
  // Through the validated `env` rather than `process.env`: one schema is the
  // last word on what a variable may be, and a second reader going round it is
  // how a value that the schema would have rejected reaches a redirect URI.
  const configured = env.AUTH_URL;
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

  try {
    const { linkToken } = await provider.createLinkToken({ userId: ownerId, redirectUri });
    return ok({ linkToken });
  } catch (error) {
    // The likeliest failure on a deployment's first run - a `redirect_uri` the
    // Plaid dashboard has never been told about, or credentials from the other
    // environment - and it is an answer rather than an exception. Throwing
    // here reaches the browser as a rejected action call, which is a button
    // that says "Connecting…" for ever and says nothing about why.
    return failed(readable(error, LINK_REFUSED));
  }
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
  let item;
  try {
    item = await provider.exchangePublicToken(parsed.data.publicToken);
  } catch (error) {
    // Nothing has been written yet, so this really is "nothing has changed".
    // A spent public token and a credentials mismatch both land here.
    return failed(readable(error, EXCHANGE_REFUSED));
  }

  let connectionId: string;
  try {
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
    connectionId = connection.id;
  } catch (error) {
    // `createConnection` is one transaction, so a failure here has stored
    // nothing - which is what makes a refusal the right answer rather than a
    // success with a caveat. The case worth naming is the reachable one:
    // Link run a second time against a bank that is already connected. The
    // public token is spent by now, so "try again" would send the owner back
    // through Link to the same dead end. Phase 3 upserts onto the existing
    // row instead of refusing (spec §5b) - same connection, a new token -
    // unless that row belongs to somebody else, in which case the Phase 2
    // message still stands: no cross-tenant token overwrite.
    if (error instanceof ConnectionAlreadyExistsError) {
      const replaced = await bankRepo.replaceConnectionToken(db, ownerId, {
        itemId: item.itemId,
        accessToken: item.accessToken,
        keyring,
      });
      if (!replaced) {
        return failed('This bank is already connected. Use Sync now on the existing connection.');
      }
      connectionId = replaced.id;
    } else {
      return failed(readable(error, EXCHANGE_REFUSED));
    }
  }

  // Past this line the token is stored, and every failure below is reported as
  // a field on a success. Turning one into `failed` would strand an encrypted
  // credential behind a connection the owner cannot see and cannot retry.
  let stored: BankAccount[] = [];
  let firstSync: FirstSyncOutcome;
  try {
    stored = await bankRepo.upsertAccounts(
      db,
      ownerId,
      connectionId,
      await provider.getAccounts(item.accessToken)
    );

    firstSync = await runSync(db, ownerId, connectionId, {
      provider,
      keyring,
      maxPages: FIRST_SYNC_MAX_PAGES,
    });
  } catch (error) {
    // Includes the case where the accounts could not be listed at all, which
    // is why the sync is inside this block rather than after it: with no
    // accounts, every transaction a sync fetched would name one this
    // connection does not have and be dropped. **Sync now** re-lists the
    // accounts before it pulls, so a connection stored empty heals itself.
    firstSync = { error: syncFailureOf(error).code };
  }

  revalidateApp();
  return ok({ connectionId, accounts: stored.length, firstSync });
}

/**
 * What a provider failure should say to the person who pressed the button.
 *
 * The failure is classified by `syncFailureOf`, which is the same mapping the
 * connection's recorded state uses - so "what the screen says" and "what the
 * row says" cannot drift into two different names for one failure. Only the
 * sentence differs by operation, because "the sync stopped" is the wrong thing
 * to tell somebody whose Link token was refused before a sync existed.
 *
 * The code, never the provider's message: the message is free text from
 * somebody else's system and this is a screen (spec §9).
 */
function readable(error: unknown, sentence: (code: string) => string): string {
  const failure = syncFailureOf(error);
  if (failure.status === 'reauth_required') {
    return 'Your bank needs you to sign in again before it will share transactions. Reconnect it to carry on.';
  }
  return sentence(failure.code);
}

const LINK_REFUSED = (code: string) =>
  `Plaid would not start a connection: ${code}. Nothing has changed - try again.`;

const EXCHANGE_REFUSED = (code: string) =>
  `That bank could not be connected: ${code}. Nothing has been stored - try again.`;

const SYNC_STOPPED = (code: string) =>
  `The sync stopped: ${code}. Nothing already imported was lost - try again in a minute.`;

/**
 * Refreshes a connection's accounts and pulls everything new behind them.
 *
 * Shared by **Sync now** and by `markReconnectedAction`, which runs this same
 * sequence the instant a connection comes back to `'active'` - a reconnect
 * behaves exactly like pressing Sync the moment it succeeds, rather than
 * leaving the owner to press a second button to find out it worked.
 *
 * The accounts are refreshed first for two reasons, and the second is why it
 * is unconditional rather than a repair anybody has to know to run: balances
 * move, and a connection that was stored *without* accounts - `getAccounts`
 * failed straight after Link - can never sync, because every transaction
 * names an account it does not have and is dropped. This heals that
 * connection the next time somebody presses the button.
 */
async function refreshAccountsThenSync(
  db: Database,
  ownerId: string,
  connectionId: string,
  provider: BankProvider,
  keyring: TokenKeyring
): Promise<ActionResult<RunSyncResult>> {
  try {
    const accounts = await bankRepo.withAccessToken(
      db,
      ownerId,
      connectionId,
      keyring,
      (accessToken) => provider.getAccounts(accessToken)
    );
    await bankRepo.upsertAccounts(db, ownerId, connectionId, accounts);
  } catch (error) {
    // Recorded, because nothing below this point will do it: `runSync` writes
    // the connection's failure state itself, and a refresh that failed outside
    // it would otherwise leave a screen saying "Connected" under a message
    // saying it is not.
    await bankRepo.recordSyncError(db, ownerId, connectionId, syncFailureOf(error));
    revalidateApp();
    return failed(readable(error, SYNC_STOPPED));
  }

  let result: RunSyncResult;
  try {
    result = await runSync(db, ownerId, connectionId, { provider, keyring });
  } catch (error) {
    // `runSync` recorded the failure on the connection before it threw, so the
    // screen has to be re-read for the owner to see it.
    revalidateApp();
    return failed(readable(error, SYNC_STOPPED));
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

  const keyring = loadKeysFromEnv();

  return refreshAccountsThenSync(db, ownerId, connection.id, provider, keyring);
}

/**
 * Re-authentication, path a: Link's update mode (spec §5a).
 *
 * `withAccessToken` decrypts the connection's *existing* token and hands it
 * to `provider.createLinkToken`, which is what tells Plaid this Link session
 * is re-authorizing an item rather than starting a new one. Ownership is
 * checked through `getConnection` first, the same way `syncNowAction` does
 * it, so a connection id that is not this owner's gets the same quiet
 * "Connection not found" rather than a code from `withAccessToken`'s own
 * refusal.
 */
export async function createReauthLinkTokenAction(
  input: unknown
): Promise<ActionResult<{ linkToken: string }>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = SyncConnectionForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const provider = getBankProvider();
  if (!provider) return failed(NOT_CONFIGURED);

  const db = getDb();
  const connection = await bankRepo.getConnection(db, ownerId, parsed.data.connectionId);
  if (!connection) return failed('Connection not found');

  const redirectUri = await oauthReturnUri();
  if (!redirectUri) {
    return failed(
      'This deployment does not know its own address, so Plaid cannot be told where to send you back. Set AUTH_URL.'
    );
  }

  const keyring = loadKeysFromEnv();

  try {
    const { linkToken } = await bankRepo.withAccessToken(
      db,
      ownerId,
      connection.id,
      keyring,
      (accessToken) => provider.createLinkToken({ userId: ownerId, redirectUri, accessToken })
    );
    return ok({ linkToken });
  } catch (error) {
    return failed(readable(error, LINK_REFUSED));
  }
}

/**
 * Re-authentication, path a, the second half: Link's update mode ends with no
 * public token to exchange (spec §5a), so there is nothing here to store -
 * just the connection coming back to `'active'` and the same refresh-then-sync
 * every other healthy sync runs.
 */
export async function markReconnectedAction(
  input: unknown
): Promise<ActionResult<RunSyncResult>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = SyncConnectionForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const provider = getBankProvider();
  if (!provider) return failed(NOT_CONFIGURED);

  const db = getDb();
  const activated = await bankRepo.markConnectionActive(db, ownerId, parsed.data.connectionId);
  if (!activated) return failed('Connection not found');

  const keyring = loadKeysFromEnv();

  return refreshAccountsThenSync(db, ownerId, parsed.data.connectionId, provider, keyring);
}

/** What `disconnectConnectionAction` hands back. */
export interface DisconnectedBank {
  /**
   * Whether the provider agreed to forget the item. The connection is
   * deleted either way (spec §6) - this only says whether Plaid's own record
   * of it is gone too, which is worth knowing but never worth blocking on:
   * an owner who asked for a bank to be disconnected should not be told "no"
   * because Plaid's side of that request timed out.
   */
  removed: boolean;
}

/**
 * Removing a linked bank (spec §6).
 *
 * `provider.removeItem` is best-effort - the one call in this action that is
 * deliberately *not* inside the same all-or-nothing discipline every other
 * provider call here follows. Everything the owner filed through this
 * connection is staying: `bank_accounts` cascades away with the row below,
 * but `deleteConnection` only ever touches `bank_connections`, and
 * `transactions.bank_account_id` is `ON DELETE SET NULL` (spec §6) - so a
 * Plaid outage during disconnect must not leave a connection the owner asked
 * to remove still showing up as "Connected".
 */
export async function disconnectConnectionAction(
  input: unknown
): Promise<ActionResult<DisconnectedBank>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = SyncConnectionForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const provider = getBankProvider();
  if (!provider) return failed(NOT_CONFIGURED);

  const db = getDb();
  const connection = await bankRepo.getConnection(db, ownerId, parsed.data.connectionId);
  if (!connection) return failed('Connection not found');

  const keyring = loadKeysFromEnv();

  let removed = true;
  try {
    await bankRepo.withAccessToken(db, ownerId, connection.id, keyring, (accessToken) =>
      provider.removeItem(accessToken)
    );
  } catch {
    removed = false;
  }

  await bankRepo.deleteConnection(db, ownerId, connection.id);

  revalidateApp();
  return ok({ removed });
}
