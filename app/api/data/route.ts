import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculateProjectKPIs, calculateBusinessSummary } from '@/lib/metricsEngine';

export async function GET() {
  try {
    const raw = db.getAll();
    const projectKPIs = raw.projects.map((p) =>
      calculateProjectKPIs(p, raw.transactions, raw.laborEntries, raw.invoices)
    );
    const summary = calculateBusinessSummary(
      raw.projects,
      raw.transactions,
      raw.laborEntries,
      raw.invoices
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
      const data = db.resetToSeed();
      return NextResponse.json({ success: true, message: 'Reset to seed data', data });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
