import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountsGetRequest,
  type AccountsGetResponse,
  type InstitutionsGetByIdRequest,
  type InstitutionsGetByIdResponse,
  type ItemGetRequest,
  type ItemGetResponse,
  type ItemPublicTokenExchangeRequest,
  type ItemPublicTokenExchangeResponse,
  type ItemRemoveRequest,
  type ItemRemoveResponse,
  type LinkTokenCreateRequest,
  type LinkTokenCreateResponse,
  type TransactionsSyncRequest,
  type TransactionsSyncResponse,
} from 'plaid';
import { NotSupportedError } from '../errors';
import type {
  BankProvider,
  CreateLinkTokenArgs,
  ExchangedItem,
  LinkToken,
  NormalizedAccount,
  SyncResult,
  WebhookEvent,
} from '../types';
import { toPlaidError } from './errors';
import { normalizeAccount, normalizeTransaction } from './normalize';

/**
 * A live bank connection, over Plaid's official SDK.
 *
 * The client is **injected**. Nothing in this file reads an environment
 * variable, opens a socket on import, or knows what a credential looks like -
 * `createPlaidClient` builds a real one for the application, and the tests
 * pass a fake returning fixtures. That is what makes a connector for a
 * credentialled API testable at all, and it is why the whole of this package's
 * Plaid coverage runs with no Plaid account behind it.
 *
 * The provider is otherwise the same kind of thing `CsvProvider` is: stateless,
 * ignorant of owners and storage, and responsible only for the translation
 * between one bank's wire format and `NormalizedTransaction`.
 */

/** How the application identifies itself in Plaid Link. */
const CLIENT_NAME = 'Budget Bot';

/**
 * Two years of history, requested up front.
 *
 * Plaid backfills asynchronously and the UI must not block Link completion on
 * it (ADR 0004), so asking for the maximum useful window costs nothing at link
 * time and saves a re-link later when someone wants last year's numbers.
 */
const DAYS_REQUESTED = 730;

/** One page. 500 is Plaid's maximum for `/transactions/sync`. */
const PAGE_SIZE = 500;

/**
 * What the SDK hands back, of which only `data` is ever read.
 *
 * The real type is axios's `AxiosResponse<T>`, but `axios` is only a
 * *transitive* dependency of `plaid` - importing it here would mean depending
 * on a package this one never declared. A real `PlaidApi` satisfies this shape
 * structurally, which is all the injection point needs.
 */
export interface PlaidResponse<T> {
  data: T;
}

/**
 * The part of `PlaidApi` this provider uses.
 *
 * Narrow on purpose: it is the list of Plaid endpoints the application is
 * allowed to reach, it is small enough to fake in a test without a mocking
 * framework, and a new endpoint cannot be called without being added here
 * first. `PlaidApi` itself is assignable to it.
 */
export interface PlaidClientLike {
  linkTokenCreate(request: LinkTokenCreateRequest): Promise<PlaidResponse<LinkTokenCreateResponse>>;
  itemPublicTokenExchange(
    request: ItemPublicTokenExchangeRequest
  ): Promise<PlaidResponse<ItemPublicTokenExchangeResponse>>;
  itemGet(request: ItemGetRequest): Promise<PlaidResponse<ItemGetResponse>>;
  institutionsGetById(
    request: InstitutionsGetByIdRequest
  ): Promise<PlaidResponse<InstitutionsGetByIdResponse>>;
  accountsGet(request: AccountsGetRequest): Promise<PlaidResponse<AccountsGetResponse>>;
  transactionsSync(
    request: TransactionsSyncRequest
  ): Promise<PlaidResponse<TransactionsSyncResponse>>;
  itemRemove(request: ItemRemoveRequest): Promise<PlaidResponse<ItemRemoveResponse>>;
}

export interface CreatePlaidClientOptions {
  clientId: string;
  secret: string;
  env: 'sandbox' | 'production';
}

/**
 * A real Plaid client for one environment.
 *
 * The credentials go in headers rather than in every request body: the SDK
 * accepts either, and a header is set once here instead of being threaded
 * through - and forgotten from - seven call sites.
 */
export function createPlaidClient({ clientId, secret, env }: CreatePlaidClientOptions): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    })
  );
}

export interface PlaidProviderDeps {
  client: PlaidClientLike;
}

export class PlaidProvider implements BankProvider {
  readonly id = 'plaid' as const;

  readonly #client: PlaidClientLike;

  constructor({ client }: PlaidProviderDeps) {
    this.#client = client;
  }

