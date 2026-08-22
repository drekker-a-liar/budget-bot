import { createHash } from 'node:crypto';
import type {
  BankProvider,
  CreateLinkTokenArgs,
  ExchangedItem,
  LinkToken,
  NormalizedAccount,
  NormalizedTransaction,
  SyncResult,
  WebhookEvent,
} from '@budget-bot/bank-connectors';
import { WebhookVerificationError } from '@budget-bot/bank-connectors';
import type { Cents } from '@budget-bot/core';
import type { RawEnv } from '@/src/env';

/** The header the fake signs a webhook envelope with (mirrors Plaid's own). */
const FAKE_WEBHOOK_HEADER = 'fake-verification';

/** A header, found by name without regard to case - Plaid's is the same. */
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
 * A bank that does what the script says.
 *
 * Everything above the `BankProvider` interface - the sync service, the
 * actions, the connections screen, the Playwright journey - can be exercised
 * end to end with no Plaid account, no credentials and no network, because
 * this satisfies the same interface `PlaidProvider` does.
 *
 * It is deliberately a *faithful* provider rather than a stub. It pages: the
 * cursor it hands back is the only way to get the next page, and a cursor it
 * never issued is refused. It refuses an access token it did not mint, which
 * is what makes the sync tests prove that `withAccessToken` really decrypted
 * something - a fake that accepted any string would let a sync service pass
 * its whole suite while decrypting nothing. And it can be told to fail a
 * particular page with a particular error, which is how the restart, the rate
 * limit and the re-auth paths get tested at all.
 *
 * ## Where it may not exist
 *
 * It is selectable only behind the `E2E=1` door (`provider.ts`), which cannot
 * open in production: `assertProductionSecurity` refuses to boot a production
 * deployment with `E2E` set. That is guard one, and it is Phase 1's. Guard two
 * is the constructor below, which throws when `NODE_ENV` is production - the
 * same pair `e2eCredentialsProvider` carries, and independent of it in the
 * same way: one is a check on the environment, the other on the runtime, and
 * the ways of defeating either are not ways of defeating both.
 */

/** The token the fake mints, and the only one it will answer to. */
export const FAKE_ACCESS_TOKEN = 'access-fake';
/** The public token the fake's Link flow "returns", and the only one it exchanges. */
export const FAKE_PUBLIC_TOKEN = 'public-fake';
export const FAKE_LINK_TOKEN = 'link-fake';
export const FAKE_ITEM_ID = 'item-fake';
export const FAKE_INSTITUTION_ID = 'ins_fake';
/** Named so that a screenshot of a test run cannot be mistaken for a real bank. */
export const FAKE_INSTITUTION_NAME = 'Fake Bank (E2E)';

/** Link tokens are short-lived; half an hour is roughly Plaid's own window. */
const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface FakeBankScript {
  accounts: NormalizedAccount[];
  /**
   * The pages, in order. Each one's `nextCursor` is what a caller has to send
   * back to be given the one after it, so the chain is the script's to define
   * - `defaultFakeScript` uses `fake-1`, `fake-2`, ... and a test that wants
   * different cursors just writes different ones.
   */
  pages: SyncResult[];
  /**
   * Fail the page at `index` with `error`, `times` times (forever by default).
   *
   * `times` is what makes the restart paths testable: a
   * `PlaidMutationDuringPagination` that failed for ever would only ever prove
   * that `runSync` gives up, never that it comes back and succeeds from the
   * cursor it last committed.
   */
  failAtPage?: { index: number; error: Error; times?: number };
}

/** Guard 2. Thrown, not returned: there is no sensible way to carry on. */
export class FakeBankProviderInProductionError extends Error {
  constructor() {
    super(
      'Refusing to build the scripted bank provider: NODE_ENV is production. ' +
        'It invents transactions and exists only for the test suites. Unset E2E.'
    );
    this.name = 'FakeBankProviderInProductionError';
  }
}

export class FakeBankProvider implements BankProvider {
  /** `plaid`, because it stands in for Plaid everywhere the application looks. */
  readonly id = 'plaid' as const;

