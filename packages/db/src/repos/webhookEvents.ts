import { eq, lt } from 'drizzle-orm';
import type { Executor } from '../client';
import { webhookEvents } from '../schema';

/**
 * The replay ledger for provider webhooks (spec §3, §7).
 *
 * Every function here is cross-owner, the same way `findConnectionByItemId`
 * in `bank.ts` is: a webhook names an item, not an owner, and there is no
 * session on the route that calls these at all. The owner is filled in only
 * once the item has resolved to a connection - which some payloads never do,
 * since a redelivery can name an item this deployment has never seen. Nothing
 * here takes an `ownerId` to scope a `where` clause against, because there is
 * nothing to scope by until `resolveWebhookOwner` has run.
 */

export interface NewWebhookEvent {
  provider: string;
  /** Hash of the raw body: the unique key a redelivery is recognised by. */
  bodyHash: string;
  /** The connection this is about, when the payload names one. */
  itemId: string | null;
  webhookType: string;
  webhookCode: string | null;
}

/**
 * Records a webhook's arrival, or recognises it as one already recorded.
 *
 * Cross-owner: the row is written the moment a *verified* payload arrives -
 * before its item id has been resolved to a connection or an owner. `INSERT
 * ... ON CONFLICT (body_hash) DO NOTHING` is the whole of the replay defence
 * (spec §7): a redelivered body lands as `{duplicate: true}` rather than a
 * second row, and nothing about it is reprocessed.
 */
export async function recordWebhookEvent(
  db: Executor,
  event: NewWebhookEvent
): Promise<{ id: string } | { duplicate: true }> {
  const [row] = await db
    .insert(webhookEvents)
    .values({
      provider: event.provider,
      bodyHash: event.bodyHash,
      itemId: event.itemId,
      webhookType: event.webhookType,
      webhookCode: event.webhookCode,
    })
    .onConflictDoNothing({ target: webhookEvents.bodyHash })
    .returning({ id: webhookEvents.id });

  return row ? { id: row.id } : { duplicate: true };
}

/**
 * Fills in the owner a webhook's item id resolved to.
 *
 * Cross-owner: called with whichever owner the route found behind the item -
 * there is no signed-in owner on this path to check it against (spec §3).
 */
export async function resolveWebhookOwner(
  db: Executor,
  eventId: string,
  ownerId: string
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ ownerId, updatedAt: new Date() })
    .where(eq(webhookEvents.id, eventId));
}

/**
 * Marks a webhook as handled, with why it was not a clean handling if so.
 *
 * Cross-owner: keyed on the row's own id, which the route already holds from
 * `recordWebhookEvent`. `error` is a code, the same discipline
 * `recordSyncError` keeps for a connection: this is the one write in the
 * system a provider's redelivery reaches directly, and free text from
 * somebody else's system - or the payload itself - does not belong on a row a
 * person can read (spec §9).
 */
export async function markWebhookProcessed(
  db: Executor,
  eventId: string,
  error?: string
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date(), error: error ?? null, updatedAt: new Date() })
    .where(eq(webhookEvents.id, eventId));
}

/**
 * Deletes ledger rows older than `olderThanDays`, and says how many.
 *
 * Cross-owner: a retention sweep across every owner's rows at once, run by a
 * cron that has no owner of its own - the ledger keeps rows 30 days (spec §7).
 */
export async function purgeWebhookEvents(db: Executor, olderThanDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, cutoff))
    .returning({ id: webhookEvents.id });
  return rows.length;
}

/**
 * Deletes one owner's ledger rows, for delete-all (spec §6).
 *
 * Owner-scoped, unlike everything else in this file: by the time
 * `deleteAllDataAction` runs, every row that will ever resolve to this owner
 * already has (`resolveWebhookOwner` fills it in synchronously, inside the
 * webhook route, before the row is ever left half-processed). A row that
 * never resolved to any owner - a redelivery for an item this deployment
 * never recognised - has no owner to delete it for, and is left for
 * `purgeWebhookEvents`' retention window instead.
 */
export async function deleteOwnerWebhookEvents(db: Executor, ownerId: string): Promise<number> {
  const rows = await db
    .delete(webhookEvents)
    .where(eq(webhookEvents.ownerId, ownerId))
    .returning({ id: webhookEvents.id });
  return rows.length;
}
