# Budget Bot — System Architecture Design

**Status:** Approved 2026-08-20
**Scope:** The target architecture for Budget Bot as an open-source, self-hostable admin OS for handymen, and the sequence of sub-projects that gets there.

## 1. Problem

The prototype is a single-commit Next.js 14 dashboard with a JSON-file store, no authentication, no tests, and client-side pages that fetch the whole database on every mutation. It cannot run on Vercel (read-only filesystem) and cannot safely hold financial data.

The product owner's P0 is to link a California Credit Union Visa to **his own** Vercel deployment and see transactions arrive **securely**. The first analytics feature is **monthly gross margin in dollars and as a percentage**. Because the project is open source, every self-hoster must be able to reproduce a safe deployment from the docs alone.

## 2. Decisions

| Area | Decision | ADR |
|---|---|---|
| Bank feed | Plaid, `/transactions/sync`, each self-hoster brings their own Plaid account | [0001](../../architecture/adr/0001-plaid-over-aggregators.md), [0004](../../architecture/adr/0004-transactions-sync-over-get.md) |
| Shape | Modular monolith in a Turborepo + pnpm monorepo; one deployable Next.js app | [0005](../../architecture/adr/0005-modular-monolith.md) |
| Database | Postgres (Neon default) + Drizzle; portable `postgres` driver; integer cents | [0007](../../architecture/adr/0007-integer-cents.md) |
| Auth | Auth.js v5, GitHub OAuth, `ALLOWED_EMAILS` allowlist, DB sessions, fail-closed middleware, boot assertion | [0003](../../architecture/adr/0003-db-sessions-authjs.md) |
| Secrets at rest | Plaid access tokens AES-256-GCM encrypted with an env-held key | [0002](../../architecture/adr/0002-app-level-token-encryption.md) |
| Margin accounting | Cash basis | [0006](../../architecture/adr/0006-cash-basis-margin.md) |
| Charts | Hand-rolled SVG + `d3-scale`/`d3-shape`, styled by existing CSS severity tokens | — |

## 3. Monorepo

```
budget-bot/
  apps/web/                 The ONE Next.js app: routes, server actions, auth wiring, pages, app-only components
  packages/core/            Pure domain: types, Cents money, zod schemas, categorizer, metrics. Deps: zod only.
  packages/db/              Drizzle schema, migrations, client, repositories (every fn takes ownerId), seed, token crypto. Deps: core.
  packages/bank-connectors/ BankProvider interface + NormalizedTransaction; PlaidProvider, CsvProvider. Stateless. Deps: core.
  packages/ui/              Presentational React only. Deps: core. Forbidden: db, next/headers, drizzle-orm.
  packages/config/          tsconfig base, eslint flat config, vitest base. No runtime code.
```

**Dependency direction** (acyclic, enforced): `config ← core ← {db, bank-connectors, ui} ← web`. Nothing imports `web`.

Enforcement: (1) pnpm strict `workspace:*` declarations — `core` declares none, so it physically cannot resolve `db`; (2) `no-restricted-imports` overrides per package in `packages/config`. Packages ship TypeScript source (`exports: {".": "./src/index.ts"}`) consumed through `transpilePackages`; there is no package build step. Names are `@budget-bot/*`.

## 4. Domain (`packages/core`)

- Money is **integer cents** (branded `Cents`). One `parseMoney` at every import boundary, one `formatCents` at display.
- Entity types are `z.infer` of zod input schemas plus `id`/timestamps, so validation and types cannot drift.
- Metrics are pure. Time is injected (`now: Date` is a required parameter).
- Monthly gross margin:
  ```ts
  calculateMonthlyMargins({ invoices, transactions, laborEntries, range, timeZone }): MonthlyMargin[]
  // MonthlyMargin { month:'YYYY-MM', revenueCents, cogs:{materials,labor,subcontractor,otherDirect,total},
  //                 marginCents, marginPct|null, severity|'none', invoiceCount, transactionCount }
  ```
  Cash basis: revenue = `paid` invoices by `paidDate`; costs = non-ignored, non-overhead transactions by `postedAt ?? date` with pending excluded; labor by entry date. Months zero-filled; `marginPct` is `null` at zero revenue.
- Severity thresholds stay 45 % / 25 % gross margin.

## 5. Data (`packages/db`)

Every table carries `owner_id`. Auth.js adapter tables via `@auth/drizzle-adapter`.

| Table | Notes |
|---|---|
| `users` | + `settings jsonb` (timeZone) |
| `projects` | money as `*_cents bigint` |
| `transactions` | + `posted_at, pending, raw_descriptor, merchant_name, source (manual\|csv\|plaid), provider, external_id, bank_account_id, pending_transaction_id, category_hint_*, user_edited_at, removed_at, import_batch_id`. Partial unique `(provider, bank_account_id, external_id) WHERE external_id IS NOT NULL`. |
| `import_batches` | lets the user undo an import |
| `labor_entries`, `invoices` | `invoices` indexed on `(owner_id, paid_date)` |
| `bank_connections` | `item_id, access_token_ciphertext, encryption_key_id, cursor, status, last_synced_at, last_error_*` |
| `bank_accounts` | absorbs the old `CardProfile`: mask, type, balances, limit, `is_enabled` |
| `webhook_events` | body-hash unique; 30-day retention |

