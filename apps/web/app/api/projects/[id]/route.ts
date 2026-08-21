import { NextResponse } from 'next/server';
import { storeForSession, unauthorized } from '@/lib/apiSession';
import { calculateProjectKPIs } from '@budget-bot/core';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const store = await storeForSession();
  if (!store) return unauthorized();

  const project = await store.getProjectById(params.id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const raw = await store.getAll();
  const kpi = calculateProjectKPIs(
    project,
    raw.transactions,
    raw.laborEntries,
    raw.invoices
  );
  const projectTransactions = raw.transactions.filter(
    (t) => t.projectId === project.id
  );
  const projectLabor = raw.laborEntries.filter((l) => l.projectId === project.id);
  const projectInvoices = raw.invoices.filter((i) => i.projectId === project.id);

  return NextResponse.json({
    project,
    kpi,
    transactions: projectTransactions,
    laborEntries: projectLabor,
    invoices: projectInvoices,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const store = await storeForSession();
  if (!store) return unauthorized();

  try {
    const body = await req.json();
    const updated = await store.updateProject(params.id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, project: updated });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const store = await storeForSession();
  if (!store) return unauthorized();

  const deleted = await store.deleteProject(params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
