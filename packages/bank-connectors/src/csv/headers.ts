/**
 * Which column is which, across the exports real banks write.
 *
 * Every bank names the same three things differently and puts them in a
 * different order, so the columns are found by name rather than by position.
 * Matching folds case and collapses punctuation, because "Posted Date",
 * "posted_date" and "POSTED DATE" are the same column and a self-hoster
 * should not have to edit their statement to find that out.
 */

export interface CsvColumns {
  date: number;
  description: number;
  /** A single signed amount column. Absent when the bank splits debit/credit. */
  amount: number | null;
  /** Money out. */
  debit: number | null;
  /** Money in. */
  credit: number | null;
  /** Carries `pending` / `posted`, when the bank says. */
  status: number | null;
}

const ALIASES = {
  date: ['date', 'transactiondate', 'posteddate', 'postdate', 'postingdate', 'dateposted'],
  description: ['description', 'memo', 'payee', 'name', 'merchant', 'merchantname', 'details'],
  amount: ['amount', 'transactionamount', 'amountusd'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'moneyout'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'moneyin'],
  status: ['status', 'posted', 'transactionstatus', 'pending'],
} as const;

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(headers: string[], aliases: readonly string[]): number | null {
  const index = headers.findIndex((header) => aliases.includes(normalize(header)));
  return index === -1 ? null : index;
}

export class UnrecognisedCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnrecognisedCsvError';
  }
}

/**
 * Reads the header row, or explains what it could not find. A file whose
 * columns cannot be identified is not a file with bad rows in it - there is
 * nothing to import and nothing useful to report per row, so this throws
 * rather than returning a thousand identical errors.
 */
export function readColumns(headers: string[]): CsvColumns {
  const date = findColumn(headers, ALIASES.date);
  const description = findColumn(headers, ALIASES.description);
  const amount = findColumn(headers, ALIASES.amount);
  const debit = findColumn(headers, ALIASES.debit);
  const credit = findColumn(headers, ALIASES.credit);

  const missing: string[] = [];
  if (date === null) missing.push('a date column (Date, Transaction Date, Posted Date)');
  if (description === null) {
    missing.push('a description column (Description, Memo, Payee)');
  }
  if (amount === null && debit === null && credit === null) {
    missing.push('an amount column (Amount, or a Debit/Credit pair)');
  }

  if (date === null || description === null || missing.length > 0) {
    throw new UnrecognisedCsvError(
      `This file's header row is missing ${missing.join(', and ')}. ` +
        `Found: ${headers.map((h) => h.trim()).join(', ')}.`
    );
  }

  return { date, description, amount, debit, credit, status: findColumn(headers, ALIASES.status) };
}
