import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') || undefined;
  const invoices = db.getInvoices(projectId);
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

    const inv = db.createInvoice({
      projectId,
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      amount: Number(amount),
      depositAmount: Number(depositAmount) || 0,
      dateIssued: dateIssued || new Date().toISOString().slice(0, 10),
      dueDate: dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      status: status || 'sent',
      paidDate: paidDate || (status === 'paid' ? new Date().toISOString().slice(0, 10) : undefined),
      notes: notes || '',
    });

    return NextResponse.json({ success: true, invoice: inv }, { status: 201 });
  } catch (error) {
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

    const updated = db.updateInvoice(id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, invoice: updated });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}
