import { parseMoney } from '@budget-bot/core';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import type { Database } from '../../src/client';
import { loadKeysFromEnv } from '../../src/crypto';
import { ConnectionAlreadyExistsError, bankRepo } from '../../src/repos';
import { bankAccounts, bankConnections, transactions } from '../../src/schema';
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

  it('has no card to show when nothing enabled is a credit line', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    await linkCard(db, ownerId, { type: 'depository' });

    // Spec §6: the profile is the first enabled *credit* account. A checking
    // account drawn behind a credit-card icon, with a limit of $0 because a
    // checking account has no limit, is worse than an empty header.
    expect(await bankRepo.getCardProfile(db, ownerId)).toBeNull();
  });

  it('passes over the checking account a connection was linked with', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const [connection] = await db
      .insert(bankConnections)
      .values({
        ownerId,
        itemId: `item-${crypto.randomUUID()}`,
        institutionName: 'Fake Bank',
        accessTokenCiphertext: 'v1:k2:aaaa:bbbb:cccc',
        encryptionKeyId: 'k2',
      })
      .returning({ id: bankConnections.id });

    // The order Plaid lists them in, and the order they are written in: the
    // checking account is older, so it wins every tie-break there is. The type
    // is what has to decide this, not the clock.
    await db.insert(bankAccounts).values({
      ownerId,
      connectionId: connection.id,
      externalAccountId: 'acct-checking',
      name: 'Fake Business Checking',
      mask: '0000',
      type: 'depository',
      subtype: 'checking',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await db.insert(bankAccounts).values({
      ownerId,
      connectionId: connection.id,
      externalAccountId: 'acct-credit',
      name: 'Fake Business Card',
      mask: '4471',
      type: 'credit',
      subtype: 'credit card',
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const profile = await bankRepo.getCardProfile(db, ownerId);

    expect(profile).toMatchObject({ cardName: 'Fake Business Card', last4: '4471' });
    // And the write-back follows the read: renaming "the card" renames the
    // card, not whichever row happened to be first.
    const renamed = await bankRepo.updateCardProfile(db, ownerId, { cardName: 'Business Visa' });
    expect(renamed).toMatchObject({ cardName: 'Business Visa', last4: '4471' });
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

/**
 * Token storage (ADR 0002). What is being pinned here is a negative: the
 * plaintext access token appears in exactly one place - inside
 * `withAccessToken`'s callback - and nowhere else, no matter which read path
 * a caller takes. Every assertion below that stringifies a result is checking
 * that, because a repo that quietly widened its select list is how a
 * credential ends up in a log line or a server-component payload.
 */

const KEYRING = loadKeysFromEnv({
  BANK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});

const ACCESS_TOKEN = 'access-sandbox-8f2a1c04-b6d9-4e77-9b12-0d3a5c6e7f80';

const newConnection = (overrides: Partial<bankRepo.NewBankConnection> = {}) => ({
  provider: 'plaid',
  itemId: `item-${crypto.randomUUID()}`,
  accessToken: ACCESS_TOKEN,
  institutionId: 'ins_109508',
  institutionName: 'First Platypus Bank',
  ...overrides,
});

const account = (
  overrides: Partial<bankRepo.BankAccountInput> = {}
): bankRepo.BankAccountInput => ({
  externalId: 'acct-checking',
  name: 'Plaid Checking',
  officialName: 'Plaid Gold Standard 0% Interest Checking',
  mask: '0000',
  type: 'depository',
  subtype: 'checking',
  currentBalanceCents: parseMoney('110.00'),
  availableBalanceCents: parseMoney('100.00'),
  creditLimitCents: null,
  isoCurrencyCode: 'USD',
  ...overrides,
});

describeDb('bankRepo.createConnection', () => {
  it('stores the token encrypted and never returns it', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    const connection = await bankRepo.createConnection(
      db,
      ownerId,
      newConnection(),
      KEYRING
    );

    expect(JSON.stringify(connection)).not.toContain('access-sandbox');
    const [raw] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, connection.id));
    expect(raw.accessTokenCiphertext).toMatch(/^v1:[0-9a-f]{8}:/);
    expect(raw.accessTokenCiphertext).not.toContain('access-sandbox');
    expect(raw.encryptionKeyId).toBe(KEYRING.current.keyId);

    const listed = await bankRepo.listConnections(db, ownerId);
    expect(JSON.stringify(listed)).not.toContain('access-sandbox');
    expect(JSON.stringify(await bankRepo.getConnection(db, ownerId, connection.id)))
      .not.toContain('access-sandbox');
  });

  it('binds the ciphertext to the row it belongs to', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const mine = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    const theirs = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);

    // The AAD is the connection id, so a ciphertext moved between two rows of
    // the same owner fails to authenticate rather than decrypting (ADR 0002).
    const [row] = await db
      .select({ ciphertext: bankConnections.accessTokenCiphertext })
      .from(bankConnections)
      .where(eq(bankConnections.id, mine.id));
    await db
      .update(bankConnections)
      .set({ accessTokenCiphertext: row.ciphertext })
      .where(eq(bankConnections.id, theirs.id));

    await expect(
      bankRepo.withAccessToken(db, ownerId, theirs.id, KEYRING, async (t) => t)
    ).rejects.toThrow(/authentication/);
  });

  it('leaves nothing behind when the insert cannot be completed', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const itemId = `item-${crypto.randomUUID()}`;
    await bankRepo.createConnection(db, ownerId, newConnection({ itemId }), KEYRING);

    // `(provider, item_id)` is unique: linking the same Item twice is the
    // duplicate that would otherwise leave a row with an empty ciphertext.
    await expect(
      bankRepo.createConnection(db, ownerId, newConnection({ itemId }), KEYRING)
    ).rejects.toBeInstanceOf(ConnectionAlreadyExistsError);

    const rows = await db.select().from(bankConnections);
    expect(rows).toHaveLength(1);
    expect(rows[0].accessTokenCiphertext).not.toBe('');
  });

  it('answers the same way when the Item is already linked by somebody else', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const itemId = `item-${crypto.randomUUID()}`;
    await bankRepo.createConnection(db, alice, newConnection({ itemId }), KEYRING);

    // The constraint is `(provider, item_id)` with no owner in it, and that is
    // correct: a Plaid Item id identifies one login at one institution across
    // the whole of Plaid, so the same id arriving for a second owner means the
    // same linked login, not a collision between two unrelated banks. Two
    // owners cannot reach it in practice - an Item is minted by the Link flow
    // the owner just completed - so the honest answer is the one Alice gets.
    await expect(
      bankRepo.createConnection(db, bob, newConnection({ itemId }), KEYRING)
    ).rejects.toBeInstanceOf(ConnectionAlreadyExistsError);

    // And it says nothing about who has it: no owner id, no item id.
    const thrown = await bankRepo
      .createConnection(db, bob, newConnection({ itemId }), KEYRING)
      .then(() => null)
      .catch((error: unknown) => error as Error);
    expect(thrown?.message).not.toContain(alice);
    expect(thrown?.message).not.toContain(itemId);
  });
});

