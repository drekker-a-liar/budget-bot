import { NextResponse } from 'next/server';
import { CsvProvider, type CsvRowError } from '@budget-bot/bank-connectors';
import { categorizeVendor } from '@budget-bot/core';
import {
  getDb,
  importsRepo,
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
 *
 * Columns are matched by name and dates are accepted as `YYYY-MM-DD` or
 * `MM/DD/YYYY` (US ordering, month first). A row written any other way comes
 * back in `errors` with its line number and the formats that would have
 * worked, rather than as a bare "Expected a YYYY-MM-DD date" - see
 * `csv/dates.ts` for why `DD/MM/YYYY` is refused rather than guessed at.
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

/**
 * As much of a file as this route will read.
 *
 * A route handler has no body limit of its own, and a self-hoster running this
 * on their own box has no platform limit in front of it either, so an
 * unbounded `req.text()` is a way to fill the server's memory from outside.
 * Five MiB is generous for what this is: a year of one contractor's card
 * statements is well under one.
 */
const CSV_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

interface Upload {
  text: string;
  filename: string | null;
}

/** A refusal, distinguishable from a parse failure by its status. */
class UploadRefused extends Error {
  constructor(
    readonly status: 400 | 411 | 413,
    message: string
  ) {
    super(message);
    this.name = 'UploadRefused';
  }
}

/**
 * What the caller says it is about to send.
 *
 * Checked before anything is read, so an oversized body is refused at the
 * front door rather than after it has been buffered. An absent length is a 411
 * rather than a 413: nothing is known to be too large, only unmeasured, and
 * the caller can fix it by sending one.
 */
function assertDeclaredSizeIsSane(req: Request): void {
  const declared = req.headers.get('content-length');
  if (declared === null) {
    throw new UploadRefused(411, 'Send a Content-Length; this endpoint will not read an unmeasured body.');
  }

  const bytes = Number(declared);
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new UploadRefused(411, 'Content-Length is not a number of bytes.');
  }
  if (bytes > CSV_IMPORT_MAX_BYTES) {
    throw new UploadRefused(413, 'That file is larger than the 5 MiB import limit.');
  }
}

/**
 * The body, read a chunk at a time and abandoned the moment it goes past the
 * cap. `Content-Length` is the caller's word for it; this is the part that
 * does not take their word.
 */
async function readCappedText(req: Request): Promise<string> {
  if (!req.body) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CSV_IMPORT_MAX_BYTES) {
        throw new UploadRefused(413, 'That file is larger than the 5 MiB import limit.');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {
      // The stream is already going away; nothing here depends on how.
    });
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The file, however the caller chose to send it. */
async function readUpload(req: Request): Promise<Upload | null> {
  assertDeclaredSizeIsSane(req);
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    // The declared length has already been checked, so `formData()` is not
    // being handed an unbounded body. The file itself is checked as well,
    // because one part of a multipart body can be far larger than the header
    // suggested if the header was wrong.
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return null;
    if (file.size > CSV_IMPORT_MAX_BYTES) {
      throw new UploadRefused(413, 'That file is larger than the 5 MiB import limit.');
    }
    return { text: await file.text(), filename: file.name || null };
  }

  const text = await readCappedText(req);
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
  } catch (error) {
    if (error instanceof UploadRefused) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
      pending: row.pending,
    };
  });

  try {
    // One write: the batch and its rows land together or not at all, so a
    // rejected insert cannot leave an import in the ledger that brought
    // nothing in. The repository owns the transaction; this route only says
    // what to write.
    const { batch } = await importsRepo.importCsvBatch(getDb(), ownerId, {
      batch: {
        source: 'csv',
        filename: upload.filename,
        rowCount: items.length + parsed.errors.length,
        insertedCount: items.length,
        skippedCount: parsed.errors.length,
      },
      rows: items,
      provider: 'csv',
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
