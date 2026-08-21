import { createHash } from 'node:crypto';
import { CsvRowSchema, type Cents } from '@budget-bot/core';
import { NotSupportedError } from '../errors';
import type {
  BankProvider,
  CreateLinkTokenArgs,
  ExchangedItem,
  LinkToken,
  NormalizedAccount,
  NormalizedTransaction,
  SyncResult,
  WebhookEvent,
} from '../types';
import { readColumns, type CsvColumns } from './headers';
import { isBlank, readRecords, stripBom, type CsvRecord } from './records';

/**
 * A bank statement the user exported and uploaded.
 *
 * This is the one provider that is not a live connection: a file arrives, it
 * is read, and that is the end of it. It satisfies `BankProvider` anyway so
 * that the application above is written against one contract, and refuses the
 * methods a file cannot answer rather than pretending to.
 *
 * The sign convention is the interface's: **positive is money out**. An
 * `Amount` column is taken at face value; a `Debit`/`Credit` pair puts debits
 * out and credits in. Negatives survive: the caller files them as `ignored`
 * rather than counting a card payment as an expense.
 */

export interface CsvParseOptions {
  /**
   * The account these rows belong to, as part of their identity. There is no
   * linked bank account behind a file upload yet, so the caller passes a
   * constant; the field exists because `externalId` has to be scoped to
   * something, and because a real account id belongs here once one exists.
   */
  accountExternalId: string;
}

export interface CsvRowError {
  /** 1-based line in the uploaded file, so the user can go and look at it. */
  line: number;
  reason: string;
}

export interface CsvParseResult {
  rows: NormalizedTransaction[];
  errors: CsvRowError[];
}

