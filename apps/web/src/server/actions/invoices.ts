'use server';

import type { Invoice } from '@budget-bot/core';
import { getDb, invoicesRepo, UnknownProjectError } from '@budget-bot/db';
import { currentOwnerId } from '@/lib/ownerSession';
import { CreateInvoiceForm, MarkInvoicePaidForm } from './inputs';
import { revalidateApp } from './revalidate';
import { failed, invalid, ok, unauthorized, type ActionResult } from './result';

/** Issuing invoices, and recording that one was paid. */

export async function createInvoiceAction(input: unknown): Promise<ActionResult<Invoice>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = CreateInvoiceForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const invoice = await invoicesRepo.createInvoice(getDb(), ownerId, parsed.data);
    revalidateApp();
    return ok(invoice);
  } catch (error) {
    if (error instanceof UnknownProjectError) return failed(error.message);
    throw error;
  }
}

/**
 * Marking an invoice paid is the one invoice edit the UI offers, and it is
 * two columns rather than one: revenue is recognised on `paidDate` (ADR 0006),
 * so a `paid` status without a date would drop the payment out of every cash
 * basis figure it should appear in.
 */
export async function markInvoicePaidAction(input: unknown): Promise<ActionResult<Invoice>> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return unauthorized();

  const parsed = MarkInvoicePaidForm.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const invoice = await invoicesRepo.updateInvoice(getDb(), ownerId, parsed.data.id, {
    status: 'paid',
    paidDate: parsed.data.paidDate,
  });
  if (!invoice) return failed('No such invoice.');

  revalidateApp();
  return ok(invoice);
}
