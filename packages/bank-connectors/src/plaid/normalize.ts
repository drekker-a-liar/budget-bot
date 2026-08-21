import { parseMoney, type Cents } from '@budget-bot/core';
import type { AccountBase, Transaction } from 'plaid';
import type { NormalizedAccount, NormalizedTransaction } from '../types';

/**
 * Plaid's wire shapes, in the two types the application stores.
 *
 * ## The sign is Plaid's
 *
 * Plaid writes **positive for money out** - a $114.75 purchase is `+114.75`,
 * a card payment and a refund are negative - which is exactly the convention
 * `NormalizedTransaction` documents and the `amount_cents` column repeats
 * (ADR 0004). So there is no sign handling here at all. That is the point:
 * every place a flip could be introduced is a place a card payment could end
 * up filed as an expense, and the only defence is that the code never touches
 * the sign and a test says so.
 *
 * ## Money goes through the string
 *
 * Plaid sends amounts as JSON numbers, and the obvious `Math.round(n * 100)`
 * is wrong on values banks really send: `114.75 * 100` is
 * `11474.999999999998` in binary floating point. `String(n)` prints the
 * shortest decimal that round-trips - which is the decimal Plaid serialised -
 * and `parseMoney` then does the base-10 arithmetic the domain already owns.
 */

/** A Plaid amount, or the absence of one. */
function toCents(amount: number | null | undefined): Cents | null {
  if (amount === null || amount === undefined) return null;
  return parseMoney(String(amount));
}

export function normalizeTransaction(t: Transaction): NormalizedTransaction {
  return {
    externalId: t.transaction_id,
    accountExternalId: t.account_id,
    date: t.date,
    // `datetime` is null while a charge is still authorizing and at
    // institutions that do not report a time at all, which is why the column
    // is nullable rather than defaulted to midnight.
    postedAt: t.datetime === null ? null : new Date(t.datetime),
    authorizedDate: t.authorized_date,
    amountCents: parseMoney(String(t.amount)),
    // The bank's own line, verbatim. `merchant_name` is Plaid's cleaned-up
    // reading of it and is kept separately, never in place of it.
    rawDescriptor: t.name,
    merchantName: t.merchant_name ?? null,
    pending: t.pending,
    pendingTransactionId: t.pending_transaction_id,
    categoryHintPrimary: t.personal_finance_category?.primary ?? null,
    categoryHintDetailed: t.personal_finance_category?.detailed ?? null,
    // `unofficial_currency_code` is deliberately not a fallback: it holds
    // things like cryptocurrency tickers, and this field promises ISO 4217.
    isoCurrencyCode: t.iso_currency_code,
  };
}

export function normalizeAccount(a: AccountBase): NormalizedAccount {
  return {
    externalId: a.account_id,
    name: a.name,
    officialName: a.official_name,
    // The last four digits and nothing more: no full account number reaches
    // this system from any provider, by design (spec §7).
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currentBalanceCents: toCents(a.balances.current),
    availableBalanceCents: toCents(a.balances.available),
    // Plaid reports `limit` only for accounts that have one, so a checking
    // account's null here means "no limit", not "unknown".
    creditLimitCents: toCents(a.balances.limit),
    isoCurrencyCode: a.balances.iso_currency_code,
  };
}
