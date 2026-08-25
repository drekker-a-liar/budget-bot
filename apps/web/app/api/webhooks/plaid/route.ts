import { NextResponse } from 'next/server';
import { WebhookVerificationError, type WebhookEvent } from '@budget-bot/bank-connectors';
import { bankRepo, getDb, webhookEventsRepo } from '@budget-bot/db';
import { loadKeysFromEnv } from '@budget-bot/db/crypto';
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
 * The only non-200 is 401, for a body whose signature does not check out.
 * Every other outcome - no provider configured, an item this deployment does
 * not recognise, a crash after the payload was accepted - answers 200, so
 * Plaid neither retries forever nor learns anything from the status code
 * alone about what is running behind it. The cron sync (spec §4) is the
 * retry mechanism for whatever this request could not finish; a Plaid
 * redelivery is not.
 */

/** `ITEM` codes that mean the user has to reconnect, not the system retrying. */
const ITEM_REAUTH_CODES = new Set(['PENDING_EXPIRATION', 'USER_PERMISSION_REVOKED']);

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
  // Read before any parse: the signature covers the exact bytes that arrived,
  // and anything that touched the body first could disagree with it.
  const rawBody = await request.text();
  const headers = headerRecord(request.headers);

  const provider = getBankProvider();
  if (!provider) {
    // A deployment with no Plaid credentials configured is a supported
    // deployment (spec §7); there is nothing here to verify against, and
    // nothing to learn from refusing a webhook it never asked Plaid to send.
    return NextResponse.json({ ok: true });
  }

  let event: WebhookEvent;
  try {
    event = await provider.verifyAndParseWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    // Something failed before a signature could even be checked - an
    // unreachable key server, say. Nothing has been recorded, and nothing
    // safe can be said about why; the cron sync is the backstop.
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
      await webhookEventsRepo.markWebhookProcessed(db, eventId, syncFailureOf(error).code);
    }
    return NextResponse.json({ ok: true });
  }
}
