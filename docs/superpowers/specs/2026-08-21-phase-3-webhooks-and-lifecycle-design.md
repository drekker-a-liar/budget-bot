# Phase 3 — Webhooks, Cron, and Connection Lifecycle

**Date:** 2026-08-21
**Status:** Approved (scope delegated by Tyler 2026-08-21: "do all the stuff needed to keep this project moving"; architecture fixed in the Phase 1 spec §7/§8 and ADR 0004)
**Builds on:** Phase 2 (PR #8, merge `b3d3ff2`) — PlaidProvider, encrypted token storage, `runSync`, Connections UI.

## 1. Goal

A linked bank stays current and stays healthy without the user pressing "Sync now":
Plaid pushes updates to a verified webhook, a daily cron catches anything the
webhook missed, a connection that needs re-authentication says so and offers a
one-click fix, and the user can disconnect a bank — or export / delete
everything — from the settings page.

**In scope:** webhook verification + endpoint + replay ledger; cron safety net +
retention; re-auth (Link update mode, and re-link upsert); disconnect & delete;
data export and delete-all; CSV cross-batch dedupe; UNKNOWN_ACCOUNT surfacing;
stable account ordering; ESLint 9 flat-config migration (promised when
Dependabot #6 was closed).

**Out of scope:** monthly margin visualization (Phase 4), production Plaid
application and real CCU link (Phase 5), Plaid Assets/Liabilities products,
multi-item-per-institution support.

## 2. Webhook verification (provider layer)

`PlaidProvider.verifyAndParseWebhook(rawBody, headers)` replaces its Phase 2
`NotSupportedError` stub. Plaid signs webhooks with an ES256 JWT in the
`plaid-verification` header (spec §7 fixed this in Phase 1):

1. Decode the JWT header; require `alg === 'ES256'` (reject anything else
   before any crypto — `alg: none` and HS256 downgrade attacks die here).
2. Fetch the verification key for the JWT's `kid` via
   `/webhook_verification_key/get`; cache keys per provider instance in a
   `Map<kid, JWK>` (keys rotate rarely; a cache miss refetches once).
3. Verify the signature, then require `iat` within the last **5 minutes**.
4. Compute `sha256(rawBody)` and compare to the JWT claim
   `request_body_sha256` with `crypto.timingSafeEqual`.
5. On success return `WebhookEvent { type, code, itemId, bodyHash, payload }`
   where `bodyHash = sha256(rawBody)` hex. On any failure throw
   `WebhookVerificationError` (new class in `plaid/errors.ts`, funneled like
   the others; never contains the token — there is no token in this path).

JWT verification uses `jose` (already ESM-friendly, zero deps, used by Auth.js —
no new supply-chain surface beyond what auth already trusts). Exact-pin not
required (it is not the Plaid SDK); normal caret range.

`FakeBankProvider.verifyAndParseWebhook` (E2E door only, quadruple-guarded from
Phase 2): accepts when header `fake-verification` equals `sha256(rawBody)` hex;
returns the parsed body's `webhook_type/webhook_code/item_id`. This exists so
the e2e journey can exercise the webhook → sync path without Plaid.

## 3. Webhook endpoint `/api/webhooks/plaid`

Already on the middleware public allowlist (Phase 1). A `route.ts` POST handler:

- Read the **raw body text** before any JSON parse (the signature covers bytes).
- Resolve the provider via `getBankProvider()`; if no provider configured → 200
  (a deployment without Plaid ignores webhooks; nothing to learn from a 4xx).
- `verifyAndParseWebhook` → on `WebhookVerificationError` return **401**, body
  `{ok:false}` — the only non-200. Everything else returns **200** so Plaid
  neither retries forever nor learns which item ids exist here.
- **Replay ledger:** insert into `webhook_events` keyed by unique `body_hash`;
  on conflict → 200 `{ok:true, duplicate:true}`, no reprocessing. The row
  records `provider/item_id/webhook_type/webhook_code/received_at`; `owner_id`
  is filled after item resolution; `processed_at`/`error` afterwards.
- Resolve `itemId` → connection (+ owner). Unknown item → mark row processed,
  200. Then dispatch by type/code:
  - `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE` → `runSync` for that connection
    (await inline; single-item sync fits comfortably in a function invocation;
    the per-page advisory lock makes a concurrent manual sync safe).
  - `ITEM` / `ERROR` with `ITEM_LOGIN_REQUIRED` (or `error.error_code` saying
    so), `ITEM` / `PENDING_EXPIRATION`, `ITEM` / `USER_PERMISSION_REVOKED` →
    `recordSyncError(... status:'reauth_required')` with the code preserved.
  - `ITEM` / `WEBHOOK_UPDATE_ACKNOWLEDGED` and everything unrecognized →
    record + mark processed, no-op.
- Handler failures after verification: record `error` on the ledger row, still
  return 200 (the cron is the retry mechanism; Plaid redelivery is not).

## 4. Cron safety net `/api/internal/sync`

- `GET` (Vercel cron issues GET) guarded by `Authorization: Bearer CRON_SECRET`
  (constant-time compare). `CRON_SECRET` unset → 503 and the route does
  nothing (production with Plaid already requires it at boot; previews and
  bare local runs simply have the route disabled).
- For every connection with `status = 'active'` **across all owners**: refresh
  accounts (`getAccounts` → `upsertAccounts`), then `runSync`. Failures on one
  connection are recorded (`recordSyncError` — the existing classifier maps
  `ITEM_LOGIN_REQUIRED` to `reauth_required`) and do not stop the rest.
- Purge `webhook_events` older than **30 days** in the same run.
- Response: counts only — `{connections, synced, failed, purgedEvents}` — no
  ids, no names.
- `vercel.json` gains `"crons": [{"path": "/api/internal/sync", "schedule": "0 6 * * *"}]`.
  Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when the env
  var is set. Webhooks are primary; this is the daily net (Phase 1 §7).

*Amended after final review (2026-08-25): the sweep above read `status =
'active'` only, which follows this section's letter but misses §3's intent —
the cron is "the retry mechanism for whatever [the webhook] could not
finish," and a failed sync is exactly what sets `status = 'error'`
(`recordSyncError` via `INSTITUTION_DOWN`, `RATE_LIMIT_EXCEEDED`,
`SYNC_FAILED`, `SYNC_WRITE_SHORTFALL`, or `UNKNOWN_ACCOUNT` on an otherwise
successful run). An errored connection that the webhook path cannot reach
again — no webhook registered on that item, or one transient failure during
the nightly run — was stuck in `'error'` forever. The sweep now reads
`status IN ('active', 'error')`, renamed `listSyncableConnectionsAllOwners` to
say so; `'error'` clears back to `'active'` the same way a webhook-driven
retry already self-heals it, through `recordSyncResult`. `'reauth_required'`
stays excluded on purpose: that status means the stored token itself no
longer works, and no amount of retrying fixes it — only the owner,
reconnecting through Link's update mode (§5), can.*

## 5. Re-authentication

Two paths back to healthy, both ending in status `'active'`:

**a) Link update mode.** New server action
`createReauthLinkTokenAction(connectionId)`: `withAccessToken` →
`provider.createLinkToken({userId, redirectUri, accessToken})` (the interface
has carried `accessToken` since Phase 2 for exactly this). The Connections UI
shows a banner on any `reauth_required`/`error` connection with the recorded
error message and a **Reconnect** button that opens Link in update mode. Update
mode ends with no public token exchange; on `onSuccess` the island calls
`markReconnectedAction(connectionId)` → set status `'active'`, clear the error
columns, refresh accounts, `runSync`.

**b) Re-link upsert.** Phase 2's `exchangePublicTokenAction` maps a duplicate
`(provider, item_id)` to "This bank is already connected." Phase 3 replaces
that: on `ConnectionAlreadyExistsError`, **update the existing row** — new repo
function `replaceConnectionToken(db, ownerId, {itemId, accessToken, keyring})`
re-encrypts the new token (fresh AAD = the existing row id), sets status
`'active'`, clears errors, keeps the cursor (same item ⇒ cursor still valid;
Plaid documents cursor per item). Ownership check: the existing row must belong
to the caller; a different owner's row → the Phase 2 "already connected"
message stands (no cross-tenant token overwrite).

