import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { categorizeVendor, ExpenseCategory, ExpenseTransaction } from '@budget-bot/core';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { items, rawCsv, simulatedType } = body;

    // Simulated quick feed generator
    if (simulatedType === 'home_depot_run') {
      const simulated: Omit<ExpenseTransaction, 'id' | 'createdAt'>[] = [
        {
          date: new Date().toISOString().slice(0, 10),
          description: 'THE HOME DEPOT #0421 - 3" Deck Screws, Level & Sandpaper',
          vendor: 'The Home Depot',
          amount: 114.75,
          category: 'materials',
          paymentMethod: 'card',
          cardLast4: '4892',
          status: 'unassigned',
          taxDeductible: true,
          notes: 'Live swipe via Capital One Spark card',
        },
        {
          date: new Date().toISOString().slice(0, 10),
          description: 'SHERWIN-WILLIAMS - 2 Gal ProMar 200 Eggshell & Rollers',
          vendor: 'Sherwin-Williams Paints',
          amount: 146.30,
          category: 'materials',
          paymentMethod: 'card',
          cardLast4: '4892',
          status: 'unassigned',
          taxDeductible: true,
          notes: 'Paint order for living room job',
        },
      ];
      const created = db.bulkImportTransactions(simulated);
      return NextResponse.json({ success: true, count: created.length, created });
    }

    // CSV Parse
    if (rawCsv) {
      const lines = (rawCsv as string).split('\n').filter((l) => l.trim().length > 0);
      const imported: Omit<ExpenseTransaction, 'id' | 'createdAt'>[] = [];

      for (let i = 0; i < lines.length; i++) {
        // Skip header if contains 'date' or 'amount'
        if (i === 0 && (lines[i].toLowerCase().includes('date') || lines[i].toLowerCase().includes('amount'))) {
          continue;
        }

        const parts = lines[i].split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
        if (parts.length < 2) continue;

        // Expect Date, Description, Amount
        const dateStr = parts[0] || new Date().toISOString().slice(0, 10);
        const desc = parts[1] || 'Card Purchase';
        const amountNum = Math.abs(parseFloat(parts[2] || '0'));

        if (!isNaN(amountNum) && amountNum > 0) {
          const auto = categorizeVendor(desc);
          imported.push({
            date: dateStr,
            description: desc,
            vendor: auto.cleanVendor,
            amount: amountNum,
            category: auto.category,
            paymentMethod: 'card',
            cardLast4: '4892',
            status: 'unassigned',
            taxDeductible: auto.taxDeductible,
            notes: 'Imported via CSV feed',
          });
        }
      }

      if (imported.length > 0) {
        const created = db.bulkImportTransactions(imported);
        return NextResponse.json({ success: true, count: created.length, created });
      }
    }

    // Direct items array
    if (Array.isArray(items) && items.length > 0) {
      const created = db.bulkImportTransactions(items);
      return NextResponse.json({ success: true, count: created.length, created });
    }

    return NextResponse.json({ error: 'No valid transaction data provided' }, { status: 400 });
  } catch (error) {
    console.error('Error importing transactions:', error);
    return NextResponse.json({ error: 'Failed to import transactions' }, { status: 500 });
  }
}
