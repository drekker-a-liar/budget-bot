# Phase 2 — Plaid Sandbox Connector (Link + Sync)

**Status:** Approved 2026-08-21
**Builds on:** [System architecture](2026-08-20-system-architecture-design.md) §8, [ADR 0001](../../architecture/adr/0001-plaid-over-aggregators.md), [ADR 0002](../../architecture/adr/0002-app-level-token-encryption.md), [ADR 0004](../../architecture/adr/0004-transactions-sync-over-get.md)
**Out of scope (Phase 3):** webhooks and their JWT verification, cron, `ITEM_LOGIN_REQUIRED` re-auth, disconnect & delete, export/delete-all.

## 1. Goal

A signed-in owner connects a bank through Plaid Link (Sandbox first, Production later by env), the access token is stored encrypted, and a manual **Sync now** pulls transactions through `/transactions/sync` into the inbox under the merge rules of ADR 0004. Everything is verifiable without Plaid credentials; a local-only smoke script uses them when they exist.

## 2. Housekeeping that lands first

1. **Next 14.2 → 15.5.x with React 19**, pinned exact. The whole suite, the component tests and the Playwright journey must pass before anything else is touched. The `next` GHSA ignores in `pnpm-workspace.yaml` are removed unless an advisory genuinely remains unfixed at the new version (each survivor keeps its one-line reason). `middleware.ts` keeps its name (the `proxy.ts` rename is Next 16).
2. **CSV upload is `text/csv` only.** The multipart branch of `/api/import/csv` is removed; the client reads the chosen file with `File.text()` and posts the text. The stream cap and `Content-Length` checks stay.
3. **The core transaction type carries the bank columns.** `ExpenseTransaction` gains `postedAt: string | null`, `pending: boolean`, `source: 'manual' | 'csv' | 'plaid'`, `provider: string | null`, `externalId: string | null`, `bankAccountId: string | null`, `removedAt: string | null`, `userEditedAt: string | null`; the repo mapper surfaces them; `calculateWeeklyCashFlow`'s `postedAt ?? date` starts doing real work. Manual rows default `source: 'manual'`, `pending: false`.

## 3. `PlaidProvider` (`@budget-bot/bank-connectors`)

Implements the existing `BankProvider` interface with the official `plaid` SDK (exact-pinned). The Plaid client is **injected** (`new PlaidProvider({ client })` or a factory taking `{ clientId, secret, env }`), so tests never touch the network.

| Method | Plaid call | Notes |
|---|---|---|
| `createLinkToken({ userId, redirectUri, webhookUrl })` | `/link/token/create` | `products: ['transactions']`, `transactions.days_requested: 730`, `client_user_id: userId`, `redirect_uri`, `webhook` (reserved for Phase 3; may be omitted when unset). |
| `exchangePublicToken(publicToken)` | `/item/public_token/exchange` (+ `/item/get`, `/institutions/get_by_id` for name) | Returns `{ accessToken, itemId, institutionId?, institutionName? }`. The access token is returned **once**, to the caller that encrypts it. |
| `getAccounts(accessToken)` | `/accounts/get` | Maps to `NormalizedAccount` with balances and limit in cents. |
| `syncTransactions(accessToken, cursor)` | `/transactions/sync` | One page (`count: 500`). Returns `{ added, modified, removed, nextCursor, hasMore }`. Sign convention per ADR 0004: **positive = money out**, no flip. Carries `pendingTransactionId`, `merchantName`, `rawDescriptor = name`, `personal_finance_category` as hints, `authorizedDate`, `pending`. |
| `removeItem(accessToken)` | `/item/remove` | Implemented (cheap) but only called by Phase 3's disconnect flow. |
| `verifyAndParseWebhook` | — | Rejects with `NotSupportedError` until Phase 3. |

Errors are mapped to typed provider errors: `PlaidRateLimited` (backoff hint), `PlaidMutationDuringPagination` (caller restarts from its last committed cursor), `PlaidItemError(code)` (e.g. `ITEM_LOGIN_REQUIRED` — recorded on the connection, surfaced in UI, re-auth is Phase 3), `PlaidRequestError` for everything else. The SDK's raw error, which can include request ids, is logged through the redacting logger; access tokens never appear in any error or log.

