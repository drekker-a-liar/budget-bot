import Papa from 'papaparse';

/**
 * Reading a CSV file into records that still know which line they came from.
 *
 * papaparse does the field parsing - quoting, escaped quotes, CRLF, newlines
 * inside quoted fields - which is the whole reason this package exists. What
 * it does not hand back is the line number of a record, and that is the number
 * the user needs when a row is rejected: they are looking at the file, not at
 * the parser's record index.
 *
 * So the parse is run with neither `header` nor `skipEmptyLines`. Every record
 * is then in one-to-one correspondence with the text it consumed, the cursor
 * papaparse reports after each one gives its extent, and counting newlines
 * across those extents gives an exact line number even when a quoted field
 * spans several lines. Header detection and blank-row skipping happen here
 * instead, over records that have already been numbered.
 */

export interface CsvRecord {
  /** 1-based line in the file the user uploaded. */
  line: number;
  fields: string[];
}

/** Excel writes a byte-order mark; it would otherwise become part of the first header. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) count++;
  }
  return count;
}

/** Blank, whitespace-only, and `,,,` rows: nothing a bank meant to say. */
export function isBlank(record: CsvRecord): boolean {
  return record.fields.every((field) => field.trim() === '');
}

/** Every record in the file, in order, each carrying the line it starts on. */
export function readRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cursor = 0;
  let line = 1;

  Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    step: (result) => {
      records.push({ line, fields: result.data });
      line += countNewlines(text.slice(cursor, result.meta.cursor));
      cursor = result.meta.cursor;
    },
  });

  return records;
}