`applyModified`/user-edit merge rules are untouched; re-auth never rewrites
transactions.

## 6. Disconnect, export, delete-all (settings)

- **Disconnect** — `disconnectConnectionAction(connectionId)`: best-effort
  `provider.removeItem` inside `withAccessToken` (failure is logged into the
  action result but does not block), then delete the connection row. Cascade
  removes its `bank_accounts`; `transactions.bank_account_id` is `SET NULL`, so
  the ledger keeps every filed row. UI: per-connection "Disconnect" with an
  inline type-to-confirm ("disconnect").
- **Export my data** — `/api/export` (GET, auth-gated like every route): one
  JSON document of the owner's projects, transactions, labor entries, invoices,
  import batches, and connection **metadata** (institution, status, accounts
  with masks — never ciphertext, never cursor). `Content-Disposition:
  attachment; filename="budget-bot-export-<date>.json"`.
- **Delete all my data** — `deleteAllDataAction`: per connection best-effort
  `removeItem`, then delete the owner's rows in every domain table (bank
  connections cascade first so SET NULL has nothing to null). Auth.js
  user/session rows survive (the account still exists; its data is gone).
  Type-to-confirm ("delete everything") in a settings "Danger zone" section.

## 7. CSV cross-batch dedupe

Phase 2 left CSV dedupe within-batch only: the upsert index
`(provider, bank_account_id, external_id)` never conflicts when
`bank_account_id` is NULL (SQL NULLs are distinct), so re-importing the same
file duplicates every row. Fix: a second partial unique index
`transactions_owner_csv_external_key` on `(owner_id, external_id) WHERE
provider = 'csv' AND external_id IS NOT NULL`, and the CSV import path upserts
`ON CONFLICT` on that index (skip on conflict, count as `skipped`). Ruling
(supersedes the ledgered "synthetic csv bank_account" idea): an index is the
whole fix; a synthetic connection row would need dummy ciphertext and exists
only to satisfy a NOT NULL — worse in every way. Migration + backfill note: no
backfill; existing duplicates (if any) predate the index and are left to the
user's judgment — the index is created `NOT VALID`-free since dev data only.

