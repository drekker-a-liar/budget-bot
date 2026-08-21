import { NextResponse } from 'next/server';
import { CsvProvider, type CsvRowError } from '@budget-bot/bank-connectors';
import { categorizeVendor } from '@budget-bot/core';
import {
  getDb,
  importBatchesRepo,
  transactionsRepo,
  UnknownProjectError,
  type ImportedTransaction,
} from '@budget-bot/db';
import { currentOwnerId } from '@/lib/ownerSession';

/**
 * Uploading a bank statement.
 *
 * The only REST route this application keeps besides `/api/auth/*` and
 * `/api/health` (spec §6). Everything else a person does is a server action;
 * this stays a route because the caller is a file upload, which is a machine
 * shape - a `multipart/form-data` body or a raw `text/csv` one - and because a
 * self-hoster with a cron job and `curl` should be able to feed it.
 *
 * Parsing lives in `@budget-bot/bank-connectors`; what happens here is the
 * part that is about *this* application: whose rows these are, what they get
 * categorised as, and the batch row that makes the import undoable.
 */

/**
 * The account these rows belong to. There is no linked bank account until
 * Phase 2, so every upload shares one synthetic id: enough to scope the
 * `externalId` hash, honest about the fact that nothing real is behind it.
 *
 * The consequence is that rows dedupe *within* a file but not across uploads -
 * `bank_account_id` is null, and Postgres counts null as distinct in the
 * partial unique index. Cross-batch dedupe arrives with real bank accounts.
 */
const CSV_ACCOUNT = 'csv-upload';

interface Upload {
  text: string;
  filename: string | null;
}

/** The file, however the caller chose to send it. */
async function readUpload(req: Request): Promise<Upload | null> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return null;
    return { text: await file.text(), filename: file.name || null };
  }

  const text = await req.text();
  if (text.trim() === '') return null;
  return { text, filename: null };
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request): Promise<NextResponse> {
  const ownerId = await currentOwnerId();
  if (!ownerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let upload: Upload | null;
  try {
    upload = await readUpload(req);
  } catch {
    // A malformed multipart body is the caller's mistake, not a fault here.
    upload = null;
  }
  if (!upload) {
    return badRequest('No CSV file. Send multipart/form-data with a `file` field, or a text/csv body.');
  }

  let parsed: { rows: ReturnType<typeof CsvProvider.parse>['rows']; errors: CsvRowError[] };
  try {
    parsed = CsvProvider.parse(upload.text, { accountExternalId: CSV_ACCOUNT });
  } catch (error) {
    // An unreadable header or an empty file: there is nothing to import and
    // nothing useful to say row by row, so the message is the whole answer.
    return badRequest((error as Error).message);
  }

  const items: ImportedTransaction[] = parsed.rows.map((row) => {
    const auto = categorizeVendor(row.rawDescriptor);
    return {
      date: row.date,
      description: row.rawDescriptor,
      rawDescriptor: row.rawDescriptor,
      vendor: auto.cleanVendor,
      amountCents: row.amountCents,
      category: auto.category,
      paymentMethod: 'card' as const,
      // Positive is money out (spec §8). A negative row is a refund or a card
      // payment: real, stored, and ignored by the metrics, because counting it
      // as an expense would double-count the purchases it settles.
      status: row.amountCents < 0 ? ('ignored' as const) : ('unassigned' as const),
      taxDeductible: auto.taxDeductible,
      externalId: row.externalId,
    };
  });

  try {
    const batch = await importBatchesRepo.createImportBatch(getDb(), ownerId, {
      source: 'csv',
      filename: upload.filename,
      rowCount: items.length + parsed.errors.length,
      insertedCount: items.length,
      skippedCount: parsed.errors.length,
    });

    await transactionsRepo.bulkCreateImported(getDb(), ownerId, items, {
      source: 'csv',
      provider: 'csv',
      importBatchId: batch.id,
    });

    return NextResponse.json({
      inserted: items.length,
      skipped: parsed.errors.length,
      errors: parsed.errors,
      batchId: batch.id,
    });
  } catch (error) {
    // No CSV row carries a project id, so this cannot fire today. The mapping
    // is here for parity with every other write: a reference to a project that
    // is not the caller's is a bad request, not a server fault.
    if (error instanceof UnknownProjectError) return badRequest(error.message);
    console.error('Failed to import CSV:', error);
    return NextResponse.json({ error: 'Failed to import the file' }, { status: 500 });
  }
}
