import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { users, webhookEvents } from '../src/schema';
import { createOwner, describeDb, useTestDb } from './helpers/db';

const getDb = useTestDb();

/**
 * `webhook_events` is the one table whose `owner_id` is nullable, and these
 * tests are why. The body hash is the replay defence (spec §7): it has to be
 * recorded the moment a payload arrives, which is before the item has been
 * resolved to an owner - and some payloads name an item this deployment has
 * never seen. A NOT NULL owner would leave exactly those payloads unprotected.
 */
describeDb('webhook_events', () => {
  it('records a payload before its item has been resolved to an owner', async () => {
    const db = getDb();

    const [row] = await db
      .insert(webhookEvents)
      .values({
        provider: 'plaid',
        itemId: 'item-nobody-here-has-ever-seen',
        webhookType: 'TRANSACTIONS',
        webhookCode: 'SYNC_UPDATES_AVAILABLE',
        bodyHash: 'sha256:aaaa',
      })
      .returning();

    expect(row.ownerId).toBeNull();
    expect(row.bodyHash).toBe('sha256:aaaa');
  });

  it('refuses a redelivered payload rather than letting it be applied twice', async () => {
    const db = getDb();
    const payload = { provider: 'plaid', bodyHash: 'sha256:bbbb' };
    await db.insert(webhookEvents).values(payload);

    const failure = await db
      .insert(webhookEvents)
      .values(payload)
      .then(
        () => null,
        (error: { cause?: { constraint_name?: string } }) => error
      );

    expect(failure?.cause?.constraint_name).toBe('webhook_events_body_hash_key');
  });

  it('outlives the account it belonged to, so a redelivery is still recognised', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await db
      .insert(webhookEvents)
      .values({ provider: 'plaid', ownerId, bodyHash: 'sha256:dddd' });

    await db.delete(users).where(eq(users.id, ownerId));

    const [survivor] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.bodyHash, 'sha256:dddd'));
    expect(survivor).toBeDefined();
    expect(survivor.ownerId).toBeNull();
  });

  it('takes the owner once the item has been recognised', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const [row] = await db
      .insert(webhookEvents)
      .values({ provider: 'plaid', bodyHash: 'sha256:cccc' })
      .returning({ id: webhookEvents.id });

    await db
      .update(webhookEvents)
      .set({ ownerId, processedAt: new Date() })
      .where(eq(webhookEvents.id, row.id));

    const [processed] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, row.id));
    expect(processed.ownerId).toBe(ownerId);
    expect(processed.processedAt).not.toBeNull();
  });
});
