# Running Budget Bot locally

The [README](../../README.md) has the five-minute version. This is the rest of
it: the databases, the test suites, and the end-to-end run.

## Postgres

```bash
pnpm db:up      # start it
pnpm db:down    # stop it; the data survives in a named volume
```

`docker-compose.yml` publishes Postgres 16 on `127.0.0.1:5433` — the loopback
address on purpose, and `5433` because a Homebrew Postgres already owns `5432`
on a lot of machines. The credentials are the weakest pair imaginable and that
is fine, because nothing off this machine can reach the port.

Any Postgres 16 works instead. Point `DATABASE_URL` at it and nothing else
changes; there is no file-backed fallback, so `pnpm dev` without a reachable
database refuses to start rather than showing an empty dashboard.

### Migrations

```bash
pnpm --filter @budget-bot/db db:migrate    # apply the committed SQL
pnpm --filter @budget-bot/db db:generate   # write a new migration from the schema
```

The generated SQL is committed and `drizzle-kit push` is never used, so what
ran in CI is exactly what runs in production.

### Demo data

```bash
pnpm --filter @budget-bot/db db:seed --owner-email you@example.com
pnpm --filter @budget-bot/db db:seed --owner-email you@example.com --reset
```

The user has to exist first — Auth.js creates it the first time that address
signs in. Seeding twice does nothing unless `--reset` is passed. Setting
`SEED_DEMO=1` does the same thing automatically on a user's first sign-in.

## Tests

```bash
pnpm test                                # everything
pnpm --filter @budget-bot/core test      # one workspace
```

`packages/db` needs a database of its own, because its suite drops and rebuilds
the schema between runs:

```bash
pnpm --filter @budget-bot/db db:test:setup    # creates DATABASE_URL_TEST once
```

Without it those suites **skip themselves with a reason** rather than failing.
That keeps `pnpm test` usable on a machine with no Docker, and it means a green
local run is not the same promise as a green CI run — CI always has a database.

## The end-to-end suite

```bash
pnpm e2e                       # or: pnpm --filter web e2e
pnpm --filter web exec playwright install chromium    # once
```

It starts its own `next dev` on port 3000, so stop any dev server you have
running first — it will not reuse one, deliberately, because the server it
starts is pointed at a different database.

Which database: `DATABASE_URL_TEST`, the throwaway one. The suite reseeds from
scratch and would otherwise take somebody's afternoon of test data with it.

### Why `next dev` and not a production build

`next start` runs with `NODE_ENV=production`, and the boot assertion refuses to
start a production deployment with `E2E` set (see below). That is the guard
doing its job, so the suite lives with a slower first page load.

### The test-only sign-in door

Playwright cannot complete a GitHub OAuth handshake, so `E2E=1` adds a second
provider that takes an email address and no password and signs it in — if, and
only if, it is on `ALLOWED_EMAILS`. `apps/web/e2e/environment.ts` sets it for
the server the suite starts, and for nothing else.

It cannot exist in production, by two mechanisms that do not depend on each
other:

- `assertProductionSecurity` refuses to boot a production deployment with `E2E`
  set to anything but `0`, so the process never serves a request;
- the provider factory throws when `NODE_ENV=production`, so a build that
  somehow skipped the boot assertion cannot assemble it.

Both are covered by tests (`apps/web/test/env.test.ts`,
`apps/web/test/e2e-door.test.ts`). If you are ever tempted to set `E2E` on a
deployment: it will not start.

**But note what that leaves.** Both guards key on `NODE_ENV=production`, and
`next dev` is not production — so under `next dev` the `E2E` flag is the *only*
thing holding the door shut, and anyone who can reach the port can sign in as
any allow-listed address without a password. Never run `next dev` with `E2E=1`
on a host reachable from anywhere but your own machine, and never leave `E2E=1`
exported in a shell you then use for ordinary development. The suite sets it on
the server it spawns and nowhere else, which is why it is set there rather than
in your `.env`.

## Judging an environment before deploying it

```bash
pnpm check:security                                # judges this shell
pnpm check:security --env-file .env.production.local   # judges that file, only it
```

It runs the boot assertion with `NODE_ENV=production` forced, so it answers the
question a deployment would ask. It has exactly one input and no hidden ones:
without `--env-file` it reads `process.env` and nothing else, and with one it
reads that file *instead of* the environment, so a variable you happen to have
exported cannot complete a file that a deployment will get incomplete. It
prints which of the two it read and the names — never the values — of the
variables it found before it prints a verdict.

It used to load the repository's `.env` first, which is how it came to print
"safe to deploy to production" about an environment with no `ALLOWED_EMAILS` in
it: the developer's own `.env` supplied one. A tool whose only possible mistake
is saying yes too often does not get a second input.

## Git hooks

`pnpm install` installs them (lefthook). Pre-commit runs `gitleaks` over what
is staged and `eslint --fix` over the staged TypeScript; pre-push runs
`pnpm typecheck`.

gitleaks has to be on your PATH — `brew install gitleaks`, or see
<https://github.com/gitleaks/gitleaks>. The hook fails without it rather than
skipping, because a secret scanner that quietly does not run is worse than
none. `LEFTHOOK=0 git commit …` skips the hooks entirely for the times that is
the right call; CI does not offer that.
