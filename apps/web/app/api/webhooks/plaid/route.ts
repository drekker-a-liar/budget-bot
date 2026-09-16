import { NextResponse } from 'next/server';
import { WebhookVerificationError, type WebhookEvent } from '@budget-bot/bank-connectors';
import { bankRepo, getDb, webhookEventsRepo } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
import { declaredBodyBytes, readCappedBody } from '@/lib/readCappedBody';
import { getBankProvider } from '@/src/server/bank/provider';
import { runSync, syncFailureOf } from '@/src/server/bank/sync';

/**
 * Plaid's webhook delivery (spec §3).
 *
 * No session reaches this route by design (spec §7, the middleware allow
 * list in `lib/publicPaths.ts`): a webhook names an item, not a signed-in
 * owner, and there is no cookie to check it against. Everything below
 * follows from that.
 *
 * The response is always one of exactly three shapes -
 * `{ok:false}`, `{ok:true}`, `{ok:true, duplicate:true}` - and never an item
 * id, a connection id or an owner id. Whoever is on the other end of this
 * request has, at best, only just had its signature checked; a body that
 * echoed one of those back would hand an attacker a way to learn which ids
 * are real before the next request's signature is even asked for.
 *
 * The only non-200s are 401, for a body whose signature does not check out
 * (an unreachable key server lands here too - the verifier cannot tell an
 * unknown `kid` from an unfetchable one), and 413, for a body too large to
 * be anything Plaid sends. Every other outcome - no provider configured, an
 * item this deployment does not recognise, a crash after the payload was
 * accepted - answers 200, so Plaid neither retries forever nor learns
 * anything from the status code alone about what is running behind it. The
 * cron sync (spec §4) is the retry mechanism for whatever this request
 * could not finish; a Plaid redelivery is not.
 */

/**
 * How long Vercel lets one delivery run, in seconds. The platform default is
 * 10, and a `SYNC_UPDATES_AVAILABLE` delivery runs the whole sync inline
 * (below) - on a connection's first backfill that is many pages, and a
 * function killed mid-run is a sync the cron has to finish. 60 is the Hobby
 * plan's ceiling; Pro allows up to 300, and a self-hoster there can raise
 * this. Ignored outside Vercel.
 */
export const maxDuration = 60;

/** `ITEM` codes that mean the user has to reconnect, not the system retrying. */
const ITEM_REAUTH_CODES = new Set(['PENDING_EXPIRATION', 'USER_PERMISSION_REVOKED']);

/**
 * Far beyond any webhook Plaid sends, which is a few hundred bytes of JSON.
 * This is the app's one unauthenticated POST, and a route handler has no
 * body limit of its own (the CSV route makes the same argument at greater
 * length) - so without a cap, an unsigned request could make this route
 * buffer and hash arbitrarily many bytes before verification ever refused
 * it (Phase 5 audit).
 */
const WEBHOOK_MAX_BYTES = 1024 * 1024;

/**
 * The body, capped, or `null` when the caller went past the cap - by its own
 * `Content-Length`, or by the bytes it actually sent. An unmeasured body is
 * read rather than refused: the streaming cap is the guard that does not take
 * the caller's word, and Plaid is the only caller whose requests matter here.
 */
async function readWebhookBody(request: Request): Promise<string | null> {
  const declared = declaredBodyBytes(request);
  if (declared !== null && declared > WEBHOOK_MAX_BYTES) return null;

  return readCappedBody(request, WEBHOOK_MAX_BYTES);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Lower-cased, the way every `BankProvider.verifyAndParseWebhook` reads them. */
function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

/** Plaid's `error.error_code`, when the payload carries one at all. */
function payloadErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = payload.error;
  if (!isRecord(error)) return null;
  return typeof error.error_code === 'string' ? error.error_code : null;
}

/**
 * The code to record and reauthorize over, or `null` if this event does not
 * mean that - spec §3's dispatch map, read as the type/code pairs it is
 * written in: `ITEM`/`PENDING_EXPIRATION`, `ITEM`/`USER_PERMISSION_REVOKED`,
 * and `ITEM` or `ERROR` carrying a nested `error.error_code` of
 * `ITEM_LOGIN_REQUIRED`.
 */
