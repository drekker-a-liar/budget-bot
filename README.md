# Budget Bot

Job costing and cash flow for a one-person trade business: what each job
quoted, what it has actually cost, and what that leaves per hour.

It is a private, single-tenant application you host yourself. Sign-in is a
GitHub OAuth app you own, restricted to an allow list you write, and the data
lives in a Postgres you control.

Phase 1 of the [architecture](docs/superpowers/specs/2026-08-20-system-architecture-design.md).
Bank connections, monthly gross margin and the production security audit are
the sub-projects after it.

## Prerequisites

- **Node 24**
- **pnpm**, via corepack: `corepack enable`
- **Docker**, for the local Postgres (any Postgres 16 works instead)

## Quickstart

```bash
pnpm install                  # also installs the git hooks
pnpm db:up                    # Postgres on 127.0.0.1:5433
cp .env.example .env
```

Open `.env` and fill in three things:

1. **A GitHub OAuth app.** Create one at
   <https://github.com/settings/developers> → **New OAuth App**, with the
   Authorization callback URL `http://localhost:3000/api/auth/callback/github`.
   Put its client id and secret in `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`.
2. **`AUTH_SECRET`** — `openssl rand -base64 32`.
3. **`ALLOWED_EMAILS`** — your own address, the one GitHub has *verified*.
   Nobody else can sign in, and nobody else leaves a row behind trying.

Then:

```bash
pnpm --filter @budget-bot/db db:migrate
pnpm dev                      # http://localhost:3000
```

Sign in, then fill the account with demo data to have something to look at:

```bash
pnpm --filter @budget-bot/db db:seed --owner-email you@example.com
```

The seed needs the user to exist, which is what signing in once creates.

## Working on it

```bash
pnpm lint                     # eslint, every workspace
pnpm typecheck                # tsc --noEmit, every workspace
pnpm test                     # vitest, every workspace
pnpm build                    # next build
pnpm check:security           # judge this shell's variables as a production environment
pnpm check:security --from .env    # judge that file instead, and only it

pnpm --filter @budget-bot/db db:test:setup   # once: create the test database
pnpm e2e                                     # Playwright, needs the above
```

`pnpm turbo lint typecheck test build` is what CI runs. The database suites
skip themselves with a message when `DATABASE_URL_TEST` is unreachable, so a
machine without Docker still gets a green `pnpm test` — and a misleadingly
green one, which is why CI always has a database.

Every variable is documented in [`.env.example`](.env.example), and a test
fails if that file and the schema in `apps/web/src/env.ts` stop agreeing.

## Security in one paragraph

This deployment is private and fails closed. Only addresses on `ALLOWED_EMAILS`
can sign in, checked against the primary *verified* address on the GitHub
account and before any user row is created, so a stranger who completes the
OAuth handshake leaves nothing behind. Sessions live in Postgres rather than in
a token, so removing someone from the list locks them out on their next
request. Middleware refuses anything but a short public allow list, and every
page, action and route handler asks `auth()` again rather than trusting it. A
production deployment missing `AUTH_SECRET`, the GitHub pair, a non-empty allow
list or a 32-byte `BANK_TOKEN_ENCRYPTION_KEY` throws at boot instead of serving
data — `pnpm check:security` says so without deploying to find out. Bank access
tokens will be AES-256-GCM encrypted with a key that lives only in the
environment, so a leaked database is not enough on its own. No card number is
ever stored, processed or transmitted.

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | The Next.js 14 App Router application |
| `packages/core` | Money, schemas and every margin calculation. No I/O |
| `packages/db` | Drizzle schema, repositories, migrations, seed |
| `packages/bank-connectors` | The `BankProvider` interface and the CSV one |
| `packages/config` | Shared tsconfig, eslint and vitest bases |

## Uploading a bank statement

`POST /api/import/csv` takes a CSV export, as `multipart/form-data` with a
`file` field or as a raw `text/csv` body, up to 5 MiB.

Columns are found by name, not position: a date column (`Date`, `Transaction
Date`, `Posted Date`, …), a description (`Description`, `Memo`, `Payee`, …) and
either an `Amount` column or a `Debit`/`Credit` pair. Dates may be written
`YYYY-MM-DD` or `MM/DD/YYYY` — **US ordering, month first**, also accepted with
dashes (`08-18-2026`) or as `YYYY/MM/DD`. `DD/MM/YYYY` is refused rather than
guessed at, because nothing in a file says which ordering the bank used and a
wrong guess files a charge in the wrong month without saying so. Rows with a
date in any other form come back in the response's `errors`, with the line
number and what would have worked.

## Documentation

- [System architecture](docs/superpowers/specs/2026-08-20-system-architecture-design.md)
- [Architecture decisions](docs/architecture/adr/)
- [Self-hosting on Vercel](docs/self-hosting/vercel.md)
- [Running it locally](docs/self-hosting/local.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
