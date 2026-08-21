import { parseMoney } from '@budget-bot/core';
import { expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { bankRepo } from '../../src/repos';
import { bankAccounts, bankConnections } from '../../src/schema';
import { createOwner, describeDb, useTestDb } from '../helpers/db';

const getDb = useTestDb();

interface AccountOverrides {
  isEnabled?: boolean;
  cardName?: string | null;
  mask?: string;
  type?: string;
}

async function linkCard(
  db: Database,
  ownerId: string,
  overrides: AccountOverrides = {}
): Promise<string> {
  const [connection] = await db
    .insert(bankConnections)
    .values({
      ownerId,
      itemId: `item-${crypto.randomUUID()}`,
      institutionName: 'Capital One',
      accessTokenCiphertext: 'v1:k2:aaaa:bbbb:cccc',
      encryptionKeyId: 'k2',
    })
    .returning({ id: bankConnections.id });

  const [account] = await db
    .insert(bankAccounts)
    .values({
      ownerId,
      connectionId: connection.id,
      externalAccountId: `acct-${crypto.randomUUID()}`,
      name: 'Spark Business',
      cardName: overrides.cardName === undefined ? 'Spark Business Cash 1.5%' : overrides.cardName,
      mask: overrides.mask ?? '4892',
      type: overrides.type ?? 'credit',
      currentBalanceCents: parseMoney('3248.65'),
      limitCents: parseMoney('25000.00'),
      cycleResetDay: 28,
      isEnabled: overrides.isEnabled ?? true,
      balancesUpdatedAt: new Date('2026-08-19T18:30:00.000Z'),
    })
    .returning({ id: bankAccounts.id });
  return account.id;
}

describeDb('bankRepo.getCardProfile', () => {
  it('is null until the owner has linked an account', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await bankRepo.getCardProfile(db, ownerId)).toBeNull();
  });

  it('synthesises the card the dashboard expects from the linked account', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const accountId = await linkCard(db, ownerId);

    const profile = await bankRepo.getCardProfile(db, ownerId);

    expect(profile).toEqual({
      id: accountId,
      cardName: 'Spark Business Cash 1.5%',
      issuer: 'Capital One',
      last4: '4892',
      cardType: 'credit',
      currentBalanceCents: 324865,
      creditLimitCents: 2500000,
      cycleResetDay: 28,
      lastSyncedAt: '2026-08-19T18:30:00.000Z',
    });
  });

  it('falls back to the bank’s own name when the user has not renamed the card', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await linkCard(db, ownerId, { cardName: null });

    expect((await bankRepo.getCardProfile(db, ownerId))?.cardName).toBe('Spark Business');
  });

  it('reads anything that is not a credit line as a debit card', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await linkCard(db, ownerId, { type: 'depository' });

    expect((await bankRepo.getCardProfile(db, ownerId))?.cardType).toBe('debit');
  });

  it('ignores an account the owner has disabled', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await linkCard(db, ownerId, { isEnabled: false });

    expect(await bankRepo.getCardProfile(db, ownerId)).toBeNull();
  });

  it('never shows one owner another owner’s card', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    await linkCard(db, alice);

    expect(await bankRepo.getCardProfile(db, bob)).toBeNull();
    expect(await bankRepo.updateCardProfile(db, bob, { cardName: 'Mine now' })).toBeNull();
    expect((await bankRepo.getCardProfile(db, alice))?.cardName).toBe(
      'Spark Business Cash 1.5%'
    );
  });

  it('writes back the two fields the card screen lets a user change', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await linkCard(db, ownerId);

    const updated = await bankRepo.updateCardProfile(db, ownerId, {
      cardName: 'Business Visa',
      cycleResetDay: 15,
      // Not editable here: the provider owns the balance.
      currentBalanceCents: parseMoney('0.00'),
    });

    expect(updated?.cardName).toBe('Business Visa');
    expect(updated?.cycleResetDay).toBe(15);
    expect(updated?.currentBalanceCents).toBe(324865);
  });
});
