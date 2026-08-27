# Phase 4 — Monthly Gross Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monthly gross margin in $ and %, cash basis, on a `/margin` page fed by live data.

**Architecture:** A pure core function buckets paid invoices / posted costs / labor into timezone-aware months; an owner-scoped cached query feeds a hand-rolled SVG chart island on a protected RSC page.

**Tech Stack:** d3-scale + d3-shape (only new deps), existing severity CSS tokens, Vitest + Playwright.

**Spec:** docs/superpowers/specs/2026-08-25-phase-4-monthly-margin-design.md (binding; §ns below refer to it)

## Global Constraints

- Money is integer cents end-to-end (branded `Cents`); display only via `formatCents`.
- `marginPct` is null at zero revenue — never a fabricated sentinel (Phase 1 precedent).
- Core stays pure: no `new Date()`, no node/react imports; range + timeZone are parameters.
- Every repo function is `(db, ownerId, …)` owner-scoped with explicit projections.
- Every new/modified `.tsx` ships a colocated `*.test.tsx` (structural test enforces); `/margin` must be pinned protected by route-gating.
- Severity thresholds come from `packages/core/src/metrics/thresholds.ts` — no new literals.
- New deps: `d3-scale`, `d3-shape` (+ their @types) in apps/web only, caret-ranged.
- TDD; full `pnpm turbo lint typecheck test build` green before each task's final commit; commit trailers:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YUSyUXym8v2cn2YiJ2Jo2r

---

### Task 1: `calculateMonthlyMargins` in core

**Files:** Create `packages/core/src/metrics/monthly.ts`; export from core index; Test `packages/core/test/metrics/monthly.test.ts` (follow the existing core test layout — read a neighbor first).
**Interfaces:** Produces the spec §2 signature and `MonthlyMargin` type exactly (exported). Consumes existing `Invoice`/`Transaction`/`LaborEntry` core types, `thresholds.ts`, categorizer's category identifiers (read `categorizer.ts` for the overhead/materials/subcontractor category names — do not invent strings).
Spec §2 is the requirement list; §5's core cases are the mandatory test matrix (incl. the America/Los_Angeles month-edge case). Bucketing: date strings → first 7 chars; `postedAt` Date → `Intl.DateTimeFormat('en-CA', {timeZone, year, month})`-derived `YYYY-MM`.

### Task 2: Query layer + repos

**Files:** Create `apps/web/src/server/queries/margin.ts`; Modify repos in `packages/db/src/repos/{invoices,transactions,labor}.ts` ONLY where no range-scoped list exists; Test colocated per repo convention + `apps/web/test/margin-query.test.ts` (real DB, two owners).
**Interfaces:** Produces `getMonthlyMargins(ownerId): Promise<{months: MonthlyMargin[], timeZone: string}>` (trailing 12 full months + MTD; "now" derived once at the query edge, passed down — core stays pure). Reads `users.settings.timeZone` (jsonb) with `'UTC'` default; seed gains `'America/Los_Angeles'` for the demo owner if the seed touches settings (check `packages/db/src/seed/`).
Tests: owner isolation; range windows (a 13-month-old invoice excluded); timeZone default vs set.

### Task 3: `MonthlyMarginChart`

**Files:** Create `apps/web/components/MonthlyMarginChart.tsx` + colocated test; add d3-scale/d3-shape deps.
**Interfaces:** Props `{months: MonthlyMargin[], caption?: string}` — presentational only, no fetching. Spec §4 is the visual contract (muted revenue bars, severity-token margin bars, right-axis % line skipping null months, dashed 45/25 references, MTD hatch, KPI header, verbatim caption, empty state).
Component tests from props per spec §5 (bar counts, class names from severity tokens, no line point for null-pct month, empty state text).

### Task 4: `/margin` page + nav

**Files:** Create `apps/web/app/margin/{page.tsx,MarginView.tsx}` + island test; Modify `Navigation` component (+ its test) for the "Margin" entry; Modify `apps/web/test/route-gating.test.ts` (protected).
**Interfaces:** RSC awaits `getMonthlyMargins`, passes to `MarginView` island wrapping the chart. Follow the existing page/island/query pattern (read `/cashflow`).

### Task 5: e2e step + docs

**Files:** Extend `apps/web/e2e/smoke.spec.ts` (one step: nav → Margin → KPI header renders against seed); CHANGELOG entry `## v0.4.0-margin — unreleased`; README feature list line. Keep all existing e2e steps passing (16 total after).

---

Each task: failing test → minimal code → green → commit; full turbo suite before final commit.
