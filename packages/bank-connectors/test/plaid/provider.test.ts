import type {
  AccountsGetResponse,
  InstitutionsGetByIdResponse,
  ItemGetResponse,
  ItemPublicTokenExchangeResponse,
  ItemRemoveResponse,
  LinkTokenCreateResponse,
  TransactionsSyncResponse,
} from 'plaid';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { NotSupportedError } from '../../src/errors';
import {
  PlaidItemError,
  PlaidMutationDuringPagination,
  PlaidRateLimited,
  PlaidRequestError,
} from '../../src/plaid/errors';
import { createPlaidClient, PlaidProvider, type PlaidClientLike } from '../../src/plaid/provider';
import accountsFixture from '../fixtures/plaid/accounts.json';
import errorItemLoginRequired from '../fixtures/plaid/error-item-login-required.json';
import errorMutation from '../fixtures/plaid/error-mutation.json';
import errorRateLimit from '../fixtures/plaid/error-rate-limit.json';
import exchangeFixture from '../fixtures/plaid/exchange.json';
import institutionFixture from '../fixtures/plaid/institution.json';
import itemFixture from '../fixtures/plaid/item.json';
import linkTokenFixture from '../fixtures/plaid/link-token.json';
import syncModifiedFixture from '../fixtures/plaid/sync-modified.json';
import syncPage1Fixture from '../fixtures/plaid/sync-page-1.json';
import syncPage2Fixture from '../fixtures/plaid/sync-page-2.json';
import syncPage3Fixture from '../fixtures/plaid/sync-page-3.json';
import syncPendingToPostedFixture from '../fixtures/plaid/sync-pending-to-posted.json';
import syncRemovedFixture from '../fixtures/plaid/sync-removed.json';

/**
 * `PlaidProvider` against hand-authored fixtures, with no network anywhere.
 *
 * The Plaid client is injected, so every one of these runs with no
 * credentials, no sandbox item and no clock. What is being tested is the
 * translation in both directions: the request Plaid is asked for, and the
 * `SyncResult` / `ExchangedItem` / error that comes back out.
 *
 * The error tests matter more than they look. A `/transactions/sync` caller
 * has to tell four situations apart - back off, restart from the last
 * committed cursor, ask the user to re-authenticate, or give up - and the only
 * thing carrying that distinction is which class was thrown.
 */

/**
 * A hand-authored fixture, read as the SDK type it stands for.
 *
 * This is the only cast in the Plaid tests. It exists because the SDK models
 * Plaid's string enums (`Products`, `CountryCode`, `AccountType`, ...) as
 * TypeScript `enum`s, and a JSON string is not assignable to an enum member
 * even when it is exactly that member's value - `resolveJsonModule` has no way
 * to know. The strings in `test/fixtures/plaid/*.json` are those values; this
 * says so once, in one place, rather than at every use.
 */
function fixture<T>(json: unknown): T {
  return json as T;
}

/** What the SDK hands back: an axios response, of which only `data` is read. */
function ok<T>(json: unknown): { data: T } {
  return { data: fixture<T>(json) };
}

type FakeClient = { [K in keyof PlaidClientLike]: Mock<PlaidClientLike[K]> };

function fakeClient(): FakeClient {
  return {
    linkTokenCreate: vi.fn(async () => ok<LinkTokenCreateResponse>(linkTokenFixture)),
    itemPublicTokenExchange: vi.fn(async () =>
      ok<ItemPublicTokenExchangeResponse>(exchangeFixture)
    ),
    itemGet: vi.fn(async () => ok<ItemGetResponse>(itemFixture)),
    institutionsGetById: vi.fn(async () =>
      ok<InstitutionsGetByIdResponse>(institutionFixture)
    ),
    accountsGet: vi.fn(async () => ok<AccountsGetResponse>(accountsFixture)),
    transactionsSync: vi.fn(async () => ok<TransactionsSyncResponse>(syncPage1Fixture)),
    itemRemove: vi.fn(async () => ok<ItemRemoveResponse>({ request_id: 'req-remove-1' })),
  };
}

