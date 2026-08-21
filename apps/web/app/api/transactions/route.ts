import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { categorizeVendor, multiplyCents } from '@budget-bot/core';
import { InvalidMoneyFieldError, readCents } from '@/lib/readCents';

export async function GET() {
  const transactions = await db.getTransactions();
  return NextResponse.json({ transactions });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      description,
      vendor,
      amount,
      category,
      paymentMethod,
      cardLast4,
      status,
      projectId,
      date,
      receiptNumber,
      taxDeductible,
      notes,
    } = body;

    if (!description || amount === undefined) {
      return NextResponse.json({ error: 'Missing required description or amount' }, { status: 400 });
    }

    // Refunds arrive as negatives; expenses are stored as magnitudes.
    const signedCents = readCents(amount, 'amount');
    const amountCents = signedCents < 0 ? multiplyCents(signedCents, -1) : signedCents;

    // Auto-categorize if not provided
    const auto = categorizeVendor(description);
    const resolvedVendor = vendor || auto.cleanVendor;
    const resolvedCategory = category || auto.category;
    const resolvedTaxDeductible =
      taxDeductible !== undefined ? taxDeductible : auto.taxDeductible;

    const tx = await db.createTransaction({
      description,
      vendor: resolvedVendor,
      amountCents,
      category: resolvedCategory,
      paymentMethod: paymentMethod || 'card',
      cardLast4: cardLast4 || '4892',
      status: status || (projectId ? 'matched' : 'unassigned'),
      projectId: projectId || undefined,
      date: date || new Date().toISOString().slice(0, 10),
      receiptNumber: receiptNumber || '',
      taxDeductible: resolvedTaxDeductible,
      notes: notes || '',
    });

    return NextResponse.json({ success: true, transaction: tx }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidMoneyFieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: 'Transaction ID required' }, { status: 400 });
    }

    // If a project is assigned, automatically mark as 'matched' unless specified
    if (updates.projectId && !updates.status) {
      updates.status = 'matched';
    }

    const updated = await db.updateTransaction(id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, transaction: updated });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Transaction ID required' }, { status: 400 });
    }
    const deleted = await db.deleteTransaction(id);
    return NextResponse.json({ success: deleted });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