## 8. Small fixes

- `runSync` counts rows skipped as `UNKNOWN_ACCOUNT` and returns
  `unknownAccountCount` in `SyncOutcome`; `recordSyncResult` stores nothing new
  (transient count); the Connections UI shows "N rows referenced accounts this
  connection doesn't track" after a sync that had any.
- `listAccounts` orders by `(name, id)` so the settings page stops reshuffling.
- `createLinkTokenAction` passes `webhookUrl = origin + '/api/webhooks/plaid'`
  only when the origin is `https:` (a localhost webhook URL is unreachable
  noise in Plaid's dashboard).

## 9. Toolchain: ESLint 9 flat config

Migrate `packages/config` eslint to flat config (`eslint.config.js` with
`typescript-eslint` v8), preserving every current rule including the
per-package `no-restricted-imports` boundary enforcement, then bump eslint to
9.x. Zero new warnings allowed; the boundary rules get a structural test if the
migration cannot express them identically. This was promised when Dependabot #6
(eslint 10) was closed; 9.x flat config is the stepping stone.

## 10. Security invariants (unchanged and extended)

- Access tokens: still only decrypted inside `withAccessToken`; the webhook and
  cron paths use the same funnel. No new decrypt sites.
- Webhook endpoint: signature verified before any DB write except the replay
  ledger row (which stores only hashes and Plaid-assigned ids, never payload
  secrets — `payload` is passed to the dispatcher in memory, not persisted).
- The only unauthenticated writes in the app remain: webhook ledger row
  (signature-gated). Cron is CRON_SECRET-gated; export/delete are session-gated
  and owner-scoped like every action.
- No new env variables. `.env.example` and the env structural tests are
  untouched except where text mentions the cron schedule.

## 11. Testing

Vitest throughout, colocated; component tests for every new/changed island
(standing rule). Key suites: JWT verification (alg confusion, expired iat, bad
body hash, unknown kid refetch, happy path — keys generated in-test with
`jose`); webhook route (401 on bad signature, replay 200-duplicate, unknown
item, sync dispatch, reauth marking); cron (auth, per-connection isolation of
failures, purge); re-auth actions (ownership, token replacement AAD, cursor
kept); disconnect (removeItem failure still deletes, SET NULL verified);
export (no ciphertext/cursor in output — asserted by walking the JSON);
delete-all (other owner untouched); CSV re-import (second import all skipped);
e2e journey extension: webhook-driven sync via fake provider, reauth banner →
reconnect, disconnect. Route-gating and public-api structural tests updated to
know the two new routes.