**Fixtures.** `packages/bank-connectors/test/fixtures/plaid/*.json` are hand-authored to the documented response shapes: a three-page sync with `has_more`, a `modified` page, a `removed` page, a pending→posted pair, a rate-limit error body, a mutation-during-pagination error body, accounts with a credit card (`balances.limit`) and a checking account.

## 4. Storage and crypto wiring (`@budget-bot/db`)

No schema change is expected — Phase 1 created `bank_connections`, `bank_accounts` and the transaction columns. If something is missing it is a **new numbered migration**; `0000` is never edited again.

`bankRepo` gains:

- `createConnection(db, ownerId, { provider, itemId, accessToken, institutionId, institutionName, keyring })` — encrypts the token with AAD = the new connection id (two-step insert: create the row to obtain the id, then update the ciphertext in the same transaction). Returns the connection **without** the token.
- `withAccessToken(db, ownerId, connectionId, keyring, fn)` — decrypts inside the call, passes the plaintext only to `fn`, returns `fn`'s result. No other read path exposes ciphertext or plaintext.
- `upsertAccounts(db, ownerId, connectionId, accounts)` keyed on `(connection_id, external_id)`.
- `getConnection`, `listConnections(ownerId)` (metadata: institution, status, `last_synced_at`, `last_error_code`, account summaries), `setCursor`, `recordSyncResult`, `recordSyncError`.
- `withSyncLock(db, connectionId, fn)` — `pg_try_advisory_xact_lock(hashtext(connectionId))` inside a transaction; returns `{ skipped: true }` when another sync holds it.

`transactionsRepo`:

- `upsertFromBank` gets `setWhere: eq(transactions.ownerId, ownerId)`.
- `applyModified(rows)` updates **only** provider-owned columns (`amount_cents, date, authorized_date, posted_at, pending, pending_transaction_id, raw_descriptor, merchant_name, category_hint_*`) and never `project_id, status, notes, receipt_number, description`, nor `category, tax_deductible, vendor` when `user_edited_at IS NOT NULL`.
- `reconcilePending(ownerId, bankAccountId, postedRows)` — for each posted row carrying `pendingTransactionId`, copy the pending row's user-owned columns onto the posted row, then delete the pending row. One transaction.
- `applyRemoved(ownerId, bankAccountId, externalIds)` — rows with a `project_id` get `removed_at = now()` (soft); the rest are deleted.
- `updateTransactionCategoryAction` and `assignTransactionAction` stamp `user_edited_at = now()`.

**Cross-batch CSV dedupe** (optional, only if it stays small): a per-owner synthetic `bank_accounts` row (`provider: 'csv'`, `external_id: 'csv:<ownerId>'`) so CSV rows carry a non-null `bank_account_id` and the partial unique index dedupes across uploads. If it needs more than the repo change plus a test, it returns to the backlog.

## 5. Sync service (`apps/web/src/server/bank/sync.ts`)

```
runSync(ownerId, connectionId, { maxPages? }) →
  withSyncLock:
    cursor ← connection.cursor
    loop:
      page ← provider.syncTransactions(token, cursor)     // via withAccessToken
      tx:
        upsertFromBank(added, categorised, negatives → 'ignored')
        applyModified(modified)
        reconcilePending(added where pendingTransactionId)
        applyRemoved(removed)
        setCursor(page.nextCursor)                         // committed with the page
      until !hasMore or pages == maxPages
    recordSyncResult({ added, modified, removed, pages, hasMore })
  on PlaidMutationDuringPagination: restart from the last committed cursor (bounded retries)
  on PlaidRateLimited: stop, record, surface "try again in a minute"
  on PlaidItemError: record last_error_code, status 'reauth_required' for login errors
```

`categorizeVendor(merchantName ?? rawDescriptor)` runs on insert only. The first sync after Link runs in the exchange request with a page bound (e.g. 5 pages ≈ 2,500 transactions); the remainder is pulled by **Sync now**. The function returns a plain result object; nothing about the provider leaks into the caller.

## 6. Link flow and UI (`apps/web`)

