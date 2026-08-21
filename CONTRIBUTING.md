# Contributing

## Getting set up

See the [README](README.md) for the quickstart and
[docs/self-hosting/local.md](docs/self-hosting/local.md) for the databases,
the test suites and the end-to-end run.

`pnpm install` also installs the git hooks. You need `gitleaks` on your PATH
(`brew install gitleaks`); the pre-commit hook fails without it rather than
skipping.

## The workflow

pnpm workspaces, orchestrated by Turborepo. From the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

`pnpm turbo lint typecheck test build` is what CI runs, so run it before
opening a pull request. `turbo` caches, so the second run is nearly free.

Hooks: pre-commit is `gitleaks` on the staged diff plus `eslint --fix` on the
staged TypeScript; pre-push is `pnpm typecheck`. `LEFTHOOK=0 git commit …`
skips them when that is genuinely the right call.

## What a pull request is expected to have

- **A test for every component.** Not a guideline —
  `apps/web/test/component-tests.test.ts` walks `app/`, `components/` and
  `src/` and fails on any `.tsx` without a colocated `.test.tsx`. Framework
  slots (`page`, `layout`, `loading`, `error`, `not-found`) are exempt because
  the route tests and the island tests already cover them.
- **A test for every rule you are relying on.** The convention here is that a
  rule nobody can check is a rule that will be broken: the middleware allow
  list, the route gating, `.env.example` against the env schema and the boot
  assertion are all pinned by tests that walk the tree rather than by lists
  somebody typed.
- **Green `pnpm turbo lint typecheck test build`,** and a green `pnpm e2e` if
  you touched auth, a page or a server action.
- **No secrets, ever.** Not in a test fixture, not in a comment, not "just for
  now". `.gitleaks.toml` allows exactly two things — two *exact value
  literals*, never a path — and each is annotated with why it is not a secret
  and pinned a second time by a unit test; if your change needs a third, say
  so in the pull request rather than editing the file quietly.
- **A commit message that says why.** The what is in the diff.

## Where things go

| Path | What belongs there |
| --- | --- |
| `packages/core` | Money, schemas, every calculation. **No I/O**, no framework, 100% covered |
| `packages/db` | Drizzle schema, repositories, migrations, seed. Every query scoped by owner |
| `packages/bank-connectors` | The `BankProvider` interface and its implementations |
| `apps/web` | Routing, auth, Server Components, Server Actions, UI |

Reads happen in Server Components and writes in Server Actions. There are three
route handlers on purpose — Auth.js's own, the health check, and the CSV upload,
which is a route because its caller is a file rather than a person. A new
`app/api/*` route needs a reason, and `test/route-gating.test.ts` will ask for
one.

Schema changes are migrations generated with
`pnpm --filter @budget-bot/db db:generate` and committed.
`drizzle-kit push` is never used.

### Migrations, once this has been deployed

`0000_initial_schema.sql` was amended in place several times while it was
being written, and that was the right call: it had never run anywhere but
disposable databases, and one clean migration is worth more than an audit
trail of a schema nobody used.

**That stops at the first production `pnpm db:migrate`.** From then on, every
change is a *new numbered migration* and a committed one is never edited.
Drizzle's migrator decides what to run by comparing each entry's journal
timestamp against the newest one the database has recorded (it stores a hash
of the file but never compares it), so an amended file is **always silently
skipped** on any database that already applied the original. Nothing re-runs,
nothing warns, and the first sign is a production schema missing the column
you thought you added.

Keep the tests that assert on the migration SQL as a string. The initial
migration carries a hand-edited `ON DELETE set null ("project_id")` column list
that drizzle-kit cannot express, and that test is the only thing standing
between a regenerated migration and a delete that fails against a `NOT NULL`
owner column.

## Known security debt

None. `pnpm audit --prod --audit-level=high` blocks CI and
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) carries no `auditConfig` at all:
the eight `next` advisories that used to be allow-listed here are fixed in
**Next 15**, which the app is now on, and the two transitive packages that
still lag (`postcss`, `sharp`) are pulled forward by `overrides` instead.

An override that actually fixes the version is always preferred. If an advisory
genuinely has to be passed over, list it by **exact GHSA id** with a one-line
reason, so a *new* advisory against the same package still turns CI red. Do not
widen it to a package name or a severity threshold.

## Repository settings the owner has to apply

These cannot be set from a pull request. For the `main` branch:

- **Require a pull request before merging.** No direct pushes.
- **Require status checks to pass**, and require branches to be up to date:
  - `lint, typecheck, test, build` (CI)
  - `end-to-end smoke` (CI)
  - `gitleaks` (CI)
  - `analyze` (CodeQL)
- **Block force pushes** and **block deletions**.
- **Require signed commits**, and sign release tags (`git tag -s`).
- Dependabot alerts and security updates on.