/**
 * A failure in the shape it really arrives in.
 *
 * Axios rejects with an `Error` carrying the HTTP response on `.response` and
 * the outgoing request on `.config` - and the outgoing request body is where
 * the access token is. That is not incidental to these tests: it is the thing
 * the redaction test is guarding against, so the fake reproduces it faithfully
 * rather than handing the mapper a tidy body.
 */
function axiosError(response: unknown, accessToken = 'access-sandbox-abc'): Error {
  return Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    response,
    config: {
      url: 'https://sandbox.plaid.com/transactions/sync',
      data: JSON.stringify({ access_token: accessToken, count: 500 }),
    },
  });
}

function providerWith(client: FakeClient): PlaidProvider {
  return new PlaidProvider({ client });
}

describe('PlaidProvider', () => {
  it('is the plaid provider', () => {
    expect(providerWith(fakeClient()).id).toBe('plaid');
  });
});

describe('createLinkToken', () => {
  it('requests transactions with 730 days and the redirect uri', async () => {
    const client = fakeClient();
    await providerWith(client).createLinkToken({
      userId: 'u1',
      redirectUri: 'https://x/plaid/oauth-return',
    });

    expect(client.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { client_user_id: 'u1' },
        products: ['transactions'],
        transactions: { days_requested: 730 },
        redirect_uri: 'https://x/plaid/oauth-return',
        country_codes: ['US'],
        language: 'en',
      })
    );
  });

  it('returns the link token and its expiry', async () => {
    const client = fakeClient();
    await expect(providerWith(client).createLinkToken({ userId: 'u1' })).resolves.toEqual({
      linkToken: 'link-sandbox-9f2c1d64-0000-4a0b-9d55-1a2b3c4d5e6f',
      expiration: '2026-08-21T04:30:00Z',
    });
  });

  it('sends no webhook and no redirect uri when it was given neither', async () => {
    const client = fakeClient();
    await providerWith(client).createLinkToken({ userId: 'u1' });

    const request = client.linkTokenCreate.mock.calls[0][0];
    expect(request).not.toHaveProperty('webhook');
    expect(request).not.toHaveProperty('redirect_uri');
  });

  it('sends the webhook url when one is configured', async () => {
    const client = fakeClient();
    await providerWith(client).createLinkToken({
      userId: 'u1',
      webhookUrl: 'https://x/api/plaid/webhook',
    });

    expect(client.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ webhook: 'https://x/api/plaid/webhook' })
    );
  });

  it('drops products in update mode, which Plaid rejects them in', async () => {
    const client = fakeClient();
    await providerWith(client).createLinkToken({
      userId: 'u1',
      accessToken: 'access-sandbox-abc',
    });

    const request = client.linkTokenCreate.mock.calls[0][0];
    expect(request.access_token).toBe('access-sandbox-abc');
    expect(request).not.toHaveProperty('products');
    expect(request).not.toHaveProperty('transactions');
  });
});

describe('exchangePublicToken', () => {
  it('returns the token and item once on exchange, with the institution name', async () => {
    const client = fakeClient();

    await expect(providerWith(client).exchangePublicToken('public-sandbox-1')).resolves.toEqual({
      accessToken: 'access-sandbox-abc',
      itemId: 'item-1',
      institutionId: 'ins_127287',
      institutionName: 'Platypus OAuth Bank',
    });

    expect(client.itemPublicTokenExchange).toHaveBeenCalledWith({
      public_token: 'public-sandbox-1',
    });
    expect(client.institutionsGetById).toHaveBeenCalledWith({
      institution_id: 'ins_127287',
      country_codes: ['US'],
    });
  });

  it('still hands back the access token when the institution lookup fails', async () => {
    const client = fakeClient();
    client.institutionsGetById.mockRejectedValueOnce(axiosError(errorMutation));

    await expect(providerWith(client).exchangePublicToken('public-sandbox-1')).resolves.toEqual({
      accessToken: 'access-sandbox-abc',
      itemId: 'item-1',
      institutionId: 'ins_127287',
    });
  });

  it('still hands back the access token when the item lookup fails', async () => {
    const client = fakeClient();
    client.itemGet.mockRejectedValueOnce(axiosError(errorItemLoginRequired));

    await expect(providerWith(client).exchangePublicToken('public-sandbox-1')).resolves.toEqual({
      accessToken: 'access-sandbox-abc',
      itemId: 'item-1',
    });
  });

  it('fails when the exchange itself fails, because there is nothing to keep', async () => {
    const client = fakeClient();
    client.itemPublicTokenExchange.mockRejectedValueOnce(axiosError(errorItemLoginRequired));

    await expect(providerWith(client).exchangePublicToken('public-sandbox-1')).rejects.toBeInstanceOf(
      PlaidItemError
    );
  });
});