describeDb('bankRepo.withAccessToken', () => {
  it('hands the plaintext only to the callback, bound to the row', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    await expect(
      bankRepo.withAccessToken(db, alice, connection.id, KEYRING, async (token) => token)
    ).resolves.toBe(ACCESS_TOKEN);

    await expect(
      bankRepo.withAccessToken(db, bob, connection.id, KEYRING, async (token) => token)
    ).rejects.toThrow(/not found/);
  });

  it('says nothing about a connection that is not this owner’s', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    // Not "no connection <uuid>": naming the row would confirm to Bob that it
    // exists, which is the one thing the check is there to withhold.
    const error = await bankRepo
      .withAccessToken(db, bob, connection.id, KEYRING, async (t) => t)
      .then(() => null, (e: Error) => e);
    expect(error?.name).toBe('ConnectionNotFoundError');
    expect(error?.message).not.toContain(connection.id);
  });

  it('refuses an id that is not a uuid rather than letting Postgres raise', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    await expect(
      bankRepo.withAccessToken(db, ownerId, 'conn-1', KEYRING, async (t) => t)
    ).rejects.toThrow(/not found/);
  });

  it('still reads a row written under a key that has since been rotated out', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);

    const rotated = loadKeysFromEnv({
      BANK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      BANK_TOKEN_ENCRYPTION_KEY_PREVIOUS: Buffer.alloc(32, 7).toString('base64'),
    });

    await expect(
      bankRepo.withAccessToken(db, ownerId, connection.id, rotated, async (token) => token)
    ).resolves.toBe(ACCESS_TOKEN);
  });
});

