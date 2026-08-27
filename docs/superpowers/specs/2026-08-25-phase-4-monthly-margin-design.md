# Phase 4 — Monthly Gross Margin

**Date:** 2026-08-25
**Status:** Approved (architecture fixed in Phase 1 spec §"Monthly gross margin"; ADR 0006 cash basis, ADR 0007 integer cents; start authorized by Tyler 2026-08-25)
**Builds on:** Phases 1-3 (main @ 7babae3d).

## 1. Goal

The product's first analytics feature: **monthly gross margin in dollars and as
a percentage**, cash basis, on its own page, from the data the connectors now
keep fresh.

**In scope:** `calculateMonthlyMargins` in core; the owner-scoped query layer
feeding it; `MonthlyMarginChart` (hand-rolled SVG + d3-scale/d3-shape); a
`/margin` page with nav entry; timezone-aware month bucketing; e2e step; docs.

**Out of scope:** moving `calculateWeeklyCashFlow` into core (works where it
is); forecasting; accrual basis; CSV/uncategorized-cost UX changes; per-project
margin drilldowns.

## 2. Core function (Phase 1 spec fixed this signature)

```ts
calculateMonthlyMargins({ invoices, transactions, laborEntries, range: {start, end}, timeZone }): MonthlyMargin[]
// MonthlyMargin { month: 'YYYY-MM', revenueCents, cogs: {materials, labor, subcontractor, otherDirect, total}, marginCents, marginPct | null, severity | 'none', counts }
```

Cash basis (ADR 0006): revenue = invoices with `status === 'paid'` bucketed by
`paidDate`; costs = transactions that are not `status: 'ignored'`, not
overhead-categorized, not pending, bucketed by `postedAt ?? date`; labor by
entry date. Pure function, no `new Date()` — range and timeZone are inputs.
Months in range are zero-filled; `marginPct` is null when revenue is zero
(never a fabricated number — same rule as Phase 1's realization fix); severity
from the existing 45/25 thresholds in `metrics/thresholds.ts`, `'none'` when
marginPct is null. COGS categories map from the existing categorizer's category
set: materials, labor (labor entries), subcontractor, otherDirect (everything
else non-overhead). `counts` = {invoices, transactions, laborEntries}
contributing to that month.

Timezone: `YYYY-MM-DD` strings bucket by their first 7 chars (no tz math);
`postedAt` timestamps bucket via `Intl.DateTimeFormat` with the given
`timeZone`. The owner's zone comes from `users.settings.timeZone`, defaulting
to `'UTC'` when unset; the demo seed sets `'America/Los_Angeles'`.

## 3. Query layer

`apps/web/src/server/queries/margin.ts`: owner-scoped, wrapped in React
`cache()` like the neighbors; fetches paid invoices, non-ignored posted
transactions, and labor entries for the trailing 12 full months + MTD, reads
the owner's timeZone, calls the core function. Repos gain range-scoped list
functions only where none exist (explicit projections, `(db, ownerId, …)`).

## 4. Chart and page

`MonthlyMarginChart` in `apps/web/components` (there is no packages/ui):
hand-rolled SVG sized by viewBox, scales from `d3-scale`, line via `d3-shape`
(these two packages are the only new deps, caret-ranged). Revenue bars muted
behind margin-$ bars filled with `var(--severity-*)` tokens; margin-% line on
the right axis; dashed reference lines at 45% and 25%; current month hatched
and labeled "MTD"; a trailing-12-month KPI header (total revenue, total
margin $, blended margin %); caption verbatim: "Cash basis: paid invoices vs.
posted costs." Renders an honest empty state ("No paid invoices yet") rather
than a zero chart when every month is empty. No tooltip library — a
`<title>` per bar is enough at this stage.

`/margin` page: async RSC awaiting the query, chart as its island, nav entry
labeled "Margin" with the existing active-link treatment. Standing rule: every
new `.tsx` ships its colocated test.

## 5. Testing

Core: fixture-driven months (paid vs unpaid invoices, pending excluded,
ignored excluded, overhead excluded, negative rows excluded by their ignored
default, zero-fill, null marginPct at zero revenue, severity at 45/44.9/25/24.9,
timezone edge — a postedAt late on the last UTC day of a month lands in the
prior month for America/Los_Angeles). Query: owner isolation, range windows,
timeZone default vs setting. Chart: component tests from props (bar count,
severity classes, null-pct month renders no line point, MTD hatch, empty
state). Page: island test + route-gating pins `/margin` as protected. e2e: one
step — navigate to Margin, assert the KPI header renders against seeded data.
