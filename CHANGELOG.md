# Changelog

Notable changes, newest first. Versions follow the sub-project sequence in the
[architecture](docs/superpowers/specs/2026-08-20-system-architecture-design.md)
rather than a release cadence.

## v0.1.0-foundation — unreleased

Phase 1: **Foundation + Locked Door.** The application became a monorepo with a
real database and a real front door. No bank code ships before this is
deployed.

### The shape of it

- pnpm workspaces and Turborepo: `apps/web` plus `packages/{core,db,bank-connectors,config}`.
- `packages/core` holds money, schemas and every margin calculation, with no
  I/O and no framework — and 100% coverage. `lib/metricsEngine.ts` became
  `metrics/{business,project,thresholds}.ts`, and `lib/categorizer.ts` moved
  across whole.
- `packages/db`: Drizzle schema, owner-scoped repositories, committed
  migrations, and a seed. `drizzle-kit push` is never used.
- `packages/bank-connectors`: the `BankProvider` interface, and a `CsvProvider`
  rewritten against it.

### Postgres, and only Postgres

- The JSON file store is gone, along with `lib/db.ts` and `lib/seedData.ts`.
  There is no file-backed fallback: a deployment or a dev server that cannot
  reach Postgres refuses to start rather than serving an empty dashboard.
- Money is integer cents end to end (ADR 0007), parsed once at each boundary.

### Server-rendered, not fetched

- Every page is a Server Component that reads its own data; every write is a
  Server Action. `/api/data` and the per-entity CRUD routes are gone.
- Three route handlers remain, each for a reason: Auth.js's own, `/api/health`,
  and `/api/import/csv`, whose caller is a file rather than a person.

### The locked door

- Auth.js v5 with GitHub, an `ALLOWED_EMAILS` allow list, and sessions in
  Postgres (ADR 0003). The allow list is checked against the primary *verified*
  address, before any user row exists, so a refused stranger leaves nothing
  behind — and removing someone locks out the account they already had.
- `middleware.ts` fails closed: a short public allow list, everything else
  needs a cookie, and every page, action and handler asks `auth()` again.
- `assertProductionSecurity` throws at boot when a production environment is
  missing `AUTH_SECRET`, the GitHub pair, a non-empty allow list, a 32-byte
  `BANK_TOKEN_ENCRYPTION_KEY`, or `CRON_SECRET` once Plaid is live — and now
  also when `E2E` is set. `pnpm check:security` runs the same judgement without
  deploying to find out.
- AES-256-GCM for bank tokens (ADR 0002), in place before there is a token to
  hold.

### CI and hygiene

- `.github/workflows/ci.yml`: lint, typecheck, test and build against a
  Postgres service container; a blocking `pnpm audit --prod`; gitleaks over the
  full history; and `pnpm check:security` run twice — once against a complete
  environment, which must pass, and once with the allow list removed, which
  must fail.
- A Playwright smoke suite that signs in, reads the seeded books, quotes a job,
  files a card charge against it and watches the job's cost move. It gets in
  through a test-only credentials provider that two independent guards keep out
  of production.
- CodeQL weekly, Dependabot grouped weekly, gitleaks and eslint on pre-commit,
  typecheck on pre-push.

### Fixed after the whole-branch review

- `pnpm check:security` no longer loads the repository's `.env` before reading
  the environment — it could print "safe to deploy to production" about a
  development environment. It reads `process.env`, or an explicit
  `--env-file <path>`, and prints which of the two it judged.
- The CSV importer accepts `MM/DD/YYYY` (US ordering) as well as ISO dates, so
  a real bank export no longer comes back with every row skipped. `DD/MM/YYYY`
  is refused rather than guessed at.
- Weekly cash outflow excludes `ignored` and negative rows, so the "Weekly Net
  Cash Flow" KPI and the cash-flow waterfall beside it stop disagreeing about
  the same week.
- Encryption key ids are a fingerprint of the key rather than the constants
  `k1`/`k2`, which could not survive a rotation. No token has ever been
  stored, so nothing has to be re-encrypted.
- A deficit renders with its minus sign, and a YTD loss is no longer drawn in
  the healthy colour.

### Known debt

- Eight `next` advisories are allow-listed by exact id in `pnpm-workspace.yaml`
  pending a Next 15 upgrade. See [CONTRIBUTING.md](CONTRIBUTING.md).
- The cash flow waterfall draws from real weeks now, but shows an em dash for
  the figures nothing can compute yet — available credit and a liquid cash
  balance both wait on a bank connection (sub-project 2). Monthly gross margin
  is sub-project 4.