- **Server actions:** `createLinkTokenAction()` (session → `createLinkToken` with `redirect_uri = ${origin}/plaid/oauth-return`), `exchangePublicTokenAction({ publicToken })` (exchange → `createConnection` → `getAccounts` → `upsertAccounts` → bounded `runSync`), `syncNowAction({ connectionId })`. All resolve the owner from the session; none accepts an owner id. Results use the existing `{ ok, data | error }` shape.
- **Pages:** `/settings/connections` — lists connections with institution, accounts (name, mask, type, balance, limit), last sync, last error; "Connect a bank" (a `react-plaid-link` island that fetches a link token on click and posts the public token back); "Sync now" per connection; a "Plaid isn't configured on this deployment" state when env is absent. `/plaid/oauth-return` — re-initialises Link with the `link_token` stashed in `sessionStorage` and `receivedRedirectUri: window.location.href`, then completes the exchange. Both routes are **session-gated**; the middleware allowlist does not change.
- **Navigation / dashboard:** the card profile is synthesised from the first enabled credit `bank_accounts` row; the hardcoded "Spark" label goes away; no card → the existing em-dash state.
- **Every new island ships with its colocated test** (the structural test enforces it).

## 7. Environment and boot assertion

- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox | production`, default `sandbox`) join the zod schema, `.env.example` (Required in: prod; preview = sandbox), `ci/env.production.fixture` (dummy values, pinned by the fixture test) and the gitleaks value allowlist if the dummies are secret-shaped.
- `assertProductionSecurity`: when `PLAID_ENV === 'production'`, all three must be present (and `CRON_SECRET`, already required); **`PLAID_ENV === 'sandbox'` is refused in production** — a production deployment must never quietly talk to Sandbox. Previews stay Sandbox by env scoping.
- The provider factory reads env once; UI degrades to the "not configured" state rather than throwing.

## 8. Testing

| Layer | What proves it |
|---|---|
| `PlaidProvider` | Unit tests against the fixtures: every method, pagination, sign convention, error mapping, no token in any error message. |
| `bankRepo` / `transactionsRepo` | Real Docker Postgres: token never readable via any list/get; `withAccessToken` round-trip with the real keyring; advisory lock excludes a concurrent sync; `applyModified` leaves user-owned columns; `reconcilePending` copies and deletes; `applyRemoved` soft vs hard; owner isolation on all of it. |
| `runSync` | Against Postgres with a `FakeBankProvider` (scripted pages): cursor committed per page, failure mid-run leaves the previous cursor, mutation-during-pagination restarts, rate limit stops cleanly, categoriser runs once, negatives ignored. |
| Actions | `auth()` mocked: no session → `{ ok: false }`; happy paths call the repos with the session owner; the structural action test picks up the new modules automatically. |
| Components | Colocated tests for the connections page islands and the OAuth return page (Link SDK mocked at the module boundary). |
| E2E | The Playwright journey gains: open Connections → "Connect a bank" (the `FakeBankProvider` is selected behind the existing `E2E=1` door) → accounts listed → "Sync now" → new rows in the inbox. |
| Live Sandbox smoke | `pnpm --filter web plaid:smoke` — local only, runs when `PLAID_CLIENT_ID`/`PLAID_SECRET` are set: `/sandbox/public_token/create` for Platypus OAuth Bank (`ins_127287`) → exchange → `getAccounts` → sync to exhaustion, printing counts only. Not in CI. |

## 9. Security notes specific to this phase

- The access token exists in plaintext only inside `exchangePublicTokenAction` (for the duration of `createConnection`) and inside `withAccessToken`'s callback. It is never returned to a client, never logged, never in an error.
- The `FakeBankProvider` is selectable **only** behind the `E2E=1` door, with the same two production guards as the credentials provider; a third guard is unnecessary because the door itself cannot open in production (proven in Phase 1).
- `redirect_uri` is built from the request origin / `AUTH_URL`, never from client input.
- Link tokens are short-lived and user-bound (`client_user_id`); the OAuth return page rejects a `link_token` that is not in `sessionStorage`.

## 10. Deliverable

When the phase closes: an owner on a Sandbox-configured deployment can connect Platypus OAuth Bank, see accounts and balances, press Sync now, and find categorised transactions in the inbox with pending → posted handled; all of it covered by tests that do not need Plaid credentials; the founder's Sandbox keys run the smoke script and nothing else.
