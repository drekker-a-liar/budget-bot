import { describe, expect, it } from 'vitest';
import { CsvProvider, NotSupportedError } from '../../src';

/**
 * The CSV provider replaces a hand-rolled `split(',')` that read
 * `"ACE HARDWARE, INC",1,234.56` as four columns and stored $1.00. Everything
 * here is a real export shape from a real bank: quoted commas, CRLF line
 * endings, a byte-order mark, separate Debit and Credit columns, and
 * accounting parentheses for negatives.
 *
 * The other rule these tests exist for is line numbers. When a row is
 * rejected, the number reported has to be the line in the file the user is
 * looking at - counted before blank lines are dropped, and counted in lines
 * rather than in records, because a quoted field may contain a newline.
 */

const ACCOUNT = 'csv-upload';

function parse(text: string) {
  return CsvProvider.parse(text, { accountExternalId: ACCOUNT });
}

describe('CsvProvider.parse', () => {
  it('reads the ordinary Date/Description/Amount export', () => {
    const { rows, errors } = parse(
      [
        'Date,Description,Amount',
        '2026-08-18,THE HOME DEPOT #0421,114.75',
        '2026-08-19,SHERWIN-WILLIAMS,146.30',
      ].join('\n')
    );

    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.date, r.rawDescriptor, r.amountCents])).toEqual([
      ['2026-08-18', 'THE HOME DEPOT #0421', 11475],
      ['2026-08-19', 'SHERWIN-WILLIAMS', 14630],
    ]);
  });

  it('keeps a quoted comma inside the description, and the amount whole', () => {
    // The defect this package exists to fix: one description, one amount.
    const { rows, errors } = parse(
      'Date,Description,Amount\n2026-08-18,"ACE HARDWARE, INC","1,234.56"'
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rawDescriptor).toBe('ACE HARDWARE, INC');
    expect(rows[0].amountCents).toBe(123456);
  });

  it('reads an unquoted thousands separator as part of the amount too', () => {
    const { rows } = parse('Date,Description,Amount\n2026-08-18,ACE HARDWARE,"1,234.56"');

    expect(rows[0].amountCents).toBe(123456);
  });

  it('reads a file written with CRLF line endings', () => {
    const { rows, errors } = parse(
      'Date,Description,Amount\r\n2026-08-18,THE HOME DEPOT,114.75\r\n'
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rawDescriptor).toBe('THE HOME DEPOT');
  });

  it('reads a file that starts with a byte-order mark', () => {
    // Excel writes one. Without stripping it the first header carries the mark
    // as part of its name and the whole file looks like it has no date column.
    const { rows, errors } = parse('\uFEFFDate,Description,Amount\n2026-08-18,LOWES,10.00');

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['Transaction Date', 'Transaction Date,Description,Amount'],
    ['Posted Date', 'Posted Date,Description,Amount'],
    ['lower case', 'date,description,amount'],
    ['padded', ' Date , Description , Amount '],
    ['Memo', 'Date,Memo,Amount'],
    ['Payee', 'Date,Payee,Amount'],
  ])('recognises the %s header variant', (_name, header) => {
    const { rows, errors } = parse(`${header}\n2026-08-18,THE HOME DEPOT,114.75`);

    expect(errors).toEqual([]);
    expect(rows[0].rawDescriptor).toBe('THE HOME DEPOT');
    expect(rows[0].amountCents).toBe(11475);
  });

  it('reads columns by name, whatever order the bank put them in', () => {
    const { rows } = parse('Amount,Date,Memo\n114.75,2026-08-18,THE HOME DEPOT');

    expect(rows[0]).toMatchObject({
      date: '2026-08-18',
      rawDescriptor: 'THE HOME DEPOT',
      amountCents: 11475,
    });
  });

  it('reads a separate Debit and Credit pair, debit being money out', () => {
    const { rows, errors } = parse(
      [
        'Date,Description,Debit,Credit',
        '2026-08-18,THE HOME DEPOT,114.75,',
        '2026-08-19,PAYMENT THANK YOU,,500.00',
      ].join('\n')
    );

    expect(errors).toEqual([]);
    expect(rows.map((r) => r.amountCents)).toEqual([11475, -50000]);
  });

  it('reads accounting parentheses as the negative they are', () => {
    const { rows } = parse('Date,Description,Amount\n2026-08-18,REFUND,(114.75)');

    expect(rows[0].amountCents).toBe(-11475);
  });

  it('keeps negatives rather than folding them to a magnitude', () => {
    // Positive is money out. A card payment is money in and stays negative, so
    // that the application can file it as ignored instead of double-counting.
    const { rows } = parse('Date,Description,Amount\n2026-08-18,AUTOPAY,-1250.00');

    expect(rows[0].amountCents).toBe(-125000);
  });

  it('reads the pending flag out of a Posted or Status column', () => {
    const { rows } = parse(
      [
        'Date,Description,Amount,Status',
        '2026-08-18,SETTLED CHARGE,10.00,Posted',
        '2026-08-19,STILL AUTHORIZING,20.00,Pending',
      ].join('\n')
    );

    expect(rows.map((r) => r.pending)).toEqual([false, true]);
  });

  it('treats a row with no status column as posted', () => {
    const { rows } = parse('Date,Description,Amount\n2026-08-18,A CHARGE,10.00');

    expect(rows[0].pending).toBe(false);
  });

  describe('the rows it refuses', () => {
    it('names the line in the file, not the position among the good rows', () => {
      const { rows, errors } = parse(
        [
          'Date,Description,Amount', // line 1
          '2026-08-18,GOOD ROW,10.00', // line 2
          '08/18/2026,BAD DATE,10.00', // line 3
          '2026-08-19,UNREADABLE AMOUNT,N/A', // line 4
          '2026-08-20,ANOTHER GOOD ROW,20.00', // line 5
        ].join('\n')
      );

      expect(rows).toHaveLength(2);
      expect(errors.map((e) => e.line)).toEqual([3, 4]);
      expect(errors[0].reason).toMatch(/date/i);
      expect(errors[1].reason).toMatch(/amount/i);
    });

    it('counts blank lines, because the user can see them', () => {
      // The old importer filtered blanks and then numbered what was left, so
      // every reported line was wrong from the first empty line onwards.
      const { errors } = parse(
        [
          'Date,Description,Amount', // 1
          '', // 2
          '2026-08-18,GOOD ROW,10.00', // 3
          '   ', // 4
          ',,', // 5
          '08/18/2026,BAD DATE,10.00', // 6
        ].join('\n')
      );

      expect(errors).toEqual([{ line: 6, reason: expect.stringMatching(/date/i) }]);
    });

    it('counts a newline inside a quoted field as the line it is', () => {
      const { rows, errors } = parse(
        [
          'Date,Description,Amount', // 1
          '2026-08-18,"MULTI', // 2
          'LINE DESCRIPTOR",10.00', // 3
          '08/18/2026,BAD DATE,10.00', // 4
        ].join('\n')
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].rawDescriptor).toBe('MULTI\nLINE DESCRIPTOR');
      expect(errors.map((e) => e.line)).toEqual([4]);
    });

    it('refuses a zero amount rather than importing a receipt for nothing', () => {
      const { rows, errors } = parse('Date,Description,Amount\n2026-08-18,VOIDED,0.00');

      expect(rows).toEqual([]);
      expect(errors).toEqual([{ line: 2, reason: expect.stringMatching(/zero/i) }]);
    });

    it('refuses a row with no description', () => {
      const { errors } = parse('Date,Description,Amount\n2026-08-18,,10.00');

      expect(errors[0].reason).toMatch(/description/i);
    });

    it('imports the readable rows and reports the rest, rather than failing the file', () => {
      const { rows, errors } = parse(
        [
          'Date,Description,Amount',
          '2026-08-18,THE HOME DEPOT #0421,114.75',
          '2026-08-18,BROKEN ROW,N/A',
          '2026-08-19,SHERWIN-WILLIAMS,146.30',
        ].join('\n')
      );

      expect(rows.map((r) => r.amountCents)).toEqual([11475, 14630]);
      expect(errors).toHaveLength(1);
    });

    it('says so when the file has no header it recognises', () => {
      expect(() => parse('Column A,Column B,Column C\n1,2,3')).toThrow(
        /date|description|amount/i
      );
    });

    it('says so when the file is empty', () => {
      expect(() => parse('   \n\n')).toThrow(/empty/i);
    });
  });

  describe('externalId', () => {
    it('is the same for the same row read twice', () => {
      const text = 'Date,Description,Amount\n2026-08-18,THE HOME DEPOT,114.75';

      expect(parse(text).rows[0].externalId).toBe(parse(text).rows[0].externalId);
    });

    it('is hex, and long enough not to collide by accident', () => {
      const { rows } = parse('Date,Description,Amount\n2026-08-18,THE HOME DEPOT,114.75');

      expect(rows[0].externalId).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['the date', 'Date,Description,Amount\n2026-08-19,THE HOME DEPOT,114.75'],
      ['the amount', 'Date,Description,Amount\n2026-08-18,THE HOME DEPOT,114.76'],
      ['the descriptor', 'Date,Description,Amount\n2026-08-18,LOWES,114.75'],
    ])('differs when %s differs', (_name, other) => {
      const base = parse('Date,Description,Amount\n2026-08-18,THE HOME DEPOT,114.75');

      expect(parse(other).rows[0].externalId).not.toBe(base.rows[0].externalId);
    });

    it('differs when the account differs', () => {
      const text = 'Date,Description,Amount\n2026-08-18,THE HOME DEPOT,114.75';

      expect(
        CsvProvider.parse(text, { accountExternalId: 'other-account' }).rows[0].externalId
      ).not.toBe(parse(text).rows[0].externalId);
    });

    it('collapses a row the file repeats, keeping the first of them', () => {
      // Statements sometimes overlap at the boundary, or a user exports the
      // same month twice into one file. Two identical rows are one charge.
      const { rows } = parse(
        [
          'Date,Description,Amount',
          '2026-08-18,THE HOME DEPOT,114.75',
          '2026-08-18,LOWES,20.00',
          '2026-08-18,THE HOME DEPOT,114.75',
        ].join('\n')
      );

      expect(rows.map((r) => r.rawDescriptor)).toEqual(['THE HOME DEPOT', 'LOWES']);
    });

    it('keeps two charges that only look alike but are not', () => {
      const { rows } = parse(
        [
          'Date,Description,Amount',
          '2026-08-18,THE HOME DEPOT,114.75',
          '2026-08-18,THE HOME DEPOT,114.76',
        ].join('\n')
      );

      expect(rows).toHaveLength(2);
    });
  });

  it('fills the fields a file cannot know with nulls rather than with guesses', () => {
    const { rows } = parse('Date,Description,Amount\n2026-08-18,THE HOME DEPOT,114.75');

    expect(rows[0]).toMatchObject({
      accountExternalId: ACCOUNT,
      postedAt: null,
      authorizedDate: null,
      merchantName: null,
      pendingTransactionId: null,
      categoryHintPrimary: null,
      categoryHintDetailed: null,
      isoCurrencyCode: null,
    });
  });
});

describe('the rest of the BankProvider contract', () => {
  it('identifies itself as the csv provider', () => {
    expect(CsvProvider.id).toBe('csv');
  });

  it.each([
    ['createLinkToken', () => CsvProvider.createLinkToken({ userId: 'user-1' })],
    ['exchangePublicToken', () => CsvProvider.exchangePublicToken('public-token')],
    ['getAccounts', () => CsvProvider.getAccounts('access-token')],
    ['syncTransactions', () => CsvProvider.syncTransactions('access-token', null)],
    ['removeItem', () => CsvProvider.removeItem('access-token')],
    ['verifyAndParseWebhook', () => CsvProvider.verifyAndParseWebhook('{}', {})],
  ])('refuses %s, naming itself and the operation', async (operation, call) => {
    // A file has no token, no live account and nothing to sync from. Refusing
    // out loud beats returning an empty page that reads as "nothing changed".
    await expect(call()).rejects.toThrow(NotSupportedError);
    await expect(call()).rejects.toThrow(new RegExp(operation));
  });
});