describeDb('bankRepo.upsertAccounts', () => {
  it('upserts accounts by (connection, external id)', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);

    await bankRepo.upsertAccounts(db, ownerId, connection.id, [
      account(),
      account({ externalId: 'acct-card', name: 'Plaid Credit Card', type: 'credit' }),
    ]);
    const [refreshed] = await bankRepo.upsertAccounts(db, ownerId, connection.id, [
      account({ currentBalanceCents: parseMoney('250.25') }),
    ]);

    const accounts = await bankRepo.listAccounts(db, ownerId, connection.id);
    expect(accounts).toHaveLength(2);
    expect(refreshed.currentBalanceCents).toBe(25025);
    expect(refreshed.balancesUpdatedAt).not.toBeNull();
    expect(accounts.find((a) => a.externalId === 'acct-checking')?.currentBalanceCents).toBe(
      25025
    );
  });

  it('maps every column the provider supplies', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);

    const [created] = await bankRepo.upsertAccounts(db, ownerId, connection.id, [
      account({
        externalId: 'acct-card',
        name: 'Plaid Credit Card',
        officialName: 'Plaid Diamond 12.5% APR Interest Credit Card',
        mask: '3333',
        type: 'credit',
        subtype: 'credit card',
        currentBalanceCents: parseMoney('410.00'),
        availableBalanceCents: parseMoney('590.00'),
        creditLimitCents: parseMoney('1000.00'),
      }),
    ]);

    expect(created).toMatchObject({
      externalId: 'acct-card',
      name: 'Plaid Credit Card',
      officialName: 'Plaid Diamond 12.5% APR Interest Credit Card',
      mask: '3333',
      type: 'credit',
      subtype: 'credit card',
      currentBalanceCents: 41000,
      availableBalanceCents: 59000,
      creditLimitCents: 100000,
      isoCurrencyCode: 'USD',
      isEnabled: true,
    });
  });

  it('leaves the columns the user owns alone when balances refresh', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    const [created] = await bankRepo.upsertAccounts(db, ownerId, connection.id, [account()]);

    await db
      .update(bankAccounts)
      .set({ cardName: 'Everyday card', cycleResetDay: 12, isEnabled: false })
      .where(eq(bankAccounts.id, created.id));
    await bankRepo.upsertAccounts(db, ownerId, connection.id, [
      account({ currentBalanceCents: parseMoney('1.00') }),
    ]);

    const [row] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, created.id));
    expect(row).toMatchObject({
      cardName: 'Everyday card',
      cycleResetDay: 12,
      // A disabled account stays disabled: "stop syncing this one" is the
      // user's decision and the provider re-listing it is not an argument.
      isEnabled: false,
      currentBalanceCents: 100,
    });
  });

  it('refuses to write accounts onto another owner’s connection', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    await expect(
      bankRepo.upsertAccounts(db, bob, connection.id, [account()])
    ).rejects.toThrow(/not found/);
    expect(await db.select().from(bankAccounts)).toHaveLength(0);
  });
});

