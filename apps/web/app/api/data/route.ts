import { NextResponse } from 'next/server';
import { storeForSession, unauthorized } from '@/lib/apiSession';
import { calculateProjectKPIs, calculateBusinessSummary } from '@budget-bot/core';

/**
 * Everything the dashboard draws, in one response.
 *
 * TEMP: the pages still fetch this from the browser. Task 5 moves the reads
 * into Server Components and this route goes with them.
 *
 * The `POST {action:'reset'}` that used to live here is gone: against Postgres
 * it deleted every row an owner had, and a demo-data button is not worth an
 * endpoint that can do that. `pnpm db:seed` and `SEED_DEMO=1` replace it.
 */
export async function GET() {
  const store = await storeForSession();
  if (!store) return unauthorized();

  try {
    const raw = await store.getAll();
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

