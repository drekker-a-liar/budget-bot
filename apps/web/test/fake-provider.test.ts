import { createHash } from 'node:crypto';
import type { SyncResult } from '@budget-bot/bank-connectors';
import { WebhookVerificationError } from '@budget-bot/bank-connectors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_ACCESS_TOKEN,
  FAKE_INSTITUTION_NAME,
  FAKE_PUBLIC_TOKEN,
  FakeBankProvider,
  FakeBankProviderInProductionError,
  defaultFakeScript,
} from '@/src/server/bank/fake-provider';
import {
  getBankProvider,
  getBankProviderKind,
} from '@/src/server/bank/provider';
import { SCRIPTED_PUBLIC_TOKEN } from '@/lib/plaidLink';

/**
 * The scripted bank (spec §9).
 *
 * It exists so the sync service and the Playwright journey can be tested
 * without a Plaid account, which means it has to be a *faithful* `BankProvider`
 * and not a stub: it pages, it hands back a cursor that has to be sent back to
 * get the next page, and it refuses a token that is not the one it issued. A
 * fake that accepted anything would let a sync service pass its tests while
 * decrypting nothing.
 *
 * The rest of this file is about where it may not exist. It is selectable only
 * behind the `E2E=1` door, which cannot open in production (proven in Phase 1),
 * and it carries the same runtime guard `e2eCredentialsProvider` does anyway -
 * the two are independent, and the ways of defeating one are not ways of
 * defeating the other.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A page, with only the parts a case cares about spelled out. */
function page(overrides: Partial<SyncResult> = {}): SyncResult {
  return { added: [], modified: [], removed: [], nextCursor: null, hasMore: false, ...overrides };
}

describe('the default script', () => {
  it('has one checking account and one credit card, each with a mask', () => {
    const { accounts } = defaultFakeScript();

    expect(accounts.map((account) => account.mask)).toEqual(['0000', '4471']);
    expect(accounts.map((account) => account.type)).toEqual(['depository', 'credit']);
  });

  it('gives the credit card a limit and the checking account none', () => {
    const [checking, credit] = defaultFakeScript().accounts;

    expect(checking.creditLimitCents).toBeNull();
    expect(credit.creditLimitCents).toBeGreaterThan(0);
  });

  it('carries a hardware purchase out and a card payment in', () => {
    const rows = defaultFakeScript().pages.flatMap((p) => p.added);

    // Positive is money out (ADR 0004). The payment is the row that proves the
    // sign is not being flipped anywhere: a card payment is negative, and it
    // is what the sync service files as `ignored`.
    expect(rows.find((row) => row.rawDescriptor === 'FAKE HARDWARE 4471')?.amountCents).toBe(
      11475
    );
    expect(rows.some((row) => row.amountCents === -50000)).toBe(true);
  });

  it('names every transaction against an account the script also lists', () => {
    const script = defaultFakeScript();
    const known = new Set(script.accounts.map((account) => account.externalId));

    for (const row of script.pages.flatMap((p) => p.added)) {
      expect(known, `${row.externalId} names an account the script does not have`).toContain(
        row.accountExternalId
      );
    }
  });

  it('is deterministic when it is given a day to be relative to', () => {
    const day = new Date('2026-03-04T12:00:00.000Z');

    expect(JSON.stringify(defaultFakeScript(day))).toBe(
      JSON.stringify(defaultFakeScript(day))
    );
  });

  it('dates its transactions on and just before the day it was given', () => {
    const dates = defaultFakeScript(new Date('2026-03-04T12:00:00.000Z'))
      .pages.flatMap((p) => p.added)
      .map((row) => row.date);

    expect(dates.every((date) => date <= '2026-03-04')).toBe(true);
    expect(dates.every((date) => date >= '2026-03-01')).toBe(true);
  });
});

