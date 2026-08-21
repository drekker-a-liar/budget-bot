import { z } from 'zod';
import { parseMoney, type Cents } from './money';

/**
 * Zod input schemas for everything the user can create. Entity types in
 * types.ts are inferred from these, so validation and types cannot drift.
 */

/** Money crosses the wire and the database as a whole number of cents. */
const cents = z.number().int().transform((value): Cents => value as Cents);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const text = z.string();
const requiredText = z.string().trim().min(1);

function isParsableMoney(value: string): boolean {
  try {
    parseMoney(value);
    return true;
  } catch {
    return false;
  }
}

export const ProjectStatusSchema = z.enum([
  'estimating',
  'in_progress',
  'completed',
  'on_hold',
]);
export const PricingTypeSchema = z.enum(['fixed', 'time_and_materials']);
export const ExpenseCategorySchema = z.enum([
  'materials',
  'tools',
  'subcontractor',
  'mileage_fuel',
  'permits_fees',
  'overhead',
]);
export const PaymentMethodSchema = z.enum(['card', 'cash', 'check', 'transfer']);
export const TransactionStatusSchema = z.enum(['matched', 'unassigned', 'ignored']);
export const InvoiceStatusSchema = z.enum(['draft', 'sent', 'paid', 'overdue']);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type PricingType = z.infer<typeof PricingTypeSchema>;
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const ProjectInput = z.object({
  name: requiredText,
  clientName: requiredText,
  clientPhone: text,
  clientAddress: text,
  description: text,
  status: ProjectStatusSchema,
  pricingType: PricingTypeSchema,
  quotedTotalCents: cents,
  quotedMaterialsCents: cents,
  quotedLaborHours: z.number().nonnegative(),
  targetHourlyRateCents: cents,
  targetMarginPct: z.number(),
  startDate: isoDate,
  deadlineDate: isoDate.optional(),
  completedDate: isoDate.optional(),
  notes: text.optional(),
});

export const TransactionInput = z.object({
  date: isoDate,
  description: requiredText,
  vendor: text,
  amountCents: cents,
  category: ExpenseCategorySchema,
  paymentMethod: PaymentMethodSchema,
  cardLast4: text.optional(),
  status: TransactionStatusSchema,
  projectId: text.optional(),
  receiptNumber: text.optional(),
  taxDeductible: z.boolean(),
  notes: text.optional(),
});

export const LaborEntryInput = z.object({
  projectId: requiredText,
  date: isoDate,
  hours: z.number().nonnegative(),
  hourlyRateCents: cents,
  workerName: text,
  notes: text.optional(),
});

export const InvoiceInput = z.object({
  projectId: requiredText,
  invoiceNumber: requiredText,
  amountCents: cents,
  depositAmountCents: cents,
  dateIssued: isoDate,
  dueDate: isoDate,
  status: InvoiceStatusSchema,
  paidDate: isoDate.optional(),
  notes: text.optional(),
});

/**
 * One row of an imported bank CSV. `amount` arrives as the decimal string the
 * bank wrote and leaves as cents: this is the import boundary ADR 0007 talks
 * about, so parseMoney is called here and nowhere downstream.
 */
export const CsvRowSchema = z.object({
  date: isoDate,
  description: requiredText,
  amount: z
    .string()
    .refine(isParsableMoney, { message: 'Expected a decimal amount like 114.75' })
    .transform(parseMoney),
});
