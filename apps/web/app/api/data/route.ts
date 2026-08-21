import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculateProjectKPIs, calculateBusinessSummary } from '@budget-bot/core';

export async function GET() {
  try {
    const raw = await db.getAll();
    const projectKPIs = raw.projects.map((p) =>
      calculateProjectKPIs(p, raw.transactions, raw.laborEntries, raw.invoices)
    );
    const summary = calculateBusinessSummary(
      raw.projects,
      raw.transactions,
      raw.laborEntries,
      raw.invoices,
      new Date()
    );

    return NextResponse.json({
      summary,
      projects: raw.projects,
      projectKPIs,
      transactions: raw.transactions,
      laborEntries: raw.laborEntries,
      invoices: raw.invoices,
      cardProfile: raw.cardProfile,
    });
  } catch (error) {
    console.error('API Error in GET /api/data:', error);
    return NextResponse.json({ error: 'Failed to load financial data' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === 'reset') {
      // Against the JSON file this rewrites demo data; against Postgres it
      // deletes every row the owner has. It exists for local development and
      // is removed with the JSON store, so it must not be reachable from a
      // deployed environment in the meantime.
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
          { error: 'Resetting to seed data is disabled in production' },
          { status: 403 }
        );
      }
      const data = await db.resetToSeed();
      return NextResponse.json({ success: true, message: 'Reset to seed data', data });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
