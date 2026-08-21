import { NextResponse } from 'next/server';
import { storeForSession, unauthorized } from '@/lib/apiSession';
import { UnknownProjectError } from '@budget-bot/db';
import { InvalidMoneyFieldError, readCents } from '@/lib/readCents';

export async function GET(req: Request) {
  const store = await storeForSession();
  if (!store) return unauthorized();

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') || undefined;
  const laborEntries = await store.getLaborEntries(projectId);
  return NextResponse.json({ laborEntries });
}

export async function POST(req: Request) {
  const store = await storeForSession();
  if (!store) return unauthorized();

  try {
    const body = await req.json();
    const { projectId, date, hours, hourlyRate, workerName, notes } = body;

    if (!projectId || hours === undefined) {
      return NextResponse.json({ error: 'Missing projectId or hours' }, { status: 400 });
    }

    const entry = await store.createLaborEntry({
      projectId,
      date: date || new Date().toISOString().slice(0, 10),
      hours: Number(hours),
      hourlyRateCents: readCents(hourlyRate, 'hourlyRate', {
        optional: true,
        fallbackDollars: 85,
      }),
      workerName: workerName || 'Mike (Owner/Lead)',
      notes: notes || '',
    });

    return NextResponse.json({ success: true, laborEntry: entry }, { status: 201 });
  } catch (error) {
    // The caller named a project that is not theirs (or does not exist). That
    // is a bad request, not a server fault.
    if (error instanceof UnknownProjectError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidMoneyFieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to log labor entry' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const store = await storeForSession();
  if (!store) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing labor ID' }, { status: 400 });
    }
    const deleted = await store.deleteLaborEntry(id);
    return NextResponse.json({ success: deleted });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete labor entry' }, { status: 500 });
  }
}