  /**
   * One SDK call, with its failure translated.
   *
   * Every call goes through here, so there is no path on which a raw axios
   * error - which carries the outgoing request body, and therefore the access
   * token - escapes this package.
   */
  async #call<T>(send: () => Promise<PlaidResponse<T>>): Promise<T> {
    try {
      return (await send()).data;
    } catch (cause) {
      throw toPlaidError(cause);
    }
  }

  async createLinkToken({
    userId,
    redirectUri,
    accessToken,
    webhookUrl,
  }: CreateLinkTokenArgs): Promise<LinkToken> {
    const request: LinkTokenCreateRequest = {
      client_name: CLIENT_NAME,
      language: 'en',
      country_codes: [CountryCode.Us],
      user: { client_user_id: userId },
    };

    if (accessToken === undefined) {
      request.products = [Products.Transactions];
      request.transactions = { days_requested: DAYS_REQUESTED };
    } else {
      // Update mode re-authorizes an item that already exists. Plaid refuses
      // the call outright if `products` is sent alongside `access_token`, so
      // the two shapes are exclusive rather than one being the other plus a
      // field.
      request.access_token = accessToken;
    }

    // Only when there is one: Plaid validates `redirect_uri` against the
    // allow-list on the client id, and an empty string is not a match for
    // "unset".
    if (redirectUri !== undefined) request.redirect_uri = redirectUri;
    if (webhookUrl !== undefined) request.webhook = webhookUrl;

    const response = await this.#call(() => this.#client.linkTokenCreate(request));
    return { linkToken: response.link_token, expiration: response.expiration };
  }

  /**
   * The public token, spent.
   *
   * A public token can be exchanged exactly once, so from the moment the
   * exchange succeeds the access token is the only copy in existence and the
   * caller has to get it in order to encrypt and store it. Everything after
   * the exchange is therefore best-effort: the institution's id and display
   * name are a nicety, and throwing over one would strand an item that is now
   * linked and unreachable.
   */
  async exchangePublicToken(publicToken: string): Promise<ExchangedItem> {
    const exchanged = await this.#call(() =>
      this.#client.itemPublicTokenExchange({ public_token: publicToken })
    );

    const item: ExchangedItem = {
      accessToken: exchanged.access_token,
      itemId: exchanged.item_id,
    };

    try {
      const { item: fetched } = await this.#call(() =>
        this.#client.itemGet({ access_token: exchanged.access_token })
      );
      const institutionId = fetched.institution_id;
      if (!institutionId) return item;

      item.institutionId = institutionId;

      const { institution } = await this.#call(() =>
        this.#client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        })
      );
      item.institutionName = institution.name;
    } catch {
      // Deliberately swallowed, and the only place in this file that swallows
      // anything: see the note above. The connection is saved without a name,
      // which the UI already has to cope with for a provider that has none.
    }

    return item;
  }

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    const { accounts } = await this.#call(() =>
      this.#client.accountsGet({ access_token: accessToken })
    );
    return accounts.map(normalizeAccount);
  }

  /**
   * Exactly one page.
   *
   * Paging is the caller's job, because the caller is the one that can commit
   * a cursor: `next_cursor` may only be persisted *after* the page it belongs
   * to has landed in the database (ADR 0004). A provider that looped until
   * `has_more` was false would hold pages in memory with nowhere to record how
   * far it got, and a failure halfway would lose all of them.
   */
  async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncResult> {
    const page = await this.#call(() =>
      this.#client.transactionsSync({
        access_token: accessToken,
        // `null` is this interface's "from the beginning"; Plaid's is an
        // absent field, and sending `null` is a validation error.
        cursor: cursor ?? undefined,
        count: PAGE_SIZE,
      })
    );

    return {
      added: page.added.map(normalizeTransaction),
      modified: page.modified.map(normalizeTransaction),
      // Only the ids come back for removals, which is all the caller needs to
      // find the rows: the merge rule works from `external_id`.
      removed: page.removed.map((removed) => removed.transaction_id),
      nextCursor: page.next_cursor,
      hasMore: page.has_more,
    };
  }

  async removeItem(accessToken: string): Promise<void> {
    await this.#call(() => this.#client.itemRemove({ access_token: accessToken }));
  }

  /**
   * Phase 3. `async` so the refusal arrives as a rejected promise: a caller
   * written against `BankProvider` awaits this, and a synchronous throw would
   * escape its try/catch.
   */
  async verifyAndParseWebhook(
    _rawBody: string,
    _headers: Record<string, string>
  ): Promise<WebhookEvent> {
    throw new NotSupportedError('PlaidProvider', 'verifyAndParseWebhook');
  }
}
