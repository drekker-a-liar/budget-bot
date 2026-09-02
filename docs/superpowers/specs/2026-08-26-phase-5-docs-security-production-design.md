# Phase 5 — Docs, Security Audit, Production

**Date:** 2026-08-26
**Status:** Draft (scope authorized by Tyler 2026-08-26: spec list + Vercel deploy fix + Phase 4 parked polish)
**Builds on:** Phases 1-4 (main @ 110d35a).

## 1. Goal

The phase where the project becomes something a stranger can run in
production and trust: the security documents that make the posture legible,
the audit that backs them, a release path that actually deploys (the Vercel
deployment on `main` currently fails), and the three polish items Phase 4
ledgered.

**In scope:** fixing the failing Vercel deployment; `SECURITY.md`; a threat
model; a security audit of the branch-to-date codebase; a release checklist; a
Plaid Production setup guide; a privacy policy template; a Deploy-to-Vercel
button; dashboard margin null-propagation; seed settings merge; seed date
aging.

**Out of scope:** new product features; accrual basis; per-project margin
drilldowns; the Plaid Production application itself and linking the real card
(owner actions — this phase documents them, it cannot perform them).

## 2. Item zero: the deployment that fails

The Vercel status on `main` is FAILURE and has been since before PR #17
(deployment `dpl_FVvq6c8rFyY75yT2ePu7vSedhw1y`). A "production" phase that
ships docs onto a broken deploy is theater, so this goes first. Cause is
unknown until someone with access to the Vercel project
(`rozyckimike-9049s-projects/budget-bot`) runs
`npx vercel inspect <dpl> --logs`; the two obvious suspects, given the
fail-closed boot assertion, are missing environment variables in the Vercel
project and a Root Directory misconfiguration (both are the exact failure
modes `docs/self-hosting/vercel.md` warns its readers about). The fix is
whatever the logs say; the deliverable is a green Vercel status on `main` and,
if the cause was a repo-side defect, a regression guard for it.

## 3. Phase 4 parked polish

**Dashboard margin at zero revenue.** `business.ts` computes
`averageMarginPct = percent(...) ?? 0` — the `?? 0` fabricates a number where
`/margin` shows an em dash. Decision: the dashboard adopts the `/margin`
philosophy. `averageMarginPct` becomes `number | null`, null at zero YTD
revenue; `averageMarginSeverity` becomes `null` in that case — the
`BusinessFinancialSummary` type's own no-data convention (see
`averageHourlySeverity`) and what `SeverityBadge` already renders as its
neutral state, rather than importing `/margin`'s `'none'` literal into a
second type; the thresholds helper must not receive null. `DashboardMetrics`
renders the same em dash treatment `/margin` uses. This is the Phase 1 realization rule
("null, never a fabricated sentinel") finally applied everywhere.

**Seed settings clobber.** `seed/index.ts` writes
`.set({ settings: { timeZone: … } })`, replacing the whole jsonb. On `--reset`
that is arguably fine; on a plain re-seed it silently deletes any other
settings key. The seed merges instead: read-modify-write (or a jsonb merge
expression), preserving unknown keys, still guaranteeing `timeZone` ends up
`'America/Los_Angeles'`.

**Seed date aging.** The fixtures carry fixed dates that fall out of the
trailing-13-month margin window around 2027-09, at which point the e2e's
Margin step asserts against an empty chart. The fixtures become
offset-generated: dates are computed at seed time as month offsets from the
current month (same shapes, same amounts, same relative positions), so the
seed is evergreen. The e2e already asserts format rather than absolute months
(the Sept-1 fix), so it survives this unchanged; any unit test pinning an
absolute fixture date moves to pinning the offset.

## 4. Security documents

**`SECURITY.md`** at the repo root, the standard GitHub location: supported
versions (main only — there are no release branches), how to report
(GitHub private vulnerability reporting on the repo, so no email address has
to be published), response expectations stated honestly for a
one-maintainer project, and a short statement of the fail-closed posture
(allowlist auth, boot assertion, app-level token encryption) with pointers to
the ADRs instead of restating them.

**Threat model** at `docs/architecture/threat-model.md`: what the system
holds (bank transactions, Plaid access tokens, OAuth identities), who it
holds it for (a single owner per deployment), the trust boundaries (browser /
app / Postgres / Plaid / GitHub OAuth), and the threats considered with their
mitigations — stolen DB dump (tokens encrypted at the app level, ADR 0002),
webhook forgery (signature verification with replay window, Phase 3), session
theft (DB sessions, ADR 0003), a hostile fork of the deploy button
(each self-hoster owns their own secrets — nothing to inherit). Explicitly
lists what is *not* defended: a compromised Vercel account, a malicious
owner, Plaid itself.

**Security audit.** A review of the shipped code against that threat model —
authorization on every route and repo call, secret handling, webhook
verification, injection surfaces. Findings are fixed in this phase or
ledgered with reasons, and the audit's date and outcome are recorded in the
threat model doc.

## 5. Release and deployment collateral

**Release checklist** at `docs/release-checklist.md`: the ordered list a
release actually requires — full turbo suite green twice, e2e, CHANGELOG cut,
tag, Vercel deploy verified green, post-deploy smoke (sign in, dashboard,
margin), rollback note. Honest about what is manual.

**Plaid Production guide.** `docs/self-hosting/vercel.md` §"Going live"
already says an application is required; it grows into the full walk:
Plaid dashboard application, the redirect-URI re-registration for the
production environment, swapping `PLAID_ENV` and keys, and the first live
sync check. Stays inside vercel.md — a second file would split one journey.

**Privacy template** at `docs/self-hosting/privacy-template.md`: a fill-in
policy for self-hosters (what data, where stored, third parties: Plaid /
Vercel / their Postgres host, deletion via the existing delete-all), clearly
marked template-not-legal-advice.

**Deploy-to-Vercel button** in the README: the standard
`vercel.com/new/clone` link pre-filled with the repo URL, `apps/web` root
directory, and the required env var names — pointing at the fork-first
instructions in vercel.md rather than pretending one click is the whole
story.

## 6. Testing

Polish items are code and get tests: business-metrics fixtures for null
propagation at zero revenue (and severity `'none'`), dashboard component
test for the em dash, seed tests for settings-key preservation and for
offset-generated dates landing inside the trailing window. Docs get the
existing structural checks (links resolve; `pnpm check:security` still
passes). The deploy fix's regression guard depends on the diagnosed cause.
e2e stays at 16 steps, green twice back-to-back — the Phase 4 bar.
