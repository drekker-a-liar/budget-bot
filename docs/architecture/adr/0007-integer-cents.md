# ADR 0007 — Money is stored and computed as integer cents

**Status:** Accepted · 2026-08-20

## Context

The prototype stores money as JavaScript floats in dollars. Every metric is a sum or difference, which drifts in floating point (`114.75 + 146.30`). Postgres `numeric` maps to `string` in Drizzle, pushing a parse onto every read.

## Decision

- All monetary values are **integer cents**: Postgres `bigint` (Drizzle `mode: 'number'`), TypeScript branded type `Cents`.
- Exactly one conversion in each direction: `parseMoney(decimalString): Cents` at import boundaries (Plaid, CSV, forms) and `formatCents(cents, opts)` at display.
- Percentages remain `number` with one decimal, computed from cents. Hours remain `number` with two decimals. Rates become `*RateCents`.

## Consequences

- Sums are exact; tests can assert equality.
- JS `number` is safe far beyond any realistic revenue (2^53 cents ≈ $90 trillion).
- The one-time migration from the JSON prototype multiplies by 100 and rounds.