describe('getAccounts', () => {
  it('maps a credit card and a checking account, balances in cents', async () => {
    const accounts = await providerWith(fakeClient()).getAccounts('access-sandbox-abc');

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      externalId: 'acct-credit-1',
      mask: '3210',
      type: 'credit',
      subtype: 'credit card',
      currentBalanceCents: 264956,
      availableBalanceCents: 235044,
      creditLimitCents: 500000,
    });
    expect(accounts[1]).toMatchObject({
      externalId: 'acct-checking-1',
      type: 'depository',
      creditLimitCents: null,
    });
  });
});

describe('syncTransactions', () => {
  it('returns one sync page and its cursor', async () => {
    const client = fakeClient();
    const page = await providerWith(client).syncTransactions('access-sandbox-abc', null);

    expect(page.added).toHaveLength(3);
    expect(page.nextCursor).toBe('cursor-1');
    expect(page.hasMore).toBe(true);
    expect(client.transactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'access-sandbox-abc',
        cursor: undefined,
        count: 500,
      })
    );
  });

  it('sends the cursor it was given, and returns exactly one page', async () => {
    const client = fakeClient();
    client.transactionsSync.mockResolvedValueOnce(ok<TransactionsSyncResponse>(syncPage2Fixture));

    const page = await providerWith(client).syncTransactions('access-sandbox-abc', 'cursor-1');

    expect(client.transactionsSync).toHaveBeenCalledTimes(1);
    expect(client.transactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' })
    );
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.hasMore).toBe(true);
  });

  it('keeps Plaid sign through the page: purchases out, a payment in', async () => {
    const page = await providerWith(fakeClient()).syncTransactions('access-sandbox-abc', null);

    expect(page.added.map((t) => t.amountCents)).toEqual([11475, 6210, -50000]);
    expect(page.added[0]).toMatchObject({
      externalId: 'txn-1',
      rawDescriptor: 'HOME DEPOT #1234',
      merchantName: 'The Home Depot',
      categoryHintPrimary: 'GENERAL_MERCHANDISE',
      pending: false,
    });
  });

  it('reports the last page as the last page', async () => {
    const client = fakeClient();
    client.transactionsSync.mockResolvedValueOnce(ok<TransactionsSyncResponse>(syncPage3Fixture));

    const page = await providerWith(client).syncTransactions('access-sandbox-abc', 'cursor-2');

    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBe('cursor-3');
    expect(page.added).toHaveLength(1);
  });

  it('carries a restated transaction through as modified', async () => {
    const client = fakeClient();
    client.transactionsSync.mockResolvedValueOnce(ok<TransactionsSyncResponse>(syncModifiedFixture));

    const page = await providerWith(client).syncTransactions('access-sandbox-abc', 'cursor-3');

    expect(page.added).toEqual([]);
    expect(page.modified).toHaveLength(1);
    expect(page.modified[0]).toMatchObject({ externalId: 'txn-4', amountCents: 9107 });
  });

  it('reduces removed transactions to their ids', async () => {
    const client = fakeClient();
    client.transactionsSync.mockResolvedValueOnce(ok<TransactionsSyncResponse>(syncRemovedFixture));

    const page = await providerWith(client).syncTransactions('access-sandbox-abc', 'cursor-4');

    expect(page.removed).toEqual(['txn-2', 'txn-3']);
  });

  it('carries the pending link when a charge settles', async () => {
    const client = fakeClient();
    client.transactionsSync.mockResolvedValueOnce(
      ok<TransactionsSyncResponse>(syncPendingToPostedFixture)
    );

    const page = await providerWith(client).syncTransactions('access-sandbox-abc', 'cursor-5');

    expect(page.added[0]).toMatchObject({
      externalId: 'txn-7',
      pendingTransactionId: 'txn-pending-1',
      pending: false,
      amountCents: 21419,
    });
    expect(page.removed).toEqual(['txn-pending-1']);
  });
});

