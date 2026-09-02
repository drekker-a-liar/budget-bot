import { createHash, timingSafeEqual } from 'node:crypto';
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
  type JWKPublicKey,
  type LinkTokenCreateRequest,
  type LinkTokenCreateResponse,
  type TransactionsSyncRequest,
  type TransactionsSyncResponse,
  type WebhookVerificationKeyGetRequest,
  type WebhookVerificationKeyGetResponse,
} from 'plaid';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
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
import { WebhookVerificationError } from './errors';
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

/** How old a webhook's `iat` may be before it is refused as stale (spec §2). */
const WEBHOOK_MAX_AGE_SECONDS = 300;

/**
 * How far into the future a webhook's `iat` may be before it is refused.
 *
 * "Within the last 5 minutes" is a window, not just a floor: a staleness
 * check that only bounds the past accepts an arbitrarily-future `iat`
 * forever, which is exactly the case a freshness check exists to catch (a
 * signing key that should still expire on a schedule). This allowance exists
 * only so a legitimately slow clock is not refused.
 */
const WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 30;

/** The header Plaid signs a webhook envelope with. */
const WEBHOOK_SIGNATURE_HEADER = 'plaid-verification';

/**
 * How long a fetched verification key is trusted before it is asked about
 * again. Keys rotate rarely, so this is not about freshness for its own sake:
 * it bounds how long a key Plaid has since retired can keep verifying
 * webhooks here, at a cost of one key fetch per hour per `kid`.
 */
const WEBHOOK_KEY_TTL_MS = 60 * 60 * 1000;