describe('paging', () => {
  const first = page({ added: [], nextCursor: 'fake-1', hasMore: true });
  const second = page({ nextCursor: 'fake-2', hasMore: false });

  function scripted() {
    return new FakeBankProvider({ accounts: defaultFakeScript().accounts, pages: [first, second] });
  }

  it('answers a null cursor with the first page', async () => {
    expect(await scripted().syncTransactions(FAKE_ACCESS_TOKEN, null)).toEqual(first);
  });

  it('answers a page cursor with the page that follows it', async () => {
    expect(await scripted().syncTransactions(FAKE_ACCESS_TOKEN, 'fake-1')).toEqual(second);
  });

  it('answers the last page cursor with an empty page that says so', async () => {
    const after = await scripted().syncTransactions(FAKE_ACCESS_TOKEN, 'fake-2');

    expect(after).toEqual({
      added: [],
      modified: [],
      removed: [],
      nextCursor: 'fake-2',
      hasMore: false,
    });
  });

  it('refuses a cursor no page in the script ever handed out', async () => {
    // A caller that has invented a cursor is a caller whose sync has lost its
    // place, and answering with the first page would replay the whole history
    // instead of saying so.
    await expect(scripted().syncTransactions(FAKE_ACCESS_TOKEN, 'not-a-cursor')).rejects.toThrow(
      /cursor/
    );
  });

  it('records every cursor it was asked for, in order', async () => {
    const provider = scripted();
    await provider.syncTransactions(FAKE_ACCESS_TOKEN, null);
    await provider.syncTransactions(FAKE_ACCESS_TOKEN, 'fake-1');

    expect(provider.cursorsRequested).toEqual([null, 'fake-1']);
  });

  it('fails the page the script says to fail, and only that page', async () => {
    const boom = new Error('scripted failure');
    const provider = new FakeBankProvider({
      accounts: [],
      pages: [first, second],
      failAtPage: { index: 1, error: boom },
    });

    await expect(provider.syncTransactions(FAKE_ACCESS_TOKEN, null)).resolves.toEqual(first);
    await expect(provider.syncTransactions(FAKE_ACCESS_TOKEN, 'fake-1')).rejects.toThrow(boom);
  });

  it('fails only as many times as the script says, so a restart can succeed', async () => {
    const provider = new FakeBankProvider({
      accounts: [],
      pages: [first, second],
      failAtPage: { index: 1, error: new Error('scripted failure'), times: 1 },
    });

    await provider.syncTransactions(FAKE_ACCESS_TOKEN, null);
    await expect(provider.syncTransactions(FAKE_ACCESS_TOKEN, 'fake-1')).rejects.toThrow();
    await expect(provider.syncTransactions(FAKE_ACCESS_TOKEN, 'fake-1')).resolves.toEqual(second);
  });
});

describe('the rest of the BankProvider surface', () => {
  function provider() {
    return new FakeBankProvider(defaultFakeScript());
  }

  it('is the plaid provider, because it stands in for one', () => {
    expect(provider().id).toBe('plaid');
  });

  it('mints a link token that expires in the future', async () => {
    const { linkToken, expiration } = await provider().createLinkToken({ userId: 'u1' });

    expect(linkToken).toBe('link-fake');
    expect(Date.parse(expiration)).toBeGreaterThan(Date.now());
  });

  it('exchanges its own public token for its own access token', async () => {
    expect(await provider().exchangePublicToken(FAKE_PUBLIC_TOKEN)).toEqual({
      accessToken: FAKE_ACCESS_TOKEN,
      itemId: 'item-fake',
      institutionId: 'ins_fake',
      institutionName: FAKE_INSTITUTION_NAME,
    });
  });

  it('refuses a public token it did not issue', async () => {
    await expect(provider().exchangePublicToken('public-sandbox-real')).rejects.toThrow(
      /public token/i
    );
  });

  /**
   * The strictness is the point. The access token reaches this provider only
   * by being decrypted out of the database inside `withAccessToken`, so a fake
   * that accepted any string would let a sync service pass its tests while
   * decrypting nothing at all.
   */
  it.each([
    ['getAccounts', (p: FakeBankProvider) => p.getAccounts('access-wrong')],
    ['syncTransactions', (p: FakeBankProvider) => p.syncTransactions('access-wrong', null)],
    ['removeItem', (p: FakeBankProvider) => p.removeItem('access-wrong')],
  ])('%s refuses an access token it did not issue', async (_name, call) => {
    await expect(call(provider())).rejects.toThrow(/access token/i);
  });

  it('lists the script accounts', async () => {
    expect(await provider().getAccounts(FAKE_ACCESS_TOKEN)).toEqual(
      defaultFakeScript().accounts
    );
  });

  it('removes the item without complaint', async () => {
    await expect(provider().removeItem(FAKE_ACCESS_TOKEN)).resolves.toBeUndefined();
  });

});

/**
 * The E2E-only door's stand-in for Plaid's signature (spec §2). It is not
 * cryptographic - there is no real key on either side of it - but the shape
 * of the check is the same one `PlaidProvider` makes: a header has to match a
 * hash of the exact bytes that arrived, or the webhook is refused.
 */
