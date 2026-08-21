/**
 * Money is integer cents everywhere inside the domain (ADR 0007). Floats in
 * dollars drift on the very operations this product is built from - every
 * metric is a sum or a difference - so dollars exist only either side of this
 * module: `parseMoney` at every import boundary, `formatCents` at display.
 */

declare const centsBrand: unique symbol;

/** A whole number of cents. Construct one with `parseMoney`. */
export type Cents = number & { readonly [centsBrand]: 'Cents' };

export interface FormatCentsOptions {
  /** Default true. When false, rounds to whole dollars. */
  showCents?: boolean;
}

const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/;
const PARENTHESISED = /^\((.*)\)$/;

const formatters = new Map<boolean, Intl.NumberFormat>();

/**
 * Rounds half away from zero, the convention every finance library calls
 * HALF_UP. `Math.round` breaks ties toward +Infinity, which would round a
 * -2.5 cent result to -2 while rounding 2.5 to 3.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function invalid(input: string | number): Error {
  return new Error(`Invalid money value: ${JSON.stringify(input)}`);
}

/**
 * Converts a decimal amount in dollars - a form field, a CSV cell, a Plaid
 * amount - into cents, rounding half away from zero.
 *
 * Accepts a leading sign, a `$`, thousands separators, surrounding space, and
 * the parenthesised negatives that bank and accounting exports write
 * (`'(114.75)'`). Digits are read out of the decimal string rather than
 * multiplied by 100, so `'1.005'` rounds up to 101 where
 * `Math.round(1.005 * 100)` gives 100.
 */
export function parseMoney(input: string | number): Cents {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw invalid(input);
    // Three decimals: enough to see the digit that decides the rounding, few
    // enough that binary representation noise has been rounded away.
    text = input.toFixed(3);
  } else {
    // `$` and thousands separators anywhere, surrounding space only: an
    // interior space means two values ran together, not one amount.
    text = input.replace(/[$,]/g, '').trim();
  }

  // Accounting notation: (114.75) is -114.75. A sign inside the parentheses
  // is malformed rather than a double negative, so it is rejected below.
  const parenthesised = PARENTHESISED.exec(text);
  if (parenthesised) text = parenthesised[1].trim();

  const match = DECIMAL.exec(text);
  if (!match) throw invalid(input);

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') throw invalid(input);
  if (parenthesised && sign) throw invalid(input);

  const padded = fraction.padEnd(3, '0');
  const magnitude =
    Number(whole || '0') * 100 +
    Number(padded.slice(0, 2)) +
    (padded.charCodeAt(2) >= 53 /* '5' */ ? 1 : 0);

  if (!Number.isSafeInteger(magnitude)) throw invalid(input);

  const negative = sign === '-' || parenthesised !== null;
  return (negative ? -magnitude : magnitude) as Cents;
}

/** Renders cents as en-US currency, e.g. `$1,234.56`. */
export function formatCents(cents: Cents, options: FormatCentsOptions = {}): string {
  const showCents = options.showCents ?? true;
  let formatter = formatters.get(showCents);
  if (!formatter) {
    const digits = showCents ? 2 : 0;
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(showCents, formatter);
  }
  return formatter.format(cents / 100);
}

export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total as Cents;
}

export function subtractCents(minuend: Cents, subtrahend: Cents): Cents {
  return (minuend - subtrahend) as Cents;
}

/** Scales an amount by a plain number - a quantity, a rate, a share. */
export function multiplyCents(cents: Cents, factor: number): Cents {
  return roundHalfAwayFromZero(cents * factor) as Cents;
}

/**
 * A ratio of two amounts as a percentage with one decimal place, or null when
 * there is no ratio to report because the denominator is zero.
 */
export function percent(numerator: Cents, denominator: Cents): number | null {
  if (denominator === 0) return null;
  return roundHalfAwayFromZero((numerator / denominator) * 1000) / 10;
}
