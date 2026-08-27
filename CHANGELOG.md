# Changelog

Notable changes, newest first. Versions follow the sub-project sequence in the
[architecture](docs/superpowers/specs/2026-08-20-system-architecture-design.md)
rather than a release cadence.

## v0.4.0-margin — unreleased

Phase 4: **Monthly Gross Margin.** `/margin` charts the trailing 12 months of
gross margin, cash basis (ADR 0006): paid invoices as revenue against posted
transactions and labor as cost, bucketed by month in the owner's own time
zone rather than UTC, with the current month carried to date and marked as
still in progress.

- `calculateMonthlyMargins` (`packages/core`) is a pure function of a date
  range and time zone — invoices, transactions and labor go in, one row per
  month comes out, with severity thresholds at 45%/25% and a null (never a
  fabricated zero) margin percentage for a month with no revenue.
- `MonthlyMarginChart` draws it as hand-rolled SVG, no chart library: bars for
  revenue and margin, a margin-percent line, reference lines at the severity
  thresholds, a diagonal hatch over the current month's bar, and an explicit
  empty state rather than a chart with nothing to show.
- `/margin` joined the header nav, gated behind the same session check as
  every other page. The e2e journey grew from 15 to 16 steps to cover it.

## v0.3.0-lifecycle — unreleased

Phase 3: **Webhooks, Cron, and Connection Lifecycle.** A linked bank stays
current and healthy without the user pressing anything: Plaid pushes updates to
a signature-verified webhook, a daily cron catches what the webhook missed, a
connection that needs re-authentication says so and repairs itself in one
click, and the settings page can disconnect a bank or export/delete everything.

### Webhooks

- `POST /api/webhooks/plaid` verifies every payload before believing it:
  ES256 JWT from the `plaid-verification` header (any other algorithm rejected
  before a single key is fetched), an `iat` accepted only within a five-minute
  past window and thirty seconds of future clock skew, and a timing-safe
  body-hash comparison. The only non-200 is a 401 on a bad signature; response
  bodies never carry an id.
- A replay ledger (`webhook_events`, keyed on the body hash) makes redelivery
  and replay a no-op; rows older than thirty days are purged by the cron.
  `SYNC_UPDATES_AVAILABLE` triggers a sync under the same per-page advisory
  lock as **Sync now**; `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION` and
  `USER_PERMISSION_REVOKED` mark the connection for re-authentication.

### Cron

- `GET /api/internal/sync`, guarded by a timing-safe `CRON_SECRET` bearer
  check, refreshes accounts and syncs every active connection across owners —
  one connection's failure never stops the rest — then purges the webhook
  ledger. Registered in `apps/web/vercel.json` to run daily at 06:00 UTC.

### Re-authentication and lifecycle

- A connection in trouble shows a banner naming the problem and a
  **Reconnect** button: Link's update mode, including the OAuth round trip,
  ends with the token re-encrypted in place (same row, fresh AAD-bound
  ciphertext, cursor kept). Re-linking the same bank through the normal
  connect flow now repairs the existing connection instead of refusing —
  for its owner only; anyone else still gets "already connected".
- **Disconnect** (type-to-confirm) removes the item at Plaid best-effort and
  deletes the connection; filed transactions keep their history with the
  account reference nulled.
- **Export my data** downloads one JSON document of everything the owner has —
  walked by a test that proves no token, ciphertext, cursor, or internal
  handle rides along. **Delete all my data** (type-to-confirm) removes every
  row the owner has, works even with Plaid unconfigured, and leaves the
  sign-in itself intact.

### Fixes and upkeep

- CSV re-imports no longer duplicate rows: an owner-scoped partial unique
  index dedupes across batches, and the import report now counts what actually
  landed. A skip banner crash on duplicate-only imports went with it.
- Sync results now surface rows that referenced untracked accounts; account
  lists have a stable order; webhook URLs are only registered with Plaid for
  https deployments.
- The e2e journey grew from 10 to 15 steps: webhook-driven sync, replay
  rejection, re-auth repair, disconnect, and export — rerun-safe against the
  same database.
- `apps/web` moved from `next lint` (deprecated in Next 15.5) to ESLint 9 flat
  config, joining the packages that were already there; the dependency-boundary
  rules survived the move rule-for-rule, proven by forbidden-import tests.

## v0.2.0-plaid-sandbox — unreleased

