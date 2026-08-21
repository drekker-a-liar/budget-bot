import { describe, expect, it } from 'vitest';
import { InvalidMoneyFieldError, readCents } from '@/lib/readCents';

describe('readCents', () => {
  it.each([
    [12.3, 1230],
    ['12.30', 1230],
    ['1,234.56', 123456],
    ['$1,234.56', 123456],
    ['(114.75)', -11475],
    ['-5', -500],
    [0, 0],
    ['0', 0],
  ])('reads %s as %d cents', (value, expected) => {
    expect(readCents(value, 'amount')).toBe(expected);
  });

  // The bug this replaces: every route but one wrapped the value in
  // `Number(...)`, which turns a comma-formatted amount into NaN and then
  // `|| 0` turned that into a silent $0.
  it('reads a comma-formatted amount rather than silently zeroing it', () => {
    expect(readCents('1,234.56', 'quotedTotal')).toBe(123456);
    expect(Number('1,234.56')).toBeNaN(); // what the old code fed to parseMoney
  });

  it.each(['abc', '', '   ', '1.2.3', 'N/A', '$', true, {}, [], NaN, Infinity])(
    'rejects %s as a present-but-unparseable value',
    (value) => {
      expect(() => readCents(value, 'quotedTotal')).toThrow(InvalidMoneyFieldError);
      expect(() => readCents(value, 'quotedTotal')).toThrow(
        'Invalid amount for quotedTotal'
      );
    }
  );

  it.each([undefined, null])('rejects %s for a required field', (value) => {
    expect(() => readCents(value, 'amount')).toThrow(InvalidMoneyFieldError);
    expect(() => readCents(value, 'amount')).toThrow('Missing amount for amount');
  });

  it.each([undefined, null])('reads %s as $0 for an optional field', (value) => {
    expect(readCents(value, 'depositAmount', { optional: true })).toBe(0);
  });

  it('uses the given fallback for an absent optional field', () => {
    expect(readCents(undefined, 'targetHourlyRate', { optional: true, fallbackDollars: 85 })).toBe(
      8500
    );
  });

  it('still rejects a present-but-unparseable optional field', () => {
    expect(() =>
      readCents('nope', 'depositAmount', { optional: true })
    ).toThrow('Invalid amount for depositAmount');
  });

  it('names the field it was reading, so the 400 tells the client what to fix', () => {
    expect(() => readCents('nope', 'quotedMaterials')).toThrow(
      'Invalid amount for quotedMaterials'
    );
    expect(() => readCents('nope', 'hourlyRate')).toThrow('Invalid amount for hourlyRate');
  });
});
