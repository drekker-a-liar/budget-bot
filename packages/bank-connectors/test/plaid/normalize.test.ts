import {
  AccountSubtype,
  AccountType,
  TransactionPaymentChannelEnum,
  type AccountBase,
  type Transaction,
} from 'plaid';
import { describe, expect, it } from 'vitest';
import { normalizeAccount, normalizeTransaction } from '../../src/plaid/normalize';

/**
 * Plaid's wire shapes, turned into the two types the application stores.
 *
 * Two things are being pinned down here, and they are the two that would be
 * expensive to get wrong quietly.
 *
 * **The sign.** Plaid already writes positive for money out, which is the
 * convention `NormalizedTransaction` documents and the one the database column
 * repeats (ADR 0004). So the correct amount of sign handling is *none*, and
 * the test that says so is the one that stops a well-meaning flip from being
 * added later.
 *
 * **The rounding.** Plaid sends amounts as JSON numbers. They go through
 * `parseMoney(String(amount))` rather than `Math.round(amount * 100)`, because
 * the second one is wrong on values a bank really sends: `114.75 * 100` is
 * `11474.999999999998` in binary floating point.
 */

const location: Transaction['location'] = {
  address: null,
  city: null,
  region: null,
  postal_code: null,
  country: null,
  lat: null,
  lon: null,
  store_number: null,
};

const paymentMeta: Transaction['payment_meta'] = {
  reference_number: null,
  ppd_id: null,
  payee: null,
  by_order_of: null,
  payer: null,
  payment_method: null,
  payment_processor: null,
  reason: null,
};

/** One Plaid transaction, with only the fields a test cares about spelled out. */
function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    account_id: 'acct-credit-1',
    account_owner: null,
    amount: 0,
    authorized_date: null,
    authorized_datetime: null,
    date: '2026-08-18',
    datetime: null,
    iso_currency_code: 'USD',
    location,
    merchant_name: null,
    name: 'A CHARGE',
    payment_channel: TransactionPaymentChannelEnum.Other,
    payment_meta: paymentMeta,
    pending: false,
    pending_transaction_id: null,
    transaction_code: null,
    transaction_id: 'txn-1',
    unofficial_currency_code: null,
    ...overrides,
  };
}

function acct(overrides: Partial<AccountBase> = {}): AccountBase {
  return {
    account_id: 'acct-credit-1',
    balances: {
      available: null,
      current: null,
      limit: null,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
    },
    mask: '3210',
    name: 'Platypus Business Card',
    official_name: 'Platypus Business Rewards Visa',
    type: AccountType.Credit,
    subtype: AccountSubtype.CreditCard,
    ...overrides,
  };
}

describe('normalizeTransaction', () => {
  it('keeps Plaid sign: a purchase is positive, a payment negative', () => {
    expect(normalizeTransaction(tx({ amount: 114.75 })).amountCents).toBe(11475);
    expect(normalizeTransaction(tx({ amount: -500 })).amountCents).toBe(-50000);
  });

  it.each([
    ['a value binary floating point cannot hold exactly', 114.75, 11475],
    ['a two-decimal value that ends in a zero', 62.1, 6210],
    ['a whole number of dollars', 342, 34200],
    ['a cent', 0.01, 1],
    ['zero', 0, 0],
    ['a large invoice', 18999.99, 1899999],
  ])('converts %s', (_label, amount, expected) => {
    expect(normalizeTransaction(tx({ amount })).amountCents).toBe(expected);
  });

  it('carries the pending link and the bank memo line', () => {
    const n = normalizeTransaction(
      tx({
        pending: false,
        pending_transaction_id: 'p-1',
        name: 'HOME DEPOT #1234',
        merchant_name: 'The Home Depot',
      })
    );
    expect(n).toMatchObject({
      pendingTransactionId: 'p-1',
      rawDescriptor: 'HOME DEPOT #1234',
      merchantName: 'The Home Depot',
      pending: false,
    });
  });

  it('maps personal_finance_category to hints', () => {
    const n = normalizeTransaction(
      tx({
        personal_finance_category: {
          primary: 'GENERAL_MERCHANDISE',
          detailed: 'GENERAL_MERCHANDISE_SUPERSTORES',
          confidence_level: 'VERY_HIGH',
        },
      })
    );
    expect(n.categoryHintPrimary).toBe('GENERAL_MERCHANDISE');
    expect(n.categoryHintDetailed).toBe('GENERAL_MERCHANDISE_SUPERSTORES');
  });

  it('leaves both hints null when Plaid has no guess', () => {
    const n = normalizeTransaction(tx({ personal_finance_category: null }));
    expect(n.categoryHintPrimary).toBeNull();
    expect(n.categoryHintDetailed).toBeNull();
  });

  it('reads identity and dates off the Plaid row', () => {
    const n = normalizeTransaction(
      tx({
        transaction_id: 'txn-1',
        account_id: 'acct-credit-1',
        date: '2026-08-18',
        datetime: '2026-08-18T14:02:11Z',
        authorized_date: '2026-08-17',
      })
    );
    expect(n).toMatchObject({
      externalId: 'txn-1',
      accountExternalId: 'acct-credit-1',
      date: '2026-08-18',
      authorizedDate: '2026-08-17',
    });
    expect(n.postedAt).toEqual(new Date('2026-08-18T14:02:11Z'));
  });

  it('has no posting time while a charge is still authorizing', () => {
    expect(normalizeTransaction(tx({ pending: true, datetime: null }))).toMatchObject({
      pending: true,
      postedAt: null,
    });
  });

  it('reports only a real ISO currency, not an unofficial one', () => {
    expect(normalizeTransaction(tx({ iso_currency_code: 'USD' })).isoCurrencyCode).toBe('USD');
    expect(
      normalizeTransaction(
        tx({ iso_currency_code: null, unofficial_currency_code: 'BRLX' })
      ).isoCurrencyCode
    ).toBeNull();
  });
});

describe('normalizeAccount', () => {
  it('converts balances and limit to cents, null when absent', () => {
    expect(
      normalizeAccount(
        acct({
          balances: {
            current: 1234.56,
            available: 765.44,
            limit: 5000,
            iso_currency_code: 'USD',
            unofficial_currency_code: null,
          },
        })
      )
    ).toMatchObject({
      currentBalanceCents: 123456,
      availableBalanceCents: 76544,
      creditLimitCents: 500000,
    });

    const noBalances = normalizeAccount(
      acct({
        balances: {
          current: null,
          available: null,
          limit: null,
          iso_currency_code: 'USD',
          unofficial_currency_code: null,
        },
      })
    );
    expect(noBalances.creditLimitCents).toBeNull();
    expect(noBalances.currentBalanceCents).toBeNull();
    expect(noBalances.availableBalanceCents).toBeNull();
  });

  it('carries identity, the mask and nothing more of the number', () => {
    expect(normalizeAccount(acct())).toMatchObject({
      externalId: 'acct-credit-1',
      name: 'Platypus Business Card',
      officialName: 'Platypus Business Rewards Visa',
      mask: '3210',
      type: 'credit',
      subtype: 'credit card',
      isoCurrencyCode: 'USD',
    });
  });

  it('accepts an account Plaid could not subtype', () => {
    expect(normalizeAccount(acct({ subtype: null })).subtype).toBeNull();
  });
});