class EmptyCsvError extends Error {
  constructor() {
    super('This file is empty: there is no header row and no transactions in it.');
    this.name = 'EmptyCsvError';
  }
}

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`).join('; ');
}

function cell(fields: string[], index: number | null): string {
  if (index === null) return '';
  return (fields[index] ?? '').trim();
}

/**
 * Which text carries the amount, and what its column says about direction.
 *
 * A single `Amount` column is signed by the bank and is taken at face value.
 * A `Debit`/`Credit` pair is not: the *column* is the statement of direction,
 * and banks disagree about whether to sign the number inside it as well. Some
 * write `Credit 500.00`, some `Credit -500.00`, some `Credit (500.00)`, and
 * all three mean the same $500 coming in. So the magnitude is taken from the
 * cell and the sign from the column it was in - negating whatever was written
 * would turn a signed export inside out and file every card payment as a
 * purchase.
 */
type AmountSource = 'amount' | 'debit' | 'credit';

function amountTextFor(
  columns: CsvColumns,
  fields: string[]
): { text: string; source: AmountSource } {
  const amount = cell(fields, columns.amount);
  if (amount !== '') return { text: amount, source: 'amount' };

  const debit = cell(fields, columns.debit);
  if (debit !== '') return { text: debit, source: 'debit' };

  return { text: cell(fields, columns.credit), source: 'credit' };
}

/** Positive is money out (spec §8), given where the number came from. */
function signedCents(parsed: Cents, source: AmountSource): Cents {
  if (source === 'amount') return parsed;
  const magnitude = Math.abs(parsed);
  return (source === 'credit' ? -magnitude : magnitude) as Cents;
}

const PENDING_WORDS = ['pending', 'authorized', 'authorised', 'processing', 'true', 'yes'];

function isPending(columns: CsvColumns, fields: string[]): boolean {
  return PENDING_WORDS.includes(cell(fields, columns.status).toLowerCase());
}

/**
 * A file has no transaction ids, so identity is derived from the fields that
 * together make a charge what it is. Two statements that overlap therefore
 * agree about a row they both contain, which is what makes the import
 * repeatable.
 */
function externalIdFor(
  date: string,
  amountCents: Cents,
  rawDescriptor: string,
  accountExternalId: string
): string {
  return createHash('sha256')
    .update(`${date}|${amountCents}|${rawDescriptor}|${accountExternalId}`)
    .digest('hex');
}

function parseCsv(text: string, options: CsvParseOptions): CsvParseResult {
  const records = readRecords(stripBom(text)).filter((record) => !isBlank(record));
  const [header, ...dataRows] = records;
  if (!header) throw new EmptyCsvError();

  const columns = readColumns(header.fields);
  const rows: NormalizedTransaction[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();

  for (const record of dataRows) {
    const error = readRow(record, columns, options, rows, seen);
    if (error) errors.push(error);
  }

  return { rows, errors };
}

/** One data row: validated, normalised, and appended - or explained. */
function readRow(
  record: CsvRecord,
  columns: CsvColumns,
  options: CsvParseOptions,
  rows: NormalizedTransaction[],
  seen: Set<string>
): CsvRowError | null {
  const amount = amountTextFor(columns, record.fields);

  // One row's worth of validation, in the domain (ADR 0007): this is the
  // import boundary, so `parseMoney` runs inside the schema and nothing
  // downstream sees a decimal string again.
  const parsed = CsvRowSchema.safeParse({
    date: cell(record.fields, columns.date),
    description: cell(record.fields, columns.description),
    amount: amount.text,
  });

  if (!parsed.success) {
    return { line: record.line, reason: describeIssues(parsed.error.issues) };
  }

  const amountCents = signedCents(parsed.data.amount, amount.source);

  if (amountCents === 0) {
    return { line: record.line, reason: 'amount: the amount is zero' };
  }

  const rawDescriptor = parsed.data.description;
  const externalId = externalIdFor(
    parsed.data.date,
    amountCents,
    rawDescriptor,
    options.accountExternalId
  );

  // A file that repeats a row - overlapping statements, or a month exported
  // twice into one export - is describing one charge, not two. Silently, and
  // not as an error: the user did nothing wrong.
  if (seen.has(externalId)) return null;
  seen.add(externalId);

  rows.push({
    externalId,
    accountExternalId: options.accountExternalId,
    date: parsed.data.date,
    // A file says none of this. Nulls rather than invented values, so that a
    // real feed filling them in later is visibly different from a file.
    postedAt: null,
    authorizedDate: null,
    amountCents,
    rawDescriptor,
    merchantName: null,
    pending: isPending(columns, record.fields),
    pendingTransactionId: null,
    categoryHintPrimary: null,
    categoryHintDetailed: null,
    isoCurrencyCode: null,
  });

  return null;
}

function refuse(operation: string): never {
  throw new NotSupportedError('CsvProvider', operation);
}

export const CsvProvider = {
  id: 'csv',

  parse(text: string, options: CsvParseOptions): CsvParseResult {
    return parseCsv(text, options);
  },

  // `async`, so the refusal arrives as a rejected promise rather than as a
  // synchronous throw. A caller written against the interface awaits these;
  // throwing before the promise exists would escape its try/catch.
  async createLinkToken(_args: CreateLinkTokenArgs): Promise<LinkToken> {
    return refuse('createLinkToken');
  },
  async exchangePublicToken(_publicToken: string): Promise<ExchangedItem> {
    return refuse('exchangePublicToken');
  },
  async getAccounts(_accessToken: string): Promise<NormalizedAccount[]> {
    return refuse('getAccounts');
  },
  async syncTransactions(_accessToken: string, _cursor: string | null): Promise<SyncResult> {
    return refuse('syncTransactions');
  },
  async removeItem(_accessToken: string): Promise<void> {
    return refuse('removeItem');
  },
  async verifyAndParseWebhook(
    _rawBody: string,
    _headers: Record<string, string>
  ): Promise<WebhookEvent> {
    return refuse('verifyAndParseWebhook');
  },
} satisfies BankProvider & {
  parse(text: string, options: CsvParseOptions): CsvParseResult;
};