Migrations are generated with `drizzle-kit generate`, committed, and applied by `pnpm db:migrate` in the Vercel build command. `push` is never used in CI.

## 6. Application (`apps/web`)

Reads happen in Server Components; writes in Server Actions (`auth()` → zod parse → repository → `revalidatePath`). REST routes exist only for machine callers: `/api/auth/*`, `/api/webhooks/plaid`, `/api/internal/sync`, `/api/import/csv`, `/api/health`.

## 7. Security model

- **Fail closed.** `middleware.ts` protects everything except an explicit allowlist (`/login`, `/privacy`, `/api/auth/*`, `/api/webhooks/plaid`, `/api/health`, static assets). Middleware checks cookie presence only; every server component, action, and route handler calls `auth()` for the authoritative DB-backed check.
- **Boot assertion.** In production the app refuses to start without `AUTH_SECRET`, a GitHub OAuth pair, a non-empty `ALLOWED_EMAILS`, a 32-byte `BANK_TOKEN_ENCRYPTION_KEY`, and `CRON_SECRET` when `PLAID_ENV=production`. `pnpm check:security` runs the same assertion in CI.
- **Two-compromise rule for bank tokens.** Tokens are AES-256-GCM encrypted with a key that lives only in the deployment environment. A database dump or leaked `DATABASE_URL` alone is useless.
- **No PAN, ever.** Plaid returns a last-four mask only. The system never stores, processes, or transmits a card number — a design fact, not a compliance claim.
- **Environment scoping.** Plaid production secrets and the encryption key are Production-only; previews run against Sandbox or fail to boot.
- **Machine endpoints.** Webhooks: ES256 JWT verification, 5-minute `iat` window, body-hash replay table. Cron: `CRON_SECRET` bearer.
- **Repo hygiene.** `gitleaks` pre-commit and CI, Dependabot, CodeQL, `pnpm audit`, exact-pinned `plaid` SDK, branch protection, signed tags.

## 8. Bank ingestion (design fixed now; built in sub-projects 2–3)

```ts
interface BankProvider {
  createLinkToken(args): Promise<{ linkToken; expiration }>;
  exchangePublicToken(publicToken): Promise<{ accessToken; itemId; institutionId?; institutionName? }>;
  getAccounts(accessToken): Promise<NormalizedAccount[]>;
  syncTransactions(accessToken, cursor: string | null): Promise<{ added; modified; removed; nextCursor; hasMore }>;
  removeItem(accessToken): Promise<void>;
  verifyAndParseWebhook(rawBody, headers): Promise<WebhookEvent>;
}
```

- Sign convention: **positive = money out**. Negative rows (card payments, refunds) are stored but default to `status: 'ignored'`.
- Sync service (app layer): advisory lock per connection, cursor committed after each page, upsert on the partial unique index.
- **Merge rule.** Provider-owned columns (amount, dates, pending, raw descriptor, merchant, hints) are always overwritten. User-owned columns (`projectId`, `status`, `notes`, `receiptNumber`; and `category`, `taxDeductible`, `vendor` once `user_edited_at` is set) are never overwritten by sync.
- **Pending → posted.** A posted transaction carrying `pendingTransactionId` inherits the pending row's user-owned columns, then the pending row is removed. A `removed` event on a categorized row soft-deletes (`removed_at`).
- Credit unions are typically OAuth institutions in Plaid: the app serves `/plaid/oauth-return`, and each self-hoster registers their own redirect URI. Test in Sandbox with "Platypus OAuth Bank".

## 9. Sub-project sequence

1. **Foundation + Locked Door** — monorepo, core extraction with tests, Postgres, auth gate, boot assertion, CI. No Plaid code ships before this is deployed.
2. **Bank connectors** — crypto, bank tables, `CsvProvider` rewrite, `PlaidProvider` + Link + OAuth return + sync service (Sandbox).
3. **Webhooks, cron, connection lifecycle** — re-auth banners, disconnect & delete, export / delete-all.
4. **Monthly gross margin** — core function + tests, chart, page; replace the hardcoded cash-flow waterfall.
5. **Docs, security audit, production** — `SECURITY.md`, threat model, release checklist, Plaid setup guide, self-hosting guides, privacy template, Deploy-to-Vercel button; owner applies for Plaid Production and links the real card.

## 10. Open verifications

- California Credit Union (ccu.com) presence and OAuth status in Plaid's institution list.
- Vercel Hobby cron granularity and `waitUntil` availability (design treats webhooks as primary, cron as a daily safety net).
