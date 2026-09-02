import { z } from 'zod';
import {
  ExpenseCategorySchema,
  InvoiceInput,
  InvoiceStatusSchema,
  LaborEntryInput,
  parseMoney,
  PaymentMethodSchema,
  PricingTypeSchema,
  ProjectInput,
  ProjectStatusSchema,
  TransactionInput,
} from '@budget-bot/core';

/**
 * What the forms send, and how it becomes what the domain accepts.
 *
 * Every schema here ends in a `.pipe(...)` into the matching `@budget-bot/core`
 * input schema, so the last word on what is valid belongs to the domain and
 * not to a form. What the form layer adds either side of that pipe is two
 * things the domain deliberately does not know about: money arriving as text,
 * and the defaults that make a quick-entry modal quick.
 *
 * `parseMoney` runs here and nowhere downstream - the one call at the boundary
 * that ADR 0007 asks for. Nothing past this file sees a decimal string again.
 */

const isoDate = ProjectInput.shape.startDate;

/**
 * A date the form has to send. There is deliberately no "today" default here.
 *
 * Which calendar day it is depends on where the owner is, not where the server
 * runs (CLAUDE.md: `toISOString()` for a calendar date is a bug), and the
 * schemas in this file are module-level constants whose defaults cannot wait on
 * a per-request lookup of `settings.timeZone`. The browser already knows the
 * day on the person's clock and the modal always has one to send, so the
 * client owns this default (`lib/localDate.ts`) and the server refuses a form
 * that left it out - with a message that names the box, because zod's own
 * "expected string, received undefined" does not.
 */
const requiredDate = (message: string) => z.string({ error: message }).pipe(isoDate);

function isParsableMoney(value: string | number): boolean {
  try {
    parseMoney(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dollars as the user typed them: `1,234.56`, `$1234.56`, `(114.75)`, or a
 * number. An empty string is *absent*, so an optional amount left blank falls
 * back to its default instead of failing.
 */
const money = z
  .union([z.string(), z.number()])
  .refine(isParsableMoney, { message: 'Enter an amount like 1,234.56' })
  // Typed as a plain number, not as `Cents`: the form layer produces a whole
  // number of cents and the domain schema on the other side of the `.pipe` is
  // what certifies it as money. Branding it here would claim the form's
  // authority over a decision core owns.
  .transform((value): number => parseMoney(value));

const optionalMoney = (fallbackDollars: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallbackDollars : value))
    .pipe(money);

/** The status a new expense starts in, given its sign and its filing. */
function negativeOrFiled(
  amountCents: number,
  projectId: string | undefined
): 'ignored' | 'matched' | 'unassigned' {
  if (amountCents < 0) return 'ignored';
  return projectId ? 'matched' : 'unassigned';
}

const text = z.string().default('');
/**
 * A field that has to be filled in. The message covers absent as well as
 * empty: zod's default for a missing key is "expected string, received
 * undefined", which tells a contractor nothing about which box to type in.
 */
const named = (message: string) => z.string({ error: message }).trim().min(1, message);
const quantity = z
  .union([z.string(), z.number()])
  .transform(Number)
  // `Number('eight')` is NaN, which `z.number()` rejects - so a typo in an
  // hours field is a message rather than a row of NaN hours.
  .pipe(z.number().nonnegative('Enter a number of hours'));
const optionalQuantity = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : value))
    .pipe(quantity);

export const CreateProjectForm = z
  .object({
    name: named('Give the project a name'),
    clientName: named('Name the client'),
    clientPhone: text,
    clientAddress: text,
    description: text,
    status: ProjectStatusSchema.default('in_progress'),
    pricingType: PricingTypeSchema.default('fixed'),
    quotedTotal: money,
    quotedMaterials: optionalMoney(0),
    quotedLaborHours: optionalQuantity(0),
    targetHourlyRate: optionalMoney(85),
    targetMarginPct: optionalQuantity(45),
    startDate: requiredDate('When does the job start?'),
    deadlineDate: isoDate.optional(),
    notes: text,
  })
  // Rebuilt field by field rather than spread: `.pipe` hands the domain schema
  // exactly what it declares, and a form key that is not a domain key - a
  // dollar amount beside its cents - must not travel any further than here.
  .transform((form): z.input<typeof ProjectInput> => ({
    name: form.name,
    clientName: form.clientName,
    clientPhone: form.clientPhone,
    clientAddress: form.clientAddress,
    description: form.description,
    status: form.status,
    pricingType: form.pricingType,
    quotedTotalCents: form.quotedTotal,
    quotedMaterialsCents: form.quotedMaterials,
    quotedLaborHours: form.quotedLaborHours,
    targetHourlyRateCents: form.targetHourlyRate,
    targetMarginPct: form.targetMarginPct,
    startDate: form.startDate,
    deadlineDate: form.deadlineDate,
    notes: form.notes,
  }))
  .pipe(ProjectInput);

