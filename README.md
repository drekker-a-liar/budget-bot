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
| `apps/web` | The Next.js 15 App Router application |
| `packages/core` | Money, schemas and every margin calculation. No I/O |
| `packages/db` | Drizzle schema, repositories, migrations, seed |
| `packages/bank-connectors` | The `BankProvider` interface, the Plaid connector (link, sync, webhook verification), and CSV statement parsing |
| `packages/config` | Shared tsconfig, eslint and vitest bases |

## Connecting a bank

`/settings/connections` links a bank through Plaid Link and fills the card
inbox on its own, so charges stop having to be typed in. Every pull —
webhook-driven, cron-driven or manual — runs `/transactions/sync` page by page
under [ADR 0004](docs/architecture/adr/0004-transactions-sync-over-get.md)'s
merge rule: a transaction the bank sends again is updated only in the columns
the bank owns, so re-syncing never undoes an afternoon of filing. The access
token is AES-256-GCM encrypted before it reaches the database, is never
returned by any read and never appears in a log or an error.

- **Webhooks keep it current.** `POST /api/webhooks/plaid` (signature-verified,
  no session) runs a sync the moment Plaid has new transactions, and marks a
  connection `reauth_required` the moment a login stops working or is about to
  expire — before the owner ever notices stale numbers.
- **The daily cron is the backstop.** `GET /api/internal/sync` (bearer-gated,
  `CRON_SECRET`) runs every connection a webhook could have missed once a day
  and purges webhook ledger rows older than 30 days. It retries `active` and
  `error` connections — a transient failure heals itself on the next run — but
  never touches `reauth_required`: only the owner reconnecting fixes a dead
  token.
- **Reconnect** shows up on the connections page the moment a bank needs
  attention, and reopens Plaid Link in update mode without re-entering
  anything else.
- **Disconnect** removes a linked bank; transactions already filed keep their
  category and project, they just stop pointing at an account that no longer
  exists.

A deployment with no Plaid credentials is a supported deployment — the screen
says so, and CSV import and manual entry carry on; disconnecting a bank and
deleting all data both still work with no provider configured. Setting it up
is in [the Vercel guide](docs/self-hosting/vercel.md#9-connecting-a-bank) and
[the local one](docs/self-hosting/local.md#connecting-a-bank-locally).

## Exporting or deleting your data

Settings has a "Danger zone": **Export my data** downloads one JSON document
of everything — projects, transactions, labor, invoices, import batches and
connection metadata (institution, status, masked accounts — never a token,
never a cursor). **Delete all my data** removes every row across every table,
scoped to the signed-in owner, behind a type-to-confirm prompt; the Auth.js
account itself survives so signing back in starts from empty rather than
locked out.

## Uploading a bank statement

`POST /api/import/csv` takes a CSV export as a raw `text/csv` body — send
`Content-Type: text/csv` and a `Content-Length`, up to 5 MiB.
`multipart/form-data` is refused with `415`.

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
