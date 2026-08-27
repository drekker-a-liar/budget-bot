# Phase 5 — Docs, Security Audit, Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production-trustworthy release: green Vercel deploy on `main`, the security/release/privacy document set, an audited codebase, and Phase 4's ledgered polish paid down.

**Spec:** docs/superpowers/specs/2026-08-26-phase-5-docs-security-production-design.md (binding; §ns below refer to it)

## Global Constraints

- Money stays integer cents; `null` means "no data", never a fabricated 0 (spec §3 extends the Phase 1 rule to the dashboard).
- Docs match the repo's existing voice — read `docs/self-hosting/vercel.md` before writing any of them.
- No secrets, keys, or real account identifiers in any committed doc; `gitleaks` and `pnpm check:security` stay green.
- Every modified `.tsx`/`.ts` keeps/gains its colocated test; full `pnpm turbo lint typecheck test build` green before each task's final commit.
- e2e stays at 16 steps, green twice back-to-back, before the phase PR.
- Commit trailers:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q2FVtjh7RWf8DMFHUY4CJL

---

### Task 1: Diagnose and fix the Vercel deploy (spec §2)

- [ ] Obtain deploy logs: `npx vercel inspect dpl_FVvq6c8rFyY75yT2ePu7vSedhw1y --logs` (needs `vercel login` by Tyler or the founder — **blocking external dependency**).
- [ ] Fix per diagnosis (env vars / root directory / repo-side defect); if repo-side, add a regression guard.
- [ ] Verify: next push to `main` reports Vercel SUCCESS.

### Task 2: Dashboard margin null-propagation (spec §3)

**Files:** `packages/core/src/metrics/business.ts` (+ its test), `packages/core/src/types.ts`, `apps/web/components/DashboardMetrics.tsx` (+ colocated test).
- [ ] `averageMarginPct: number | null` (drop the `?? 0`); severity `'none'` when null; fixtures pin zero-revenue → null/'none'.
- [ ] `DashboardMetrics` renders the `/margin` em dash treatment for null; component test pins it.

### Task 3: Seed polish (spec §3)

**Files:** `packages/db/src/seed/{index,fixtures}.ts` + seed tests.
- [ ] Settings write becomes a merge preserving unknown jsonb keys; test seeds twice with an extra key present.
- [ ] Fixture dates become month-offsets from the seed-run date (same shapes/amounts); test asserts all fixtures land inside the trailing 13-month window regardless of run date.
- [ ] Full e2e (16 steps) twice — the format-level assertions must survive the offset dates.

### Task 4: SECURITY.md + threat model (spec §4)

**Files:** Create `SECURITY.md`, `docs/architecture/threat-model.md`.
- [ ] SECURITY.md: supported versions (main), GitHub private vulnerability reporting, honest response expectations, fail-closed posture with ADR pointers.
- [ ] Threat model: assets, single-owner trust model, boundaries, threats+mitigations (ADR 0002/0003, Phase 3 webhook verification), explicit non-goals.

### Task 5: Security audit (spec §4)

- [ ] Audit routes/repos/secrets/webhooks/injection against the threat model.
- [ ] Fix findings in-phase or ledger with reasons; record date + outcome in threat-model.md.

### Task 6: Release + deployment collateral (spec §5)

**Files:** Create `docs/release-checklist.md`, `docs/self-hosting/privacy-template.md`; Modify `docs/self-hosting/vercel.md` §"Going live", `README.md`.
- [ ] Release checklist (suite twice, CHANGELOG, tag, deploy verify, post-deploy smoke, rollback).
- [ ] Plaid Production walk inside vercel.md §Going live.
- [ ] Privacy template, marked not-legal-advice.
- [ ] Deploy-to-Vercel button in README (clone URL, `apps/web` root, env var names), linking to vercel.md.

### Task 7: CHANGELOG + phase close

- [ ] CHANGELOG `## v0.5.0 — unreleased` entry; README touch-ups.
- [ ] Ledger the owner actions that remain: Plaid Production application, real card link.
- [ ] Full turbo suite + e2e twice; PR.

---

Each task: failing test → minimal code → green → commit; docs tasks commit per deliverable.
