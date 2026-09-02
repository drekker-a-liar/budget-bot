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
import { declaredBodyBytes, readCappedBody } from '@/lib/readCappedBody';

/**
 * Uploading a bank statement.
 *
 * The only REST route this application keeps besides `/api/auth/*` and
 * `/api/health` (spec §6). Everything else a person does is a server action;
 * this stays a route because the caller is a file upload, which is a machine
 * shape, and because a self-hoster with a cron job and `curl` should be able
 * to feed it.
 *
 * The body is a raw `text/csv` request, nothing else. `multipart/form-data`
 * is refused with `415` rather than parsed: a form field is a shape built for
 * a browser posting to itself, and buffering it just to pull one file back
 * out was a detour the client no longer needs to take.
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
 * Cross-batch dedupe (spec §7) does *not* come from this id - `bank_account_id`
 * stays null for every CSV row, and Postgres counts null as distinct in the
 * sync upsert index, so two null-account rows never conflict there regardless
 * of what `CSV_ACCOUNT` says. The fix is a second index,
 * `transactions_owner_csv_external_key`, scoped by owner and
 * `provider = 'csv'` instead - the spec's ruling explicitly supersedes the
 * idea of inventing a synthetic bank account to carry this scope.
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
}

/** A refusal, distinguishable from a parse failure by its status. */
class UploadRefused extends Error {
  constructor(
    readonly status: 400 | 411 | 413 | 415,
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
  if (req.headers.get('content-length') === null) {
    throw new UploadRefused(411, 'Send a Content-Length; this endpoint will not read an unmeasured body.');
  }

  const bytes = declaredBodyBytes(req);
  if (bytes === null) {
    throw new UploadRefused(411, 'Content-Length is not a number of bytes.');
  }
  if (bytes > CSV_IMPORT_MAX_BYTES) {
    throw new UploadRefused(413, 'That file is larger than the 5 MiB import limit.');
  }
}

/**
 * The body, capped. `Content-Length` is the caller's word for it; this is the
 * part that does not take their word.
 */
async function readCappedText(req: Request): Promise<string> {
  const text = await readCappedBody(req, CSV_IMPORT_MAX_BYTES);
  if (text === null) {
    throw new UploadRefused(413, 'That file is larger than the 5 MiB import limit.');
  }
  return text;
}

/** The file, sent as a raw `text/csv` body. */
async function readUpload(req: Request): Promise<Upload | null> {
  // Checked before the length or the body: a caller sending the wrong shape
  // entirely (a browser form, a JSON blob) is told so without this route
  // first pretending to care how many bytes it declared.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.startsWith('text/csv')) {
    throw new UploadRefused(415, 'Send the file contents as text/csv');
  }

  assertDeclaredSizeIsSane(req);
  const text = await readCappedText(req);
  if (text.trim() === '') return null;
  return { text };
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
    // Nothing below this line is expected to throw anything else, but an
    // empty body is the caller's mistake either way, not a fault here.
    upload = null;
  }
  if (!upload) {
    return badRequest('No CSV file. Send the file contents as a text/csv body.');
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
        // A raw text/csv body carries no filename; unlike a form post, there
        // is no field to read one from.
        filename: null,
        rowCount: items.length + parsed.errors.length,
        // A guess made off the parsed file alone - the route cannot yet know
        // which rows the cross-batch dedupe index (spec §7) will drop.
        // `importCsvBatch` corrects the persisted batch once the insert has
        // run, and the response below reads its real counts back, not these.
        insertedCount: items.length,
        skippedCount: parsed.errors.length,
      },
      rows: items,
      provider: 'csv',
    });

    return NextResponse.json({
      // `batch.insertedCount`/`skippedCount`, not `items.length` /
      // `parsed.errors.length`: a row that parsed fine can still have been
      // skipped as a duplicate of an earlier import, and only the batch -
      // reconciled against what the insert actually returned - knows that.
      inserted: batch.insertedCount,
      skipped: batch.skippedCount,
      errors: parsed.errors,
      batchId: batch.id,
    });
  } catch (error) {
    // No CSV row carries a project id, so this cannot fire today. The mapping
    // is here for parity with every other write: a reference to a project that
    // is not the caller's is a bad request, not a server fault.
    if (error instanceof UnknownProjectError) return badRequest(error.message);
    // Never the raw error object: a driver error carries the failing `query`
    // and its `parameters` - the caller's own transaction rows - as enumerable
    // properties, and logging the object spills them (Phase 5 audit). The
    // stack is kept, because a 500 on somebody else's CSV is unreproducible
    // without one, and it says nothing the message does not already say.
    console.error(
      'Failed to import CSV:',
      error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
    );
    return NextResponse.json({ error: 'Failed to import the file' }, { status: 500 });
  }
}