  /** Every cursor it has been asked for, in order. For assertions. */
  readonly cursorsRequested: Array<string | null> = [];

  readonly #script: FakeBankScript;

  #failuresLeft: number;

  constructor(script: FakeBankScript, raw: RawEnv = process.env) {
    // Both, because either one saying production is enough. Reading only the
    // environment it was handed would make this a check on an *argument*
    // rather than on the runtime, and any caller with its own `raw` - which is
    // every test in this repository - would walk straight past it. The claim
    // above is that the two guards are independent; asking `process.env` as
    // well is what makes that true.
    if (raw.NODE_ENV === 'production' || process.env.NODE_ENV === 'production') {
      throw new FakeBankProviderInProductionError();
    }

    this.#script = script;
    this.#failuresLeft = script.failAtPage?.times ?? Number.POSITIVE_INFINITY;
  }

  /**
   * The token, checked. Not politeness: this is the assertion that whatever
   * the caller did to store and retrieve the token round-tripped.
   */
  #checkToken(accessToken: string): void {
    if (accessToken !== FAKE_ACCESS_TOKEN) {
      // Never the value: the habit of not putting a token in an error message
      // is worth keeping even where the token is a constant in this file.
      throw new Error('FakeBankProvider was given an access token it did not issue.');
    }
  }

  async createLinkToken(_args: CreateLinkTokenArgs): Promise<LinkToken> {
    return {
      linkToken: FAKE_LINK_TOKEN,
      expiration: new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString(),
    };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangedItem> {
    if (publicToken !== FAKE_PUBLIC_TOKEN) {
      throw new Error('FakeBankProvider was given a public token it did not issue.');
    }
    return {
      accessToken: FAKE_ACCESS_TOKEN,
      itemId: FAKE_ITEM_ID,
      institutionId: FAKE_INSTITUTION_ID,
      institutionName: FAKE_INSTITUTION_NAME,
    };
  }

  async getAccounts(accessToken: string): Promise<NormalizedAccount[]> {
    this.#checkToken(accessToken);
    return this.#script.accounts;
  }

  /**
   * The page that follows `cursor`.
   *
   * A cursor is resolved by finding the page that handed it out, so the only
   * way to page forward is to have been given the previous page. An invented
   * cursor is refused rather than being read as "start again": a caller that
   * has lost its place would otherwise silently replay the entire history.
   */
  async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncResult> {
    this.#checkToken(accessToken);
    this.cursorsRequested.push(cursor);

    const index = this.#indexFor(cursor);
    const failAt = this.#script.failAtPage;
    if (failAt && failAt.index === index && this.#failuresLeft > 0) {
      this.#failuresLeft -= 1;
      throw failAt.error;
    }

    const page = this.#script.pages[index];
    if (page) return page;

    // Past the end: the caller is up to date. `nextCursor` is the one it sent,
    // so asking again is still a valid request rather than a restart.
    return { added: [], modified: [], removed: [], nextCursor: cursor, hasMore: false };
  }

  #indexFor(cursor: string | null): number {
    if (cursor === null) return 0;
    const previous = this.#script.pages.findIndex((page) => page.nextCursor === cursor);
    if (previous === -1) {
      throw new Error(`FakeBankProvider was given a cursor no page issued: ${cursor}`);
    }
    return previous + 1;
  }

  async removeItem(accessToken: string): Promise<void> {
    this.#checkToken(accessToken);
  }

  /**
   * The E2E door's stand-in for Plaid's signature (spec §2): no JWT, no key
   * server, just a header that has to equal `sha256(rawBody)` hex. It exists
   * so the e2e journey can drive the webhook -> sync path with no Plaid
   * account behind it, while still exercising the same shape of check -
   * reject unless the caller proves it has the exact bytes that were sent.
   */
  async verifyAndParseWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<WebhookEvent> {
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const provided = headerValue(headers, FAKE_WEBHOOK_HEADER);
    if (provided !== bodyHash) {
      throw new WebhookVerificationError('fake-verification header did not match the body');
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
}

/** `YYYY-MM-DD`, `days` before `from`, in UTC so a timezone cannot shift it. */
function dayBefore(from: Date, days: number): string {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function cents(value: number): Cents {
  return value as Cents;
}

/**
 * The script the application uses when the door is open.
 *
 * Two accounts, because one of the things worth proving end to end is that a
 * transaction lands against the right one; two pages, because a sync service
 * that only ever sees one page is not paging.
 *
 * Dates are relative to `today` rather than frozen into the file: a fixture
 * dated to the week it was written stops appearing in "this week" the moment
 * the week turns over, and an end-to-end test that silently stops seeing its
 * own data is worse than no test. Pass a day to get an identical script back
 * every time.
 */
export function defaultFakeScript(today: Date = new Date()): FakeBankScript {
  const checking: NormalizedAccount = {
    externalId: 'fake-checking',
    name: 'Fake Business Checking',
    officialName: 'Fake Bank Business Interest Checking',
    mask: '0000',
    type: 'depository',
    subtype: 'checking',
    currentBalanceCents: cents(1298011),
    availableBalanceCents: cents(1245011),
    creditLimitCents: null,
    isoCurrencyCode: 'USD',
  };

  const credit: NormalizedAccount = {
    externalId: 'fake-credit',
    name: 'Fake Business Card',
    officialName: 'Fake Bank Business Rewards Card',
    mask: '4471',
    type: 'credit',
    subtype: 'credit card',
    currentBalanceCents: cents(264956),
    availableBalanceCents: cents(235044),
    creditLimitCents: cents(500000),
    isoCurrencyCode: 'USD',
  };

  /** A posted transaction, with the fields a page always fills in. */
  function posted(
    row: Pick<
      NormalizedTransaction,
      'externalId' | 'accountExternalId' | 'date' | 'amountCents' | 'rawDescriptor'
    > &
      Partial<NormalizedTransaction>
  ): NormalizedTransaction {
    return {
      postedAt: new Date(`${row.date}T17:00:00.000Z`),
      authorizedDate: null,
      merchantName: null,
      pending: false,
      pendingTransactionId: null,
      categoryHintPrimary: null,
      categoryHintDetailed: null,
      isoCurrencyCode: 'USD',
      ...row,
    };
  }

  return {
    accounts: [checking, credit],
    pages: [
      {
        added: [
          posted({
            externalId: 'fake-txn-1',
            accountExternalId: credit.externalId,
            date: dayBefore(today, 2),
            // Categorised on insert as `materials` - "hardware" is one of the
            // fallback keywords - which is what makes the inbox in the
            // end-to-end run show a filed-looking row rather than a blank one.
            amountCents: cents(11475),
            rawDescriptor: 'FAKE HARDWARE 4471',
            merchantName: 'Fake Hardware Supply',
            categoryHintPrimary: 'GENERAL_MERCHANDISE',
            categoryHintDetailed: 'GENERAL_MERCHANDISE_SUPERSTORES',
          }),
          posted({
            externalId: 'fake-txn-2',
            accountExternalId: checking.externalId,
            date: dayBefore(today, 1),
            amountCents: cents(6210),
            rawDescriptor: 'FAKE FUEL STOP 118',
            merchantName: 'Fake Fuel',
          }),
        ],
        modified: [],
        removed: [],
        nextCursor: 'fake-1',
        hasMore: true,
      },
      {
        added: [
          posted({
            externalId: 'fake-txn-3',
            accountExternalId: credit.externalId,
            date: dayBefore(today, 0),
            // Negative: money in. A card payment is real and is stored, and
            // the sync service files it as `ignored` rather than counting it
            // as an expense on top of the purchases it settles (ADR 0004).
            amountCents: cents(-50000),
            rawDescriptor: 'FAKE BANK CARD PAYMENT THANK YOU',
          }),
        ],
        modified: [],
        removed: [],
        nextCursor: 'fake-2',
        hasMore: false,
      },
    ],
  };
}
