/**
 * Thrown by a provider asked for something its source cannot do.
 *
 * A CSV file is a one-way import: there is no token to exchange, no account
 * to list balances for, and nothing to sync from. `CsvProvider` still declares
 * those methods, because the point of the interface is that the application
 * above it is written once - so the honest answer to `syncTransactions` on a
 * file is a refusal that names itself, not a silent empty page.
 */
export class NotSupportedError extends Error {
  constructor(provider: string, operation: string) {
    super(`${provider} does not support ${operation}`);
    this.name = 'NotSupportedError';
  }
}