describe('error mapping', () => {
  async function failWith(response: unknown, accessToken = 'access-sandbox-abc'): Promise<unknown> {
    const client = fakeClient();
    client.transactionsSync.mockRejectedValueOnce(axiosError(response, accessToken));
    return providerWith(client)
      .syncTransactions(accessToken, 'c')
      .catch((error: unknown) => error);
  }

  it('maps a 429 to PlaidRateLimited with the retry hint', async () => {
    const error = await failWith(errorRateLimit);

    expect(error).toBeInstanceOf(PlaidRateLimited);
    expect((error as PlaidRateLimited).retryAfterSeconds).toBe(12);
  });

  it('maps TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', async () => {
    expect(await failWith(errorMutation)).toBeInstanceOf(PlaidMutationDuringPagination);
  });

  it('maps ITEM_LOGIN_REQUIRED to PlaidItemError', async () => {
    const error = await failWith(errorItemLoginRequired);

    expect(error).toBeInstanceOf(PlaidItemError);
    expect((error as PlaidItemError).code).toBe('ITEM_LOGIN_REQUIRED');
  });

  it('maps anything else to PlaidRequestError, keeping the request id', async () => {
    const error = await failWith({
      status: 400,
      headers: {},
      data: {
        error_type: 'INVALID_REQUEST',
        error_code: 'INVALID_FIELD',
        error_message: 'count must be an integer',
        display_message: null,
        request_id: 'req-oops',
      },
    });

    expect(error).toBeInstanceOf(PlaidRequestError);
    expect(error).toMatchObject({ code: 'INVALID_FIELD', requestId: 'req-oops' });
  });

  it('never puts the access token in an error message', async () => {
    const error = (await failWith(errorItemLoginRequired, 'access-sandbox-SECRET')) as Error;

    expect(String(error.message)).not.toContain('SECRET');
    expect(JSON.stringify(error)).not.toContain('SECRET');
    expect(JSON.stringify(error.cause ?? null)).not.toContain('SECRET');
  });

  it('reports a failure that is not a Plaid response at all', async () => {
    const client = fakeClient();
    client.transactionsSync.mockRejectedValueOnce(new Error('socket hang up'));

    const error = await providerWith(client)
      .syncTransactions('access-sandbox-abc', 'c')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlaidRequestError);
    expect((error as PlaidRequestError).code).toBe('UNKNOWN');
  });
});

describe('removeItem', () => {
  it('asks Plaid to forget the item', async () => {
    const client = fakeClient();
    await providerWith(client).removeItem('access-sandbox-abc');

    expect(client.itemRemove).toHaveBeenCalledWith({ access_token: 'access-sandbox-abc' });
  });
});

describe('verifyAndParseWebhook', () => {
  it('is not supported yet', async () => {
    await expect(providerWith(fakeClient()).verifyAndParseWebhook('{}', {})).rejects.toBeInstanceOf(
      NotSupportedError
    );
  });
});

describe('createPlaidClient', () => {
  it('builds a client for an environment without reaching for it', () => {
    const client: PlaidClientLike = createPlaidClient({
      clientId: 'test-client-id',
      secret: 'test-secret',
      env: 'sandbox',
    });

    expect(typeof client.transactionsSync).toBe('function');
  });
});