function reauthCode(event: WebhookEvent): string | null {
  if (event.type === 'ITEM' && event.code !== null && ITEM_REAUTH_CODES.has(event.code)) {
    return event.code;
  }
  if (event.type === 'ITEM' || event.type === 'ERROR') {
    const code = payloadErrorCode(event.payload);
    if (code === 'ITEM_LOGIN_REQUIRED') return code;
  }
  return null;
}

/** The one dispatch that runs a sync: `TRANSACTIONS`/`SYNC_UPDATES_AVAILABLE`. */
function isSyncDispatch(event: WebhookEvent): boolean {
  return event.type === 'TRANSACTIONS' && event.code === 'SYNC_UPDATES_AVAILABLE';
}

export async function POST(request: Request): Promise<NextResponse> {
  // Asked before the body is touched: a deployment with no Plaid credentials
  // configured is a supported deployment (spec §7) and has nothing to verify
  // against, so there is no reason for it to buffer and decode a megabyte of
  // an unauthenticated stranger's body before saying so. Nothing below the
  // body read needs it, either.
  const provider = getBankProvider();
  if (!provider) {
    // Nothing to learn from refusing a webhook it never asked Plaid to send.
    return NextResponse.json({ ok: true });
  }

  // Read before any parse: the signature covers the exact bytes that arrived,
  // and anything that touched the body first could disagree with it.
  const rawBody = await readWebhookBody(request);
  if (rawBody === null) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  const headers = headerRecord(request.headers);

  let event: WebhookEvent;
  try {
    event = await provider.verifyAndParseWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    // Something other than verification failed - a bug in the verifier, not
    // a bad signature. (An unreachable key server is NOT this branch: the
    // verifier reports it as a verification failure, because it cannot tell
    // an unknown `kid` from an unfetchable one, and that answers 401 above.)
    // Nothing has been recorded, and nothing safe can be said about why; the
    // cron sync is the backstop.
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  let eventId: string | null = null;

  try {
    const recorded = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: provider.id,
      bodyHash: event.bodyHash,
      itemId: event.itemId,
      webhookType: event.type,
      webhookCode: event.code,
    });
    if ('duplicate' in recorded) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    eventId = recorded.id;

    const connection = event.itemId
      ? await bankRepo.findConnectionByItemId(db, event.itemId)
      : null;
    if (!connection) {
      await webhookEventsRepo.markWebhookProcessed(db, eventId);
      return NextResponse.json({ ok: true });
    }

    await webhookEventsRepo.resolveWebhookOwner(db, eventId, connection.ownerId);

    if (isSyncDispatch(event)) {
      const keyring = loadKeysFromEnv();
      // Awaited inline: one item's sync fits comfortably in a function
      // invocation, and the per-page advisory lock (ADR 0004) makes a
      // concurrent manual **Sync now** safe. A `{skipped: true}` result -
      // another sync already owned this connection - is a fine outcome:
      // that other sync is doing this one's work.
      await runSync(db, connection.ownerId, connection.id, { provider, keyring });
    } else {
      const code = reauthCode(event);
      if (code) {
        await bankRepo.recordSyncError(db, connection.ownerId, connection.id, {
          status: 'reauth_required',
          code,
        });
      }
      // Everything else - WEBHOOK_UPDATE_ACKNOWLEDGED and anything this
      // deployment does not recognise - is a no-op: recorded, not acted on.
    }

    await webhookEventsRepo.markWebhookProcessed(db, eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A code, never the failure's own message and never the payload (spec
    // §9): `syncFailureOf` is the same mapping a sync's own failures go
    // through, so this row never carries more than a connection's own
    // `last_error_code` would.
    if (eventId) {
      try {
        await webhookEventsRepo.markWebhookProcessed(db, eventId, syncFailureOf(error).code);
      } catch (ledgerError) {
        // If the database is what failed above, this write fails with it,
        // and a throw from here would leave the handler as a 500 - the one
        // outcome after verification this route promises never to produce,
        // and a status Plaid retries against (Phase 5 audit). The row stays
        // unmarked, which the cron sync's catch-up covers. The message and
        // stack, never the object: a driver error carries the failing query
        // and its parameters.
        console.error(
          'Failed to record a webhook failure on its ledger row:',
          ledgerError instanceof Error
            ? (ledgerError.stack ?? `${ledgerError.name}: ${ledgerError.message}`)
            : String(ledgerError)
        );
      }
    }
    return NextResponse.json({ ok: true });
  }
}
