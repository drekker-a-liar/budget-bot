# ADR 0006 — Monthly gross margin is computed on a cash basis

**Status:** Accepted · 2026-08-20

## Context

The first analytics feature is monthly gross margin in dollars and percent. Three rules were considered for which month revenue and cost land in: cash basis (when paid / when posted), accrual by invoice issue date, and allocation by project completion.

## Decision

**Cash basis.**

- Revenue lands in the month of `invoice.paidDate`, only for invoices with `status === 'paid'`. Unpaid invoices appear in receivables, never in margin.
- Costs land in the month of `transaction.postedAt ?? transaction.date`. Pending bank transactions are excluded until posted. `status === 'ignored'` rows are excluded. `category === 'overhead'` is excluded because the chart is *gross* margin.
- Labor lands in the month of the labor entry, valued at `hours × hourlyRateCents`.
- Months are zero-filled across the requested range; `marginPct` is `null` (not `0`) when revenue is zero.

## Consequences

- Matches how a sole proprietor reasons ("what came in and went out this month") and how Schedule C is filed.
- Known artifact: materials bought in July for a job paid in August depress July and inflate August. A trailing-3-month figure in the tooltip and the 12-month view soften this, and the chart carries the caption "Cash basis: paid invoices vs. posted costs".
- Accrual and per-project views remain available through the existing project KPIs; this ADR governs only the monthly chart.
