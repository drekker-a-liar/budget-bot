# CLAUDE.md

Guidance for Claude Code working in this repository. `CONTRIBUTING.md` is the
human-facing version and is authoritative where the two disagree; this file
adds the things an agent gets wrong without being told.

## What this is

Job costing and cash flow for a one-person trade business. Single-tenant,
self-hosted, one owner per deployment. Next.js 15 app in `apps/web`; pure
calculation in `packages/core`; Drizzle schema, repositories, migrations and
seed in `packages/db`; the `BankProvider` interface and its Plaid and CSV
implementations in `packages/bank-connectors`. pnpm workspaces under Turborepo,
Node 24.

Work is organised in phases. Each phase has a design spec and a checkbox plan
in `docs/superpowers/specs/` and `docs/superpowers/plans/`; the spec is binding
for that phase's work. Architecture decisions live in `docs/architecture/adr/`
and the threat model in `docs/architecture/threat-model.md`. Read the relevant
spec and ADRs before changing behaviour they cover.

## Commands

```bash
pnpm turbo lint typecheck test build   # what CI runs; green before every commit
pnpm e2e                               # 16-step journey; run twice if you touched auth, a page, or an action
pnpm check:security                    # boot assertion against the current env
pnpm --filter web test -- <file>       # one test file, fastest loop
pnpm db:up                             # local Postgres on 127.0.0.1:5433 (Docker)
pnpm --filter @budget-bot/db db:generate   # schema change -> new migration (never drizzle-kit push)
```

`turbo` runs in strict env mode: a task sees only what `turbo.json` declares.
`TMPDIR` is passed through so vitest and tsx work in a sandboxed shell that
denies `/tmp`; if you still see `EPERM: mkdir '/tmp/...'`, that is the sandbox,
not the tests.

Database-backed suites (`packages/db`, parts of `apps/web`) skip with a message
when Postgres is unreachable, and **fail** instead when `CI` is set. A local
run that reports skipped tests has not proved those paths. To make them run:
`pnpm db:up`, put `DATABASE_URL_TEST` in the root `.env` (the value is in
`.env.example`), and run `pnpm --filter @budget-bot/db db:test:setup` once.
`turbo.json` declares that variable in `globalEnv`; a new env var a test reads
has to be added there too, or strict mode hides it and the suite skips.

## Hard rules

These are pinned by tests that walk the tree; breaking one turns CI red.

- **Money is integer cents**, typed `Cents` from `packages/core`. `parseMoney`
  at every import boundary, `formatCents` at display, arithmetic through the
  helpers in `money.ts`. Never a float, never a raw `number` for money, never a
  cast at a call site to make a type error go away (brand at the source).
- **`null` means "no data". Never fabricate a 0.** A margin with no revenue is
  `null` and renders as an em dash with severity `'none'`, not 0% and
  'critical'. The rule applies to every metric, dashboard and per-project.
- **Every repository function takes `(db, ownerId, ...)`** and every query is
  scoped by owner. The owner id comes from the session, never from a request.
- **Reads happen in Server Components, writes in Server Actions.** A new
  `app/api/*` route needs a reason, and `test/route-gating.test.ts` will ask
  for it. Route handlers that read a raw body use `lib/readCappedBody.ts`.
- **Every `.tsx` under `app/`, `components/` and `src/` has a colocated
  `.test.tsx`.** Framework slots (`page`, `layout`, `loading`, `error`,
  `not-found`) are exempt. Every changed `.ts` keeps or gains its test.
- **Migrations are never edited once committed.** Schema changes are new
  numbered migrations generated with `db:generate`. Drizzle skips an amended
  file silently on any database that already ran the original.
- **No secrets anywhere**, including test fixtures and comments. `gitleaks`
  runs pre-commit and in CI. `.gitleaks.toml` allows exactly two exact value
  literals; a third is a conversation in the PR, not a quiet edit.
- **Time zones:** month bucketing and "today" follow the owner's
  `settings.timeZone`, not UTC and not the server's clock. `toISOString()`
  for a calendar date is a bug.
- **Fail closed.** The boot assertion refuses to start production without its
  secrets; `check:security` is tested in both directions against
  `ci/env.production.fixture`. New required env vars go in the schema,
  `.env.example`, the fixture, `check-security.ts`, and
  `docs/self-hosting/vercel.md` §4.

## How code here is written

- Comments explain **why**, in full sentences, and are often several lines. A
  typical one names the failure the code prevents and the alternative that was
  rejected. Match that voice; do not add "what" comments or strip existing ones.
- Errors are handled where they can be turned into something the caller can
  act on. Unauthenticated surfaces (webhooks) answer 200 to everything after
  signature verification so the sender has nothing to learn; log the failure
  and move on.
- Never log a raw error object from a database driver: it carries the query and
  its parameters. Log the message and stack.
- UI uses the CSS tokens in `apps/web/app/globals.css` (`var(--text-primary)`,
  `var(--severity-healthy)`, etc.), not hex literals. Thresholds come from
  `THRESHOLDS` in `packages/core`, not repeated numbers.
- Tests are named for the behaviour they pin, and each has a header comment
  saying what would break without it. Prefer one pinned rule over a list
  somebody typed: walk the tree, read the schema, diff against the source.
- Docs match the repo's voice. Read `docs/self-hosting/vercel.md` before
  writing or editing any doc.

## Commits and PRs

- One phase, one branch, one PR, merged with `Merge PR #N: <phase title>`.
- Commit messages say why; the diff says what. Conventional prefixes
  (`fix:`, `feat(web):`, `test(e2e):`, `docs:`).
- Trailers on every commit:

  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: <the current session URL>
  ```

- `CHANGELOG.md` gets an entry under the phase's `— unreleased` heading for
  anything a self-hoster would notice.
- Do not tag, merge, or push to `main` without being asked.

## Deployment facts that are easy to get wrong

- Vercel's Root Directory is `apps/web`; `apps/web/vercel.json` owns the build
  command and the cron. Migrations run at build time, for Production only.
- Preview deployments build with `NODE_ENV=production` and no secrets, so the
  boot assertion refuses to serve them. That is intended.
- Vercel caps request bodies at 4.5 MB before the route runs, and Hobby
  functions default to 10 seconds. Long routes export `maxDuration`.
- `AUTH_URL` is the origin Plaid webhooks are registered at. Set it in
  Production.
