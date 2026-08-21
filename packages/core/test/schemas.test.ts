import { describe, expect, it } from 'vitest';
import {
  CsvRowSchema,
  InvoiceInput,
  LaborEntryInput,
  ProjectInput,
  TransactionInput,
} from '../src/schemas';
import {
  SEED_INVOICES,
  SEED_LABOR,
  SEED_PROJECTS,
  SEED_TRANSACTIONS,
} from './fixtures';

/** Everything persistence adds, which the input schemas do not describe. */
const withoutPersistedFields = <T extends object>(entity: T) => {
  const { id, createdAt, updatedAt, ...input } = entity as T & {
    id: string;
    createdAt: string;
    updatedAt?: string;
  };
  return input;
};

describe('input schemas', () => {
  // The entity types are z.infer of these schemas, so a fixture that fails to
  // parse means the type and the validation have drifted apart.
  it.each([
    ['ProjectInput', ProjectInput, SEED_PROJECTS],
    ['TransactionInput', TransactionInput, SEED_TRANSACTIONS],
    ['LaborEntryInput', LaborEntryInput, SEED_LABOR],
    ['InvoiceInput', InvoiceInput, SEED_INVOICES],
  ] as const)('%s accepts every seed record', (_name, schema, records) => {
    for (const record of records) {
      expect(schema.safeParse(withoutPersistedFields(record)).success).toBe(true);
    }
  });

  it('rejects a project whose money is not whole cents', () => {
    const input = withoutPersistedFields(SEED_PROJECTS[0]);
    const result = ProjectInput.safeParse({ ...input, quotedTotalCents: 6800.5 });
    expect(result.success).toBe(false);
  });

  it('rejects a transaction with an unknown category', () => {
    const input = withoutPersistedFields(SEED_TRANSACTIONS[0]);
    const result = TransactionInput.safeParse({ ...input, category: 'entertainment' });
    expect(result.success).toBe(false);
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    const input = withoutPersistedFields(SEED_INVOICES[0]);
    const result = InvoiceInput.safeParse({ ...input, dueDate: '08/19/2026' });
    expect(result.success).toBe(false);
  });
});

describe('CsvRowSchema', () => {
  it('converts the bank’s decimal string into cents', () => {
    const row = CsvRowSchema.parse({
      date: '2026-08-18',
      description: 'THE HOME DEPOT #0421',
      amount: '114.75',
    });
    expect(row).toEqual({
      date: '2026-08-18',
      description: 'THE HOME DEPOT #0421',
      amount: 11_475,
    });
  });

  it.each(['1,234.56', '$12.30', '-5'])('accepts the bank writing %s', (amount) => {
    const result = CsvRowSchema.safeParse({
      date: '2026-08-18',
      description: 'A VENDOR',
      amount,
    });
    expect(result.success).toBe(true);
  });

  it.each(['', 'n/a', '12.3.4'])('rejects %s as an amount', (amount) => {
    const result = CsvRowSchema.safeParse({
      date: '2026-08-18',
      description: 'A VENDOR',
      amount,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a row with no description', () => {
    const result = CsvRowSchema.safeParse({
      date: '2026-08-18',
      description: '   ',
      amount: '10.00',
    });
    expect(result.success).toBe(false);
  });
});