describeDb('bankRepo.listConnections', () => {
  it('reports each connection with the accounts behind it', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    await bankRepo.upsertAccounts(db, ownerId, connection.id, [
      account(),
      account({ externalId: 'acct-card', name: 'Plaid Credit Card' }),
    ]);

    const [listed] = await bankRepo.listConnections(db, ownerId);

    expect(listed).toMatchObject({
      id: connection.id,
      provider: 'plaid',
      institutionName: 'First Platypus Bank',
      status: 'active',
      cursor: null,
      lastSyncedAt: null,
      lastErrorCode: null,
    });
    expect(listed.accounts.map((a) => a.externalId).sort()).toEqual([
      'acct-card',
      'acct-checking',
    ]);
  });

  it('never shows one owner another owner’s connection', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    expect(await bankRepo.listConnections(db, bob)).toEqual([]);
    expect(await bankRepo.getConnection(db, bob, connection.id)).toBeNull();
  });
});

describeDb('bankRepo sync bookkeeping', () => {
  it('commits a cursor for the owner’s own connection only', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    await bankRepo.setCursor(db, bob, connection.id, 'stolen');
    expect((await bankRepo.getConnection(db, alice, connection.id))?.cursor).toBeNull();

    await bankRepo.setCursor(db, alice, connection.id, 'cursor-page-1');
    expect((await bankRepo.getConnection(db, alice, connection.id))?.cursor).toBe(
      'cursor-page-1'
    );
  });

  it('records a completed sync and clears the last error', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    await bankRepo.recordSyncError(db, ownerId, connection.id, {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'reauth_required',
    });

    await bankRepo.recordSyncResult(db, ownerId, connection.id, {
      added: 12,
      modified: 3,
      removed: 1,
      pages: 2,
      hasMore: false,
    });

    const after = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(after).toMatchObject({
      status: 'active',
      lastErrorCode: null,
      lastErrorAt: null,
    });
    expect(after?.lastSyncedAt).not.toBeNull();
  });

  it('records the error code and the status a failed sync leaves behind', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);

    await bankRepo.recordSyncError(db, ownerId, connection.id, {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'reauth_required',
    });

    const after = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(after).toMatchObject({
      status: 'reauth_required',
      lastErrorCode: 'ITEM_LOGIN_REQUIRED',
    });
    expect(after?.lastErrorAt).not.toBeNull();
  });
});

describeDb('bankRepo.listActiveConnectionsAllOwners', () => {
  it('finds active connections across every owner, and never the ciphertext', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const alicesActive = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);
    const bobsActive = await bankRepo.createConnection(db, bob, newConnection(), KEYRING);
    const bobsErrored = await bankRepo.createConnection(db, bob, newConnection(), KEYRING);
    await bankRepo.recordSyncError(db, bob, bobsErrored.id, {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'error',
    });

    const rows = await bankRepo.listActiveConnectionsAllOwners(db);

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: alicesActive.id, ownerId: alice },
        { id: bobsActive.id, ownerId: bob },
      ])
    );
    expect(rows.some((row) => row.id === bobsErrored.id)).toBe(false);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['id', 'ownerId']);
    }
  });
});

/**
 * Re-authentication (spec §5). Both functions end a connection at `'active'`
 * with its errors cleared; what distinguishes them is which row they are
 * allowed to touch. `replaceConnectionToken` is reached from the re-link
 * upsert - a second Link run against a bank that is already connected, which
 * arrives as `ConnectionAlreadyExistsError` and names only an item id, not a
 * connection id - so it has to find the row itself and refuse to touch one
 * that is not the caller's. `markConnectionActive` is reached from Link's
 * update mode, which already has the connection id and only has to flip it.
 */
const NEW_ACCESS_TOKEN = 'access-sandbox-new-8f2a1c04-b6d9-4e77-9b12-0d3a5c6e7f81';