describe('verifyAndParseWebhook', () => {
  function provider() {
    return new FakeBankProvider(defaultFakeScript());
  }

  function bodyHashHex(rawBody: string): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }

  it('accepts a body whose fake-verification header matches its hash', async () => {
    const rawBody = JSON.stringify({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'item-fake',
    });

    const event = await provider().verifyAndParseWebhook(rawBody, {
      'fake-verification': bodyHashHex(rawBody),
    });

    expect(event).toEqual({
      type: 'TRANSACTIONS',
      code: 'SYNC_UPDATES_AVAILABLE',
      itemId: 'item-fake',
      bodyHash: bodyHashHex(rawBody),
      payload: {
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'item-fake',
      },
    });
  });

  it('reads the header case-insensitively', async () => {
    const rawBody = JSON.stringify({ webhook_type: 'ITEM' });

    const event = await provider().verifyAndParseWebhook(rawBody, {
      'Fake-Verification': bodyHashHex(rawBody),
    });

    expect(event.type).toBe('ITEM');
  });

  it('defaults code and itemId to null when the body omits them', async () => {
    const rawBody = JSON.stringify({ webhook_type: 'ITEM' });

    const event = await provider().verifyAndParseWebhook(rawBody, {
      'fake-verification': bodyHashHex(rawBody),
    });

    expect(event.code).toBeNull();
    expect(event.itemId).toBeNull();
  });

  it('rejects a header that does not match the body', async () => {
    const rawBody = JSON.stringify({ webhook_type: 'TRANSACTIONS' });

    await expect(
      provider().verifyAndParseWebhook(rawBody, { 'fake-verification': 'not-the-hash' })
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('rejects a missing header', async () => {
    await expect(provider().verifyAndParseWebhook('{}', {})).rejects.toBeInstanceOf(
      WebhookVerificationError
    );
  });

  it('rejects a header valid for a different body than the one that arrived', async () => {
    const signedFor = JSON.stringify({ webhook_type: 'TRANSACTIONS' });
    const actual = JSON.stringify({ webhook_type: 'ITEM' });

    await expect(
      provider().verifyAndParseWebhook(actual, { 'fake-verification': bodyHashHex(signedFor) })
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe('the copy of the public token the browser carries', () => {
  it('is the same string the fake will exchange', () => {
    // `ConnectBankButton` cannot import this file - it is server code, and it
    // would arrive in the browser bundle with the connectors package behind
    // it - so it carries the literal. This is what keeps the two the same.
    expect(SCRIPTED_PUBLIC_TOKEN).toBe(FAKE_PUBLIC_TOKEN);
  });
});

describe('the production guard', () => {
  it('refuses to be constructed in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => new FakeBankProvider(defaultFakeScript())).toThrow(
      FakeBankProviderInProductionError
    );
  });

  it('refuses even when handed an environment that does not admit to it', () => {
    // The guard is supposed to be a check on the *runtime*, independent of the
    // environment check in `assertProductionSecurity` - and a guard that only
    // reads the object it was passed is not that: any caller with its own
    // `raw` walks straight past it. So it asks both, and either one saying
    // production is enough.
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => new FakeBankProvider(defaultFakeScript(), { NODE_ENV: 'development' })).toThrow(
      FakeBankProviderInProductionError
    );
  });

  it('refuses when the environment it was handed says production', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(() => new FakeBankProvider(defaultFakeScript(), { NODE_ENV: 'production' })).toThrow(
      FakeBankProviderInProductionError
    );
  });

  it('is constructible everywhere else', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(() => new FakeBankProvider(defaultFakeScript())).not.toThrow();
  });
});

describe('getBankProviderKind', () => {
  it.each([
    ['the E2E door is open', { E2E: '1' }, 'fake'],
    [
      'the door is open and Plaid is configured too',
      { E2E: '1', PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' },
      'fake',
    ],
    ['Plaid has both credentials', { PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' }, 'plaid'],
    ['Plaid has only a client id', { PLAID_CLIENT_ID: 'id' }, null],
    ['Plaid has only a secret', { PLAID_SECRET: 'secret' }, null],
    ['nothing is configured', {}, null],
  ])('is %s -> %s', (_name, raw, expected) => {
    expect(getBankProviderKind(raw)).toBe(expected);
  });
});

describe('getBankProvider', () => {
  it('hands back the fake when the door is open', () => {
    expect(getBankProvider({ E2E: '1', NODE_ENV: 'test' })).toBeInstanceOf(FakeBankProvider);
  });

  it('hands back nothing at all when Plaid is not configured', () => {
    expect(getBankProvider({})).toBeNull();
  });

  it('builds the Plaid provider once for one environment', () => {
    const raw = { PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret', PLAID_ENV: 'production' };

    const first = getBankProvider(raw);
    expect(first).not.toBeNull();
    expect(first?.id).toBe('plaid');
    expect(getBankProvider(raw)).toBe(first);
  });

  it('never serves a client it built for a different environment', () => {
    // The cache is keyed on the environment it was handed, so it can only ever
    // return the client that environment produced. Deliberately not keyed on
    // the credentials themselves: a module-level map of secrets is a thing to
    // avoid having, and the application only ever passes `process.env`.
    const sandbox = getBankProvider({
      PLAID_CLIENT_ID: 'id',
      PLAID_SECRET: 's',
      PLAID_ENV: 'sandbox',
    });
    const live = getBankProvider({
      PLAID_CLIENT_ID: 'id',
      PLAID_SECRET: 's',
      PLAID_ENV: 'production',
    });

    expect(sandbox).not.toBe(live);
  });

  /**
   * The door is already impossible to open in production - the boot assertion
   * refuses `E2E` there. This is the second, independent guard: even a runtime
   * that somehow got past the assertion cannot assemble the scripted bank.
   */
  it('cannot hand back the fake in production, even with the door propped open', () => {
    expect(() => getBankProvider({ E2E: '1', NODE_ENV: 'production' })).toThrow(
      FakeBankProviderInProductionError
    );
  });
});