/**
 * A header, found by name without regard to case.
 *
 * `Record<string, string>` carries no promise about casing - a route handler
 * hands over whatever the framework gave it - so every lookup here goes
 * through this rather than through a literal key.
 */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
  webhookVerificationKeyGet(
    request: WebhookVerificationKeyGetRequest
  ): Promise<PlaidResponse<WebhookVerificationKeyGetResponse>>;
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

  /**
   * Verification keys rotate rarely, so a `kid` is worth remembering rather
   * than fetching on every webhook. It is remembered with the instant it was
   * fetched, not for ever: Plaid retires a key by setting `expired_at`, and a
   * cache with no expiry of its own would keep verifying with a key that was
   * retired one webhook after it was first seen - for the life of the process,
   * which is the window an attacker holding a leaked key would be working in.
   * `WEBHOOK_KEY_TTL_MS` bounds that window without paying a fetch per
   * webhook.
   */
  readonly #webhookKeys = new Map<string, { key: JWKPublicKey; fetchedAt: number }>();

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
      // Plaid answers an item with nothing to send with `next_cursor: ""`,
      // and sending that empty string back is a validation error. `null` is
      // this interface's "from the beginning", so the empty string becomes one
      // here rather than being committed as a cursor no request can use.
      nextCursor: page.next_cursor || null,
      hasMore: page.has_more,
    };
  }

  async removeItem(accessToken: string): Promise<void> {
    await this.#call(() => this.#client.itemRemove({ access_token: accessToken }));
  }

  /**
   * The signature Plaid puts on every webhook (spec §2): an ES256 JWT in the
   * `plaid-verification` header. `alg` is checked against the decoded - not
   * yet verified - header before anything else happens, so a request naming
   * `alg: none` or downgrading to HS256 dies without a key fetch or a
   * signature check ever running (a forged token could otherwise choose the
   * algorithm the rest of this method trusts). Past that: the key behind
   * `kid` comes from cache or from Plaid, the signature has to check out
   * against it, `iat` has to be within the last five minutes, and the
   * `request_body_sha256` claim has to match the bytes that actually
   * arrived, compared with `timingSafeEqual` so a mismatch cannot be
   * distinguished by timing.
   *
   * Every failure comes out as `WebhookVerificationError`, whose message
   * names the failure kind and nothing else - never the JWT, never the raw
   * body, never a claim.
   */
  async verifyAndParseWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<WebhookEvent> {
    const jwt = headerValue(headers, WEBHOOK_SIGNATURE_HEADER);
    if (jwt === undefined) {
      throw new WebhookVerificationError('missing verification header');
    }

    let alg: string | undefined;
    let kid: string | undefined;
    try {
      ({ alg, kid } = decodeProtectedHeader(jwt));
    } catch {
      throw new WebhookVerificationError('malformed jwt header');
    }

    if (alg !== 'ES256') {
      throw new WebhookVerificationError('unsupported signing algorithm');
    }
    if (kid === undefined) {
      throw new WebhookVerificationError('missing key id');
    }

    const jwk = await this.#webhookKey(kid);

    let iat: number | undefined;
    let requestBodySha256: unknown;
    try {
      const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, 'ES256');
      const { payload } = await jwtVerify(jwt, key, { algorithms: ['ES256'] });
      iat = payload.iat;
      requestBodySha256 = payload.request_body_sha256;
    } catch {
      throw new WebhookVerificationError('signature verification failed');
    }

    if (typeof iat !== 'number') {
      throw new WebhookVerificationError('missing iat');
    }
    const ageSeconds = Date.now() / 1000 - iat;
    if (ageSeconds > WEBHOOK_MAX_AGE_SECONDS) {
      throw new WebhookVerificationError('stale iat');
    }
    if (-ageSeconds > WEBHOOK_MAX_CLOCK_SKEW_SECONDS) {
      throw new WebhookVerificationError('iat in the future');
    }

    if (typeof requestBodySha256 !== 'string') {
      throw new WebhookVerificationError('missing body hash claim');
    }

    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const actual = Buffer.from(bodyHash, 'hex');
    const claimed = Buffer.from(requestBodySha256, 'hex');
    if (actual.length !== claimed.length || !timingSafeEqual(actual, claimed)) {
      throw new WebhookVerificationError('body hash mismatch');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError('invalid json body');
    }

    const body = isRecord(payload) ? payload : {};
    return {
      type: typeof body.webhook_type === 'string' ? body.webhook_type : '',
      code: typeof body.webhook_code === 'string' ? body.webhook_code : null,
      itemId: typeof body.item_id === 'string' ? body.item_id : null,
      bodyHash,
      payload,
    };
  }

  /**
   * The key behind `kid`: from cache when this instance fetched it recently,
   * from Plaid otherwise. A cache miss fetches exactly once - success or
   * failure - and only a success is cached, so an unrecognised or
   * momentarily-unreachable `kid` costs one fetch per webhook rather than
   * being remembered as a permanent failure.
   *
   * A cached entry older than the TTL is re-fetched rather than trusted: the
   * `expired_at` check below is the whole point of asking, and a key that was
   * live when it was cached is exactly the key Plaid retires next.
   */
  async #webhookKey(kid: string): Promise<JWKPublicKey> {
    const cached = this.#webhookKeys.get(kid);
    if (cached && Date.now() - cached.fetchedAt < WEBHOOK_KEY_TTL_MS) return cached.key;

    let key: JWKPublicKey;
    try {
      ({ key } = await this.#call(() => this.#client.webhookVerificationKeyGet({ key_id: kid })));
    } catch {
      throw new WebhookVerificationError('unknown key id');
    }

    // Plaid retires a signing key by setting `expired_at`; trusting one past
    // that is trusting whatever leaked with it. Not cached, either way: an
    // expiry recorded in error recovers on the next fetch rather than at the
    // next process restart (Phase 5 audit). The cached copy is dropped too, so
    // a key that expires while cached cannot be served from a stale entry.
    if (key.expired_at !== null && key.expired_at !== undefined) {
      this.#webhookKeys.delete(kid);
      throw new WebhookVerificationError('expired key');
    }

    this.#webhookKeys.set(kid, { key, fetchedAt: Date.now() });
    return key;
  }
}