describeDb('bankRepo.replaceConnectionToken', () => {
  it('re-encrypts the new token under the existing row, decryptably', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const itemId = `item-${crypto.randomUUID()}`;
    const original = await bankRepo.createConnection(
      db,
      ownerId,
      newConnection({ itemId }),
      KEYRING
    );

    const replaced = await bankRepo.replaceConnectionToken(db, ownerId, {
      itemId,
      accessToken: NEW_ACCESS_TOKEN,
      keyring: KEYRING,
    });

    expect(replaced).toEqual({ id: original.id });
    await expect(
      bankRepo.withAccessToken(db, ownerId, original.id, KEYRING, async (t) => t)
    ).resolves.toBe(NEW_ACCESS_TOKEN);

    // Re-encrypted against the *existing* row id, same as `createConnection`
    // (ADR 0002) - not a fresh row, and not decryptable under some other AAD.
    const [raw] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, original.id));
    expect(raw.accessTokenCiphertext).not.toContain('access-sandbox');
  });

  it('keeps the cursor: the same item, so the same pagination state', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const itemId = `item-${crypto.randomUUID()}`;
    const original = await bankRepo.createConnection(
      db,
      ownerId,
      newConnection({ itemId }),
      KEYRING
    );
    await bankRepo.setCursor(db, ownerId, original.id, 'cursor-page-9');

    await bankRepo.replaceConnectionToken(db, ownerId, {
      itemId,
      accessToken: NEW_ACCESS_TOKEN,
      keyring: KEYRING,
    });

    expect((await bankRepo.getConnection(db, ownerId, original.id))?.cursor).toBe(
      'cursor-page-9'
    );
  });

  it('sets the connection active and clears whatever error it recorded', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const itemId = `item-${crypto.randomUUID()}`;
    const original = await bankRepo.createConnection(
      db,
      ownerId,
      newConnection({ itemId }),
      KEYRING
    );
    await bankRepo.recordSyncError(db, ownerId, original.id, {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'reauth_required',
    });

    await bankRepo.replaceConnectionToken(db, ownerId, {
      itemId,
      accessToken: NEW_ACCESS_TOKEN,
      keyring: KEYRING,
    });

    const after = await bankRepo.getConnection(db, ownerId, original.id);
    expect(after).toMatchObject({
      status: 'active',
      lastErrorCode: null,
      lastErrorAt: null,
    });
  });

  it('refuses another owner’s row, untouched, byte for byte', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const itemId = `item-${crypto.randomUUID()}`;
    const alices = await bankRepo.createConnection(
      db,
      alice,
      newConnection({ itemId }),
      KEYRING
    );
    const [before] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, alices.id));

    const replaced = await bankRepo.replaceConnectionToken(db, bob, {
      itemId,
      accessToken: NEW_ACCESS_TOKEN,
      keyring: KEYRING,
    });

    expect(replaced).toBeNull();
    const [after] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, alices.id));
    expect(after).toEqual(before);
    // Alice's own token still opens with what she linked, not Bob's attempt.
    await expect(
      bankRepo.withAccessToken(db, alice, alices.id, KEYRING, async (t) => t)
    ).resolves.toBe(ACCESS_TOKEN);
  });

  it('answers null for an item id nothing has linked, rather than throwing', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    const replaced = await bankRepo.replaceConnectionToken(db, ownerId, {
      itemId: 'item-nobody-has-linked',
      accessToken: NEW_ACCESS_TOKEN,
      keyring: KEYRING,
    });

    expect(replaced).toBeNull();
  });
});

describeDb('bankRepo.markConnectionActive', () => {
  it('activates the owner’s connection and clears its error', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    await bankRepo.recordSyncError(db, ownerId, connection.id, {
      code: 'ITEM_LOGIN_REQUIRED',
      status: 'reauth_required',
    });

    const result = await bankRepo.markConnectionActive(db, ownerId, connection.id);

    expect(result).toBe(true);
    const after = await bankRepo.getConnection(db, ownerId, connection.id);
    expect(after).toMatchObject({
      status: 'active',
      lastErrorCode: null,
      lastErrorAt: null,
    });
  });

  it('refuses to activate another owner’s connection', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    expect(await bankRepo.markConnectionActive(db, bob, connection.id)).toBe(false);
    expect((await bankRepo.getConnection(db, alice, connection.id))?.status).toBe('active');
  });

  it('answers false for a connection id that does not exist', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await bankRepo.markConnectionActive(db, ownerId, crypto.randomUUID())).toBe(false);
  });

  it('refuses an id that is not a uuid rather than letting Postgres raise', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await bankRepo.markConnectionActive(db, ownerId, 'conn-1')).toBe(false);
  });
});

