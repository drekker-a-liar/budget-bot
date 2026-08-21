import { describe, expectTypeOf, it } from 'vitest';
import type { ExpenseTransaction } from '../src/types';

/**
 * Type-level only: pins the field set `ExpenseTransaction` carries now that a
 * bank feed's columns sit alongside what the form sends (`TransactionInput`)
 * and what persistence adds (`Persisted`). A field added or removed here
 * without a matching change to `types.ts` fails typecheck, not a runtime
 * assertion.
 */
describe('ExpenseTransaction', () => {
  it('has exactly the form fields, the persisted fields, and the bank columns', () => {
    expectTypeOf<keyof ExpenseTransaction>().toEqualTypeOf<
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'date'
      | 'description'
      | 'vendor'
      | 'amountCents'
      | 'category'
      | 'paymentMethod'
      | 'cardLast4'
      | 'status'
      | 'projectId'
      | 'receiptNumber'
      | 'taxDeductible'
      | 'notes'
      | 'postedAt'
      | 'pending'
      | 'source'
      | 'provider'
      | 'externalId'
      | 'bankAccountId'
      | 'removedAt'
      | 'userEditedAt'
    >();
  });

  it('types the bank columns exactly as a synced row reports them', () => {
    expectTypeOf<ExpenseTransaction>().toMatchTypeOf<{
      postedAt: string | null;
      pending: boolean;
      source: 'manual' | 'csv' | 'plaid';
      provider: string | null;
      externalId: string | null;
      bankAccountId: string | null;
      removedAt: string | null;
      userEditedAt: string | null;
    }>();
  });

  it('defaults the bank columns to "manual, not pending, nothing else known" for a hand-entered row', () => {
    // Not a type assertion: the default *values* a manual row gets are
    // exercised at runtime in packages/db/test/repos/transactions.test.ts,
    // where a row actually gets created. This just pins that the type allows
    // the values that default represents.
    const manual: Pick<
      ExpenseTransaction,
      'source' | 'pending' | 'postedAt' | 'provider' | 'externalId' | 'bankAccountId' | 'removedAt' | 'userEditedAt'
    > = {
      source: 'manual',
      pending: false,
      postedAt: null,
      provider: null,
      externalId: null,
      bankAccountId: null,
      removedAt: null,
      userEditedAt: null,
    };
    expectTypeOf(manual.source).toEqualTypeOf<'manual' | 'csv' | 'plaid'>();
  });
});
