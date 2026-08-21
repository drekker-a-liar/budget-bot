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
  now". `.gitleaks.toml` allows exactly three things and each one is annotated
  with why it is not a secret; if your change needs a fourth, say so in the
  pull request rather than editing the file quietly.
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

## Known security debt

`pnpm audit --prod --audit-level=high` blocks CI, and
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) lists eight advisories it is
allowed to pass over. All eight are fixed only in **Next 15**; this app is on
the Next 14 App Router. Four of them cannot reach this deployment (no Pages
Router, no i18n, no rewrites, no WebSocket upgrades, no custom server) and four
are denial of service against a private single-user deployment.

**Upgrading to Next 15 is the fix, and it is a sub-project.** Until then: the
list is exact GHSA ids, so a *new* advisory against `next` — or against
anything else — still turns CI red. Do not widen it to a package name or a
severity threshold.

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
