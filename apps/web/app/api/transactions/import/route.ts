import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  categorizeVendor,
  CsvRowSchema,
  ExpenseTransaction,
  multiplyCents,
  parseMoney,
} from '@budget-bot/core';

type NewTransaction = Omit<ExpenseTransaction, 'id' | 'createdAt'>;

interface SkippedRow {
  /** 1-based line number in the uploaded file, so the user can find it. */
  row: number;
  reason: string;
}

function importResult(created: ExpenseTransaction[], errors: SkippedRow[]) {
  return NextResponse.json({
    success: true,
    inserted: created.length,
    skipped: errors.length,
    errors,
    created,
  });
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`)
    .join('; ');
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { items, rawCsv, simulatedType } = body;

    // Simulated quick feed generator
    if (simulatedType === 'home_depot_run') {
      const simulated: NewTransaction[] = [
        {
          date: new Date().toISOString().slice(0, 10),
          description: 'THE HOME DEPOT #0421 - 3" Deck Screws, Level & Sandpaper',
          vendor: 'The Home Depot',
          amountCents: parseMoney(114.75),
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
          amountCents: parseMoney(146.30),
          category: 'materials',
          paymentMethod: 'card',
          cardLast4: '4892',
          status: 'unassigned',
          taxDeductible: true,
          notes: 'Paint order for living room job',
        },
      ];
      return importResult(await db.bulkImportTransactions(simulated), []);
    }

    // CSV Parse. One unreadable cell must not cost the user the rest of the
    // file, so every row is validated on its own and the ones that fail are
    // reported back rather than dropped in silence.
    if (rawCsv) {
      const lines = (rawCsv as string).split('\n').filter((l) => l.trim().length > 0);
      const imported: NewTransaction[] = [];
      const errors: SkippedRow[] = [];

      for (let i = 0; i < lines.length; i++) {
        const row = i + 1;

        // Skip header if contains 'date' or 'amount'
        if (i === 0 && (lines[i].toLowerCase().includes('date') || lines[i].toLowerCase().includes('amount'))) {
          continue;
        }

        const parts = lines[i].split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));

        // Expect Date, Description, Amount. An absent date keeps this route's
        // long-standing default of today; description and amount have to be
        // there and have to be readable.
        const parsed = CsvRowSchema.safeParse({
          date: parts[0] || new Date().toISOString().slice(0, 10),
          description: parts[1] ?? '',
          amount: parts[2] ?? '',
        });

        if (!parsed.success) {
          errors.push({ row, reason: describeIssues(parsed.error) });
          continue;
        }

        // Banks write refunds as negatives; expenses are stored as magnitudes.
        const signedCents = parsed.data.amount;
        const amountCents = signedCents < 0 ? multiplyCents(signedCents, -1) : signedCents;

        if (amountCents === 0) {
          errors.push({ row, reason: 'amount: the amount is zero' });
          continue;
        }

        const auto = categorizeVendor(parsed.data.description);
        imported.push({
          date: parsed.data.date,
          description: parsed.data.description,
          vendor: auto.cleanVendor,
          amountCents,
          category: auto.category,
          paymentMethod: 'card',
          cardLast4: '4892',
          status: 'unassigned',
          taxDeductible: auto.taxDeductible,
          notes: 'Imported via CSV feed',
        });
      }

      const created = imported.length > 0 ? await db.bulkImportTransactions(imported) : [];
      return importResult(created, errors);
    }

    // Direct items array
    if (Array.isArray(items) && items.length > 0) {
      return importResult(await db.bulkImportTransactions(items), []);
    }

    return NextResponse.json({ error: 'No valid transaction data provided' }, { status: 400 });
  } catch (error) {
    console.error('Error importing transactions:', error);
    return NextResponse.json({ error: 'Failed to import transactions' }, { status: 500 });
  }
}
