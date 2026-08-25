import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { webhookEventsRepo } from '../../src/repos';
import { webhookEvents } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';

const getDb = useTestDb();

/**
 * The replay ledger repo (spec §3, §7): every function here is cross-owner,
 * because a webhook arrives naming an item, not an owner, and the owner is
 * filled in later if the item resolves to a connection at all.
 */
describeDb('webhookEventsRepo', () => {
  it('records a new payload and hands back its id', async () => {
    const db = getDb();

    const result = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:aaaa',
      itemId: 'item-1',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });

    expect('id' in result).toBe(true);
    if (!('id' in result)) throw new Error('unreachable');

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, result.id));
    expect(row.bodyHash).toBe('sha256:aaaa');
    expect(row.itemId).toBe('item-1');
    expect(row.ownerId).toBeNull();
    expect(row.processedAt).toBeNull();
  });

  it('recognises a redelivered body rather than inserting a second row', async () => {
    const db = getDb();
    const first = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:bbbb',
      itemId: 'item-1',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });
    expect('id' in first).toBe(true);

    const second = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:bbbb',
      itemId: 'item-1',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });

    expect(second).toEqual({ duplicate: true });

    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.bodyHash, 'sha256:bbbb'));
    expect(rows).toHaveLength(1);
  });

  it('fills in the owner once the item has resolved to a connection', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const recorded = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:cccc',
      itemId: 'item-2',
      webhookType: 'ITEM',
      webhookCode: 'PENDING_EXPIRATION',
    });
    if (!('id' in recorded)) throw new Error('unreachable');

    await webhookEventsRepo.resolveWebhookOwner(db, recorded.id, ownerId);

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, recorded.id));
    expect(row.ownerId).toBe(ownerId);
  });

  it('marks a row processed with no error on a clean dispatch', async () => {
    const db = getDb();
    const recorded = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:dddd',
      itemId: null,
      webhookType: 'ITEM',
      webhookCode: 'WEBHOOK_UPDATE_ACKNOWLEDGED',
    });
    if (!('id' in recorded)) throw new Error('unreachable');

    await webhookEventsRepo.markWebhookProcessed(db, recorded.id);

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, recorded.id));
    expect(row.processedAt).not.toBeNull();
    expect(row.error).toBeNull();
  });

  it('records the error code alongside the processed timestamp', async () => {
    const db = getDb();
    const recorded = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:eeee',
      itemId: null,
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });
    if (!('id' in recorded)) throw new Error('unreachable');

    await webhookEventsRepo.markWebhookProcessed(db, recorded.id, 'SYNC_FAILED');

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, recorded.id));
    expect(row.processedAt).not.toBeNull();
    expect(row.error).toBe('SYNC_FAILED');
  });

  it('deletes only the named owner’s resolved rows, and says how many (N-1)', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);

    const alices = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:alice-1',
      itemId: 'item-alice',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });
    if (!('id' in alices)) throw new Error('unreachable');
    await webhookEventsRepo.resolveWebhookOwner(db, alices.id, alice);

    const bobs = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:bob-1',
      itemId: 'item-bob',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });
    if (!('id' in bobs)) throw new Error('unreachable');
    await webhookEventsRepo.resolveWebhookOwner(db, bobs.id, bob);

    // Never resolved to anyone - a redelivery for an item this deployment
    // never recognised - and so has no owner to be deleted for.
    const unresolved = await webhookEventsRepo.recordWebhookEvent(db, {
      provider: 'plaid',
      bodyHash: 'sha256:unresolved-1',
      itemId: 'item-nobody-recognises',
      webhookType: 'TRANSACTIONS',
      webhookCode: 'SYNC_UPDATES_AVAILABLE',
    });
    if (!('id' in unresolved)) throw new Error('unreachable');

    const deleted = await webhookEventsRepo.deleteOwnerWebhookEvents(db, alice);

    expect(deleted).toBe(1);
    const remaining = await db.select().from(webhookEvents);
    expect(remaining.map((row) => row.id).sort()).toEqual([bobs.id, unresolved.id].sort());
  });

  it('purges only rows older than the cutoff, and says how many', async () => {
    const db = getDb();
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    await db.insert(webhookEvents).values([
      { provider: 'plaid', bodyHash: 'sha256:old-1', receivedAt: old },
      { provider: 'plaid', bodyHash: 'sha256:old-2', receivedAt: old },
      { provider: 'plaid', bodyHash: 'sha256:recent-1', receivedAt: recent },
    ]);

    const purged = await webhookEventsRepo.purgeWebhookEvents(db, 30);

    expect(purged).toBe(2);
    const remaining = await db.select().from(webhookEvents);
    expect(remaining.map((row) => row.bodyHash)).toEqual(['sha256:recent-1']);
  });
});
