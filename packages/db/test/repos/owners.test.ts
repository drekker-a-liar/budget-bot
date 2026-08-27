import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { ownersRepo } from '../../src/repos';
import { users } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';

const getDb = useTestDb();

/**
 * Auth.js stores whatever casing the OAuth provider sent, and people type
 * their own address however they like. `email` is a plain text column, so a
 * lookup that lowercases only its input finds nothing when the stored address
 * has a capital in it - which would read as "no such user" for someone who is
 * signed in perfectly well.
 */
describeDb('ownersRepo.findOwnerIdByEmail', () => {
  it('finds a user whose stored address is not lower case', async () => {
    const db = getDb();
    const ownerId = await createOwner(db, 'Mike.OBrien@Example.COM');

    expect(await ownersRepo.findOwnerIdByEmail(db, 'mike.obrien@example.com')).toBe(ownerId);
  });

  it('finds the user however the caller types the address', async () => {
    const db = getDb();
    const ownerId = await createOwner(db, 'mike@example.com');

    expect(await ownersRepo.findOwnerIdByEmail(db, 'MIKE@EXAMPLE.COM')).toBe(ownerId);
    expect(await ownersRepo.findOwnerIdByEmail(db, 'Mike@Example.com')).toBe(ownerId);
  });

  it('is undefined for an address nobody has', async () => {
    const db = getDb();
    await createOwner(db, 'mike@example.com');

    expect(await ownersRepo.findOwnerIdByEmail(db, 'nobody@example.com')).toBeUndefined();
  });

  it('does not match a different address that merely starts the same', async () => {
    const db = getDb();
    await db.insert(users).values({ email: 'mike@example.com.au' });

    expect(await ownersRepo.findOwnerIdByEmail(db, 'mike@example.com')).toBeUndefined();
  });
});

/** What `calculateMonthlyMargins` (spec §2, §5) buckets a month by. */
describeDb('ownersRepo.getTimeZone', () => {
  it('is UTC for an owner who has never set one', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await ownersRepo.getTimeZone(db, ownerId)).toBe('UTC');
  });

  it('reads the zone out of settings once one is set', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await db
      .update(users)
      .set({ settings: { timeZone: 'America/Los_Angeles' } })
      .where(eq(users.id, ownerId));

    expect(await ownersRepo.getTimeZone(db, ownerId)).toBe('America/Los_Angeles');
  });
});