/**
 * Disconnect (spec §6).
 *
 * Two cascades meet at this one statement: `bank_accounts.connection_id` is
 * `ON DELETE CASCADE`, so the accounts behind a disconnected bank disappear
 * with it, and `transactions.bank_account_id` is `ON DELETE SET NULL`, so a
 * charge that was already filed keeps its category, its project and its place
 * in the ledger - it just stops pointing at a bank account that no longer
 * exists. The owner-scoped `WHERE` lives on the `DELETE` itself rather than a
 * lookup beforehand, the same shape `markConnectionActive` uses: a connection
 * id that belongs to somebody else and one that does not exist read as the
 * same `false`.
 */
describeDb('bankRepo.deleteConnection', () => {
  it('removes the connection and cascades its accounts', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    await bankRepo.upsertAccounts(db, ownerId, connection.id, [account()]);

    expect(await bankRepo.deleteConnection(db, ownerId, connection.id)).toBe(true);

    expect(await bankRepo.getConnection(db, ownerId, connection.id)).toBeNull();
    expect(
      await db.select().from(bankAccounts).where(eq(bankAccounts.connectionId, connection.id))
    ).toEqual([]);
  });

  it('leaves a filed transaction in the ledger with its bank link cleared', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const connection = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    const [linkedAccount] = await bankRepo.upsertAccounts(db, ownerId, connection.id, [account()]);
    const [filed] = await db
      .insert(transactions)
      .values({
        ownerId,
        date: '2026-08-14',
        description: 'THE HOME DEPOT #0421',
        vendor: 'The Home Depot',
        amountCents: parseMoney('114.75'),
        category: 'materials',
        paymentMethod: 'card',
        status: 'matched',
        taxDeductible: true,
        provider: 'plaid',
        externalId: 'tx-external-1',
        bankAccountId: linkedAccount.id,
      })
      .returning({ id: transactions.id });

    await bankRepo.deleteConnection(db, ownerId, connection.id);

    const [after] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, filed.id));
    expect(after).toMatchObject({
      id: filed.id,
      vendor: 'The Home Depot',
      status: 'matched',
      bankAccountId: null,
    });
  });

  it('refuses another owner’s connection, leaving the row untouched', async () => {
    const db = getDb();
    const alice = await createOwner(db);
    const bob = await createOwner(db);
    const connection = await bankRepo.createConnection(db, alice, newConnection(), KEYRING);

    expect(await bankRepo.deleteConnection(db, bob, connection.id)).toBe(false);
    expect(await bankRepo.getConnection(db, alice, connection.id)).not.toBeNull();
  });

  it('leaves a second connection of the same owner untouched', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);
    const gone = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);
    const kept = await bankRepo.createConnection(db, ownerId, newConnection(), KEYRING);

    expect(await bankRepo.deleteConnection(db, ownerId, gone.id)).toBe(true);

    expect(await bankRepo.getConnection(db, ownerId, gone.id)).toBeNull();
    expect(await bankRepo.getConnection(db, ownerId, kept.id)).not.toBeNull();
  });

  it('answers false for a connection id that does not exist', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await bankRepo.deleteConnection(db, ownerId, crypto.randomUUID())).toBe(false);
  });

  it('refuses an id that is not a uuid rather than letting Postgres raise', async () => {
    const db = getDb();
    const ownerId = await createOwner(db);

    expect(await bankRepo.deleteConnection(db, ownerId, 'conn-1')).toBe(false);
  });
});
