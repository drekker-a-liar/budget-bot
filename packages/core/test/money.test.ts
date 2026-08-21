import { describe, expect, it } from 'vitest';
import {
  addCents,
  formatCents,
  multiplyCents,
  parseMoney,
  percent,
  subtractCents,
} from '../src/money';

describe('parseMoney', () => {
  it('is exact where floats are not', () => {
    expect(parseMoney('0.1') + parseMoney('0.2')).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3); // the reason this module exists
  });

  it.each([
    ['0', 0],
    ['5', 500],
    ['-5', -500],
    ['0.07', 7],
    ['.5', 50],
    ['5.', 500],
    ['1,234.56', 123456],
    ['$12.30', 1230],
    ['  $ 1,234.56  ', 123456],
    ['-$1,234.56', -123456],
    ['+7.25', 725],
  ])('parses %s as %d cents', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each([
    [0.1, 10],
    [1234.56, 123456],
    [25000, 2500000],
    [-78.45, -7845],
    [0.1 + 0.2, 30], // 0.30000000000000004
  ])('parses the number %d as %d cents', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  // Bank and accounting exports write negatives in parentheses.
  it.each([
    ['(114.75)', -11475],
    ['(1,234.56)', -123456],
    ['($12.30)', -1230],
    ['  ( 0.07 )  ', -7],
  ])('reads the accounting negative %s as %d cents', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['(-5)', '(+5)', '(114.75', '114.75)', '()'])(
    'rejects the malformed parenthesised amount %s',
    (input) => {
      expect(() => parseMoney(input)).toThrow(/money/i);
    }
  );

  it.each([
    ['1.004', 100],
    ['1.0049999', 100],
    ['1.005', 101],
    ['1.0050001', 101],
    ['12.999', 1300],
    ['-1.005', -101], // half away from zero, like BigDecimal HALF_UP
    ['-1.004', -100],
  ])('rounds %s half away from zero to %d cents', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('rounds the float 1.005 up, which naive Math.round(x * 100) does not', () => {
    expect(parseMoney(1.005)).toBe(101);
    expect(Math.round(1.005 * 100)).toBe(100); // 1.005 * 100 === 100.49999999999999
  });

  it.each(['', '   ', 'abc', '1.2.3', '$', '-', '1 234', NaN, Infinity, -Infinity])(
    'rejects %s',
    (input) => {
      expect(() => parseMoney(input as string | number)).toThrow(/money/i);
    }
  );

  it('rejects amounts too large to hold exactly in cents', () => {
    expect(() => parseMoney('99999999999999999999')).toThrow(/money/i);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '$0.00'],
    [7, '$0.07'],
    [1230, '$12.30'],
    [123456, '$1,234.56'],
    [250000000, '$2,500,000.00'],
    [-123456, '-$1,234.56'],
  ])('formats %d cents as %s', (cents, expected) => {
    expect(formatCents(parseMoney(cents / 100))).toBe(expected);
  });

  it('drops the cents on request, rounding to the nearest dollar', () => {
    expect(formatCents(parseMoney('1234.56'), { showCents: false })).toBe('$1,235');
    expect(formatCents(parseMoney('1234.49'), { showCents: false })).toBe('$1,234');
    expect(formatCents(parseMoney('0'), { showCents: false })).toBe('$0');
  });
});

describe('addCents / subtractCents / multiplyCents', () => {
  it('adds any number of amounts, exactly', () => {
    expect(addCents(parseMoney('0.1'), parseMoney('0.2'))).toBe(30);
    expect(addCents(parseMoney('114.75'), parseMoney('146.30'))).toBe(26105);
    expect(addCents()).toBe(0);
    expect(addCents(parseMoney('1'))).toBe(100);
  });

  it('subtracts', () => {
    expect(subtractCents(parseMoney('4500'), parseMoney('4231.95'))).toBe(26805);
  });

  it('multiplies by a plain factor and rounds half away from zero', () => {
    expect(multiplyCents(parseMoney('85'), 8)).toBe(68000);
    expect(multiplyCents(parseMoney('10'), 1.5)).toBe(1500);
    expect(multiplyCents(parseMoney('1.01'), 1 / 3)).toBe(34); // 33.666...
    expect(multiplyCents(parseMoney('0.05'), 0.5)).toBe(3); // 2.5 -> 3
    expect(multiplyCents(parseMoney('-0.05'), 0.5)).toBe(-3); // -2.5 -> -3
  });
});

describe('percent', () => {
  it('reports one decimal place', () => {
    expect(percent(parseMoney('25'), parseMoney('100'))).toBe(25);
    expect(percent(parseMoney('1'), parseMoney('3'))).toBe(33.3);
    expect(percent(parseMoney('1809.25'), parseMoney('6800'))).toBe(26.6);
    expect(percent(parseMoney('-1'), parseMoney('3'))).toBe(-33.3);
  });

  it('is null when the denominator is zero, rather than Infinity or NaN', () => {
    expect(percent(parseMoney('100'), parseMoney('0'))).toBeNull();
    expect(percent(parseMoney('0'), parseMoney('0'))).toBeNull();
  });
});
