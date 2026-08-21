import { parseMoney, type Cents } from '@budget-bot/core';

/**
 * Thrown when a request body carries a money field the domain cannot read.
 * Routes translate this into a 400: the client sent something wrong, and
 * saying so beats storing a silent $0.
 */
export class InvalidMoneyFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyFieldError';
  }
}

export interface ReadCentsOptions {
  /** When true, an absent value reads as `fallbackDollars` instead of erroring. */
  optional?: boolean;
  /** Dollars to use when an optional field is absent. Defaults to 0. */
  fallbackDollars?: number;
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * The one contract every API route uses to read a money field out of an
 * untrusted request body (ADR 0007: one parseMoney at the boundary).
 *
 * Routes used to write `parseMoney(Number(value) || 0)`, which threw away
 * parseMoney's string handling - `Number('1,234.56')` is NaN - and then turned
 * that NaN into a silent $0. A value that is present but unreadable is a
 * client error, not a zero.
 */
export function readCents(
  value: unknown,
  field: string,
  options: ReadCentsOptions = {}
): Cents {
  if (isAbsent(value)) {
    if (!options.optional) {
      throw new InvalidMoneyFieldError(`Missing amount for ${field}`);
    }
    return parseMoney(options.fallbackDollars ?? 0);
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new InvalidMoneyFieldError(`Invalid amount for ${field}`);
  }

  try {
    return parseMoney(value);
  } catch {
    throw new InvalidMoneyFieldError(`Invalid amount for ${field}`);
  }
}