export const UpdateProjectStatusForm = z.object({
  id: named('Which project?'),
  status: ProjectStatusSchema,
});

export const CreateTransactionForm = z
  .object({
    date: requiredDate('When was this bought?'),
    description: text,
    vendor: named('Name the vendor'),
    amount: money,
    category: ExpenseCategorySchema.default('materials'),
    paymentMethod: PaymentMethodSchema.default('card'),
    projectId: z.string().optional(),
    taxDeductible: z.boolean().default(true),
    notes: text,
  })
  .transform((form): z.input<typeof TransactionInput> => ({
    date: form.date,
    // A receipt with no note still needs something to read in the ledger.
    description: form.description.trim() || `${form.vendor} purchase`,
    vendor: form.vendor,
    amountCents: form.amount,
    category: form.category,
    paymentMethod: form.paymentMethod,
    projectId: form.projectId || undefined,
    // Positive is money out (spec §8). A negative amount is a refund or a
    // card payment, and defaults to `ignored` however it arrived - the same
    // rule the CSV importer applies, so the two entry paths agree.
    status: negativeOrFiled(form.amount, form.projectId),
    taxDeductible: form.taxDeductible,
    notes: form.notes,
  }))
  .pipe(TransactionInput);

export const AssignTransactionForm = z.object({
  id: named('Which charge?'),
  /** Empty means "put it back in the inbox". */
  projectId: z.string(),
});

export const UpdateTransactionCategoryForm = z.object({
  id: named('Which charge?'),
  category: ExpenseCategorySchema,
});

export const TransactionIdForm = z.object({ id: named('Which charge?') });

export const CreateLaborEntryForm = z
  .object({
    projectId: named('Which job were the hours worked on?'),
    date: requiredDate('Which day were the hours worked?'),
    hours: quantity,
    hourlyRate: optionalMoney(85),
    workerName: text,
    notes: text,
  })
  .transform((form): z.input<typeof LaborEntryInput> => ({
    projectId: form.projectId,
    date: form.date,
    hours: form.hours,
    hourlyRateCents: form.hourlyRate,
    // Blank stays blank here: the one default that depends on who is signed
    // in is applied in the action, which is where the session is known.
    workerName: form.workerName.trim(),
    notes: form.notes,
  }))
  .pipe(LaborEntryInput);

export const LaborEntryIdForm = z.object({ id: named('Which labor entry?') });

export const CreateInvoiceForm = z
  .object({
    projectId: named('Which job is being invoiced?'),
    invoiceNumber: named('Give the invoice a number'),
    amount: money,
    depositAmount: optionalMoney(0),
    dateIssued: requiredDate('When was the invoice issued?'),
    dueDate: requiredDate('When is the invoice due?'),
    status: InvoiceStatusSchema.default('sent'),
    notes: text,
  })
  .transform((form): z.input<typeof InvoiceInput> => ({
    projectId: form.projectId,
    invoiceNumber: form.invoiceNumber,
    amountCents: form.amount,
    depositAmountCents: form.depositAmount,
    dateIssued: form.dateIssued,
    dueDate: form.dueDate,
    status: form.status,
    notes: form.notes,
  }))
  .pipe(InvoiceInput);

export const MarkInvoicePaidForm = z.object({
  id: named('Which invoice?'),
  paidDate: requiredDate('When was it paid?'),
});

/**
 * What the Link flow hands back.
 *
 * A public token is a short-lived string minted by Plaid Link in the browser
 * and exchanged once. Nothing on this side can tell a real one from a typo -
 * only Plaid can - so the only thing worth checking here is that there is one,
 * and the message is written for the case that actually happens: Link closed
 * without completing.
 */
export const ExchangePublicTokenForm = z.object({
  publicToken: named('The bank did not finish connecting. Try again.'),
});

export const SyncConnectionForm = z.object({
  connectionId: named('Which connection?'),
});
