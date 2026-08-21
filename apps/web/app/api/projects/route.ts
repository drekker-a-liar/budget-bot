import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { InvalidMoneyFieldError, readCents } from '@/lib/readCents';

export async function GET() {
  const projects = await db.getProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      clientName,
      clientPhone,
      clientAddress,
      description,
      status,
      pricingType,
      quotedTotal,
      quotedMaterials,
      quotedLaborHours,
      targetHourlyRate,
      targetMarginPct,
      startDate,
      deadlineDate,
      notes,
    } = body;

    if (!name || !clientName || quotedTotal === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const project = await db.createProject({
      name,
      clientName,
      clientPhone: clientPhone || '',
      clientAddress: clientAddress || '',
      description: description || '',
      status: status || 'estimating',
      pricingType: pricingType || 'fixed',
      quotedTotalCents: readCents(quotedTotal, 'quotedTotal'),
      quotedMaterialsCents: readCents(quotedMaterials, 'quotedMaterials', { optional: true }),
      quotedLaborHours: Number(quotedLaborHours) || 0,
      targetHourlyRateCents: readCents(targetHourlyRate, 'targetHourlyRate', {
        optional: true,
        fallbackDollars: 85,
      }),
      targetMarginPct: Number(targetMarginPct) || 45,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      deadlineDate: deadlineDate || undefined,
      notes: notes || '',
    });

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidMoneyFieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
