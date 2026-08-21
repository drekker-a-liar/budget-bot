import { expect, it } from 'vitest';
import {
  ConnectionNotFoundError,
  UnknownProjectError,
  withSyncLock,
  type BankAccount,
  type BankAccountInput,
  type BankConnection,
  type BankTransactionRow,
  type NewBankConnection,
  type SyncFailure,
  type SyncLockResult,
  type SyncOutcome,
  type TransactionUpdate,
} from '@budget-bot/db';
import type { TokenKeyring } from '@budget-bot/db/crypto';
import { runMigrations } from '@budget-bot/db/migrate';

/**
 * The surface `apps/web` builds its sync service against.
 *
 * Every name below is reachable from the package entry, not from a deep path
 * into `src/repos/…` - there is no such path, because the package only exports
 * `.`, `./schema`, `./crypto` and `./seed`. A repository function whose
 * parameter type stays unexported is one a caller cannot write a signature
 * for, and `BankTransactionRow` had exactly that problem: three functions took
 * it and nothing outside this package could name it.
 *
 * It is a test rather than a comment because `tsc` is the thing that has to
 * notice. The imports above fail typecheck the moment a name leaves
 * `src/repos/index.ts`; the assertions below cover the two that also have to
 * exist at runtime, which a type-only import would let through.
 */

/** Compiles only while `T` is exported and usable in a position like this. */
type Names<T> = (value: T) => void;

it('exports the value half of the surface, not just its types', () => {
  expect(typeof withSyncLock).toBe('function');
  expect(new ConnectionNotFoundError()).toBeInstanceOf(Error);
  expect(new UnknownProjectError()).toBeInstanceOf(Error);
});

it('exports every type a caller needs to write a signature', () => {
  // Nothing runs here that could fail at runtime - the assertion is that the
  // file compiled at all. Listed one per line so a removal names itself.
  const surface: [
    Names<BankConnection>,
    Names<BankAccount>,
    Names<BankAccountInput>,
    Names<NewBankConnection>,
    Names<BankTransactionRow>,
    Names<TransactionUpdate>,
    Names<SyncOutcome>,
    Names<SyncFailure>,
    Names<SyncLockResult<number>>,
    Names<TokenKeyring>,
  ] = [
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
  ];

  expect(surface).toHaveLength(10);
});

/**
 * `./migrate` is an entry point because `apps/web`'s sync suite needs a real
 * schema in a database of its own, and applying the committed migrations is
 * the only way schema changes ever reach one (spec §5). Reaching for
 * `drizzle-kit push` or a hand-rolled DDL in a test harness would mean the
 * tests ran against a schema nothing else does.
 */
it('exports the migrator, so an app can build a database to test against', () => {
  expect(typeof runMigrations).toBe('function');
});
