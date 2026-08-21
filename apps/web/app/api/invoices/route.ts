import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { UnknownProjectError } from '@budget-bot/db';
import { InvalidMoneyFieldError, readCents } from '@/lib/readCents';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') || undefined;
  const invoices = await db.getInvoices(projectId);
  return NextResponse.json({ invoices });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      invoiceNumber,
      amount,
      depositAmount,
      dateIssued,
      dueDate,
      status,
      paidDate,
      notes,
    } = body;

    if (!projectId || amount === undefined) {
      return NextResponse.json({ error: 'Missing projectId or amount' }, { status: 400 });
    }

    const inv = await db.createInvoice({
      projectId,
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      amountCents: readCents(amount, 'amount'),
      depositAmountCents: readCents(depositAmount, 'depositAmount', { optional: true }),
      dateIssued: dateIssued || new Date().toISOString().slice(0, 10),
      dueDate: dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      status: status || 'sent',
      paidDate: paidDate || (status === 'paid' ? new Date().toISOString().slice(0, 10) : undefined),
      notes: notes || '',
    });

    return NextResponse.json({ success: true, invoice: inv }, { status: 201 });
  } catch (error) {
    // The caller named a project that is not theirs (or does not exist). That
    // is a bad request, not a server fault.
    if (error instanceof UnknownProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidMoneyFieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing invoice ID' }, { status: 400 });
    }

    if (updates.status === 'paid' && !updates.paidDate) {
      updates.paidDate = new Date().toISOString().slice(0, 10);
    }

    const updated = await db.updateInvoice(id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, invoice: updated });
  } catch (error) {
    if (error instanceof UnknownProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}