Phase 2: **Plaid Sandbox Connector.** A signed-in owner links a bank through
Plaid Link, the access token is stored encrypted, and **Sync now** pulls
`/transactions/sync` into the card inbox under ADR 0004's merge rules — all of
it proved by tests that need no Plaid credentials.

### Next 15.5 and React 19

- Upgraded, with `params` and `searchParams` now awaited; the `next` advisories
  the audit was ignoring are gone with the version they applied to.

### The connector

- `PlaidProvider` in `packages/bank-connectors`, behind the existing
  `BankProvider` interface: link token, exchange, accounts, `/transactions/sync`
  one page at a time, item removal. Stateless, with the client injected, so the
  whole of its coverage runs against fixtures and no Plaid account.
- Every Plaid failure is mapped to one of four things a caller can act on —
  rate limited, mutation during pagination, an item error the *user* has to
  resolve, and everything else. Nothing of the axios error survives the
  mapping, because the outgoing request body it carries is where the access
  token lives.
- Positive is money out, no sign flip. A negative row (a card payment, a
  refund) is stored and filed `ignored` rather than counted as an expense on
  top of the purchases it settles.

### Storing a bank

- `bank_connections` and `bank_accounts` get their repository. The access token
  is AES-256-GCM encrypted against the connection's own id before it is
  written, and there is exactly one function that turns it back into a string:
  `withAccessToken`, which hands it to a callback and never returns it. Every
  read names its columns, so widening a query cannot quietly put a credential
  in a payload.
- A Postgres advisory lock per connection, so two syncs of the same bank cannot
  interleave.
- Three write primitives for the merge rule: `applyModified` (provider-owned
  columns only), `reconcilePending` (pending → posted, carrying the filing
  across), `applyRemoved` (soft delete for a filed row, hard for one nobody
  touched).
- The transactions table already carried the bank columns from Phase 1's
  schema; the domain type did not. `ExpenseTransaction` now names them
  (`postedAt`, `pending`, `source`, `provider`, `externalId`, `bankAccountId`,
  `removedAt`, `userEditedAt`), so a bank row and a hand-typed one are the same
  type all the way to the screen. No migration: `0000_initial_schema.sql` is
  unedited.

### Pulling from it

- `runSync` composes them page by page. A page is applied and its cursor
  committed in one transaction, so a run that dies on page nine keeps the eight
  before it — and a cursor is never persisted for a page that did not land,
  which is the one mistake in this protocol that loses transactions for good.
- Counts are what happened rather than what was attempted: a page that wrote
  fewer rows than it was handed stops the run rather than reporting success.
- A rate limit is an unfinished sync, not a failed one. What was committed
  stands, and the screen says when to come back.

### The screen

- `/settings/connections`: connect a bank, see its accounts and balances,
  **Sync now** per connection with the counts it produced. Every connection
  carries a status, not only the broken ones — "connected" and "has not fetched
  anything since April" are both true at once and only one of them is
  reassuring.
- `/plaid/oauth-return` for the institutions that authenticate on their own
  site. The redirect URI is built from the request's origin or `AUTH_URL`,
  never from client input.
- A deployment with no Plaid credentials is a supported deployment: the screen
  says Plaid is not configured rather than offering a button that can only
  fail.

### Proving it without credentials

- A scripted `FakeBankProvider` behind the existing `E2E=1` door — two
  accounts, two pages, a cursor chain it refuses to skip — so the sync service
  and the Playwright journey need no Plaid account. It cannot exist in
  production: the door refuses to boot there, and its constructor refuses
  again.
- The end-to-end run now connects a bank, finds the charge in the inbox filed
  to the right card, and presses **Sync now**.
- `pnpm --filter web plaid:smoke`: the one thing here that talks to real Plaid,
  run by hand by somebody with Sandbox keys. It creates a Platypus OAuth Bank
  Item, pages to exhaustion and prints six numbers. No keys is a clean skip;
  `PLAID_ENV` naming anything but `sandbox` is a refusal. Never run by CI.

### Environment

- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`. `PLAID_ENV=sandbox` is
  refused in production, credentials without `PLAID_ENV` are refused, and
  `PLAID_ENV=production` makes the credentials and `CRON_SECRET` mandatory.

### CSV upload is `text/csv` only

- `POST /api/import/csv` now accepts only a raw `text/csv` body;
  `multipart/form-data` is refused with `415` before the body is read. The
  client sends the file's text directly (`file.text()`), so the route no
  longer buffers a `FormData` parse or re-checks a part's size against the
  cap - `Content-Length` and the capped stream read are the only guards left,
  and they cover the one shape the route now accepts.
- An import batch no longer carries a filename: a raw body has no form field
  to read one from.

### Also

- `db:seed --reset` now deletes the owner's linked banks along with their
  ledger. Leaving them was the half-measure that cannot work: a connection
  carries a spent `/transactions/sync` cursor, so a reset owner kept a bank
  that would never hand over a transaction it had already delivered, and
  re-linking it collided with the row on the unique `(provider, item_id)`.

### Known debt, carried into Phase 3

- **No webhooks.** `TRANSACTIONS.SYNC_UPDATES_AVAILABLE` is not received, so
  nothing pulls on its own; **Sync now** is the only trigger.
- **No cron.** `CRON_SECRET` is required by the boot assertion and checked by
  nothing yet: there is no scheduled sync for it to protect.
- **No re-auth.** When a bank asks the owner to sign in again the connection
  records `reauth_required` and the screen says so, and that is as far as it
  goes. Pressing **Connect a bank** for a bank that is already linked now gets
  a readable error — "This bank is already connected. Use Sync now on the
  existing connection." — rather than a message about the server; making it
  re-authenticate the existing connection instead of refusing is Link's update
  mode, and it is Phase 3.
- **No disconnect.** There is no way to remove a connection from the UI;
  `removeItem` exists on the provider and nothing calls it.
- **CSV import does not dedupe against a bank feed**, or against a second
  upload of the same file. A statement imported twice is two sets of rows.
- **`UNKNOWN_ACCOUNT` is recorded, not returned.** A page naming an account the
  connection does not have leaves the code on the connection; the count of
  transactions it dropped is not in the sync result the screen shows.
- **Account row order is not stable.** The accounts behind one connection are
  written by a single statement and share a `created_at`, so the table's order
  is a tie-break on a random uuid and can differ between two databases holding
  the same data.

### Fixed after the whole-branch review

- **`.env.example` told a self-hoster to give a preview `PLAID_ENV=sandbox`
  with Sandbox keys**, which is a preview that refuses to boot — Vercel builds
  previews with `NODE_ENV=production`, and the assertion refuses Sandbox under
  that unconditionally. `docs/self-hosting/vercel.md` said the opposite. Both
  now say: production with live keys, previews with nothing, Sandbox keys on a
  development machine. There is deliberately no `VERCEL_ENV` exemption, and
  `vercel.md` and the spec both record why.
- **Reconnecting an already-linked bank blamed the server.** The unique
  `(provider, item_id)` violation escaped `exchangePublicTokenAction` — the
  file's one write outside a `try` — and the browser showed "Something went
  wrong connecting to the server. Try again.", after the public token had
  already been spent. It is now `ConnectionAlreadyExistsError` and a sentence
  that names the bank and points at **Sync now**.
- **The header pill could label a checking account as the card.** The card
  profile is now the first enabled *credit* account, which is what spec §6 said
  all along, and null when there is none.
- **`calculateWeeklyCashFlow` never learned about `postedAt`.** The weekly cash
  KPI buckets a bank row by when it posted, falling back to its date — spec
  §2.3's last clause, which had reached neither the plan nor a task report.
- **A sync that threw left the button reading "Syncing…"** until the next
  navigation. Same try/catch/finally the connect path already had.
- **The smoke script printed `UNKNOWN`** for
  `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, and echoed an unrecognised
  argument back — so `pnpm plaid:smoke $PLAID_SECRET` put a secret in the
  scrollback. Both fixed, both pinned.
- **`db:seed --reset` now proves its blast radius**: the test keeps a second
  owner's connection in the database and asserts it survives.

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
  `--from <path>` (resolved against the directory you typed it in), and prints
  which of the two it judged.
- `.gitleaks.toml` no longer allow-lists `.env.example` or
  `ci/env.production.fixture` by path. A `paths` allow list makes gitleaks
  skip the whole file before any rule runs — a planted token in either file
  went unreported — so the configuration now exempts exactly two anchored
  value literals and no path at all, and both files are pinned value by value
  by tests.
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

- The cash flow waterfall draws from real weeks now, but shows an em dash for
  the figures nothing can compute yet — available credit and a liquid cash
  balance both wait on a bank connection (sub-project 2). Monthly gross margin
  is sub-project 4.
