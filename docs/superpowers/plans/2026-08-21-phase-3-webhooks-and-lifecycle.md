# Phase 3 — Webhooks, Cron & Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linked banks stay current and healthy without manual syncs: verified Plaid webhooks, a daily cron net, one-click re-auth, disconnect, and export/delete-all.

**Architecture:** Provider-layer JWT verification feeds a public-but-signature-gated webhook route with a replay ledger; a CRON_SECRET-gated internal route is the daily net; lifecycle actions reuse `withAccessToken` and the Phase 2 merge rules untouched.

**Tech Stack:** Next 15.5 / React 19, Drizzle + Postgres, plaid@46 (exact-pinned), `jose` for ES256 JWT, Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-webhooks-and-lifecycle-design.md` (the binding authority; §ns below refer to it)

## Global Constraints

- Access tokens are decrypted ONLY inside `withAccessToken` (ADR 0002). No task may add another decrypt site.
- No token, ciphertext, cursor, or secret value ever appears in a response body, log line, error message, or export (spec §6, §10).
- Positive amount = money out (interface doc in `packages/bank-connectors/src/types.ts`).
- Every `.tsx` exporting a React component ships a colocated `*.test.tsx` (structural test enforces).
- Every repo function takes `(db, ownerId, ...)` and is owner-scoped, except webhook/cron paths which are explicitly cross-owner and must say so in a doc comment.
- `plaid` stays exact-pinned at 46.0.0. `jose` is the only new dependency (caret range).
- The webhook route returns 401 only for signature failure; every other outcome is 200 (spec §3).
- No new environment variables; `.env.example` and env structural tests stay in sync mechanically.
- Component/behaviour changes land with their tests in the same commit; run `pnpm turbo lint typecheck test build` green before each task's final commit.

---

### Task 1: Webhook verification in the providers

**Files:**
- Modify: `packages/bank-connectors/src/plaid/provider.ts` (replace `verifyAndParseWebhook` stub)
- Modify: `packages/bank-connectors/src/plaid/errors.ts` (add `WebhookVerificationError`)
- Modify: `packages/bank-connectors/package.json` (add `jose`)
- Modify: `apps/web/src/server/bank/fake-provider.ts` (implement `verifyAndParseWebhook`)
- Test: `packages/bank-connectors/src/plaid/provider.webhook.test.ts`, extend `apps/web/src/server/bank/fake-provider.test.ts`

**Interfaces:**
- Consumes: `PlaidClientLike` (add `webhookVerificationKeyGet` to the injected surface), existing `WebhookEvent` type.
- Produces: `verifyAndParseWebhook(rawBody: string, headers: Record<string,string>): Promise<WebhookEvent>` throwing `WebhookVerificationError` (message safe to log; never includes body or JWT). Header name: `plaid-verification` (lower-cased lookup; treat header keys case-insensitively). Fake provider accepts when `headers['fake-verification'] === sha256hex(rawBody)`.

Spec §2 is the requirements list (alg allowlist ES256 → kid → cached JWK fetch → signature → iat ≤ 300s → timingSafeEqual body hash). Tests generate an ES256 key pair with `jose` in-test and sign real JWTs: happy path; `alg:none` and HS256 rejected before key fetch (assert the injected client was never called); stale `iat` (301s) rejected; wrong `request_body_sha256` rejected; unknown `kid` triggers exactly one refetch then rejects; key cache hit skips fetch. TDD each case; commit per green step.

### Task 2: Replay ledger repo + webhook route

**Files:**
- Create: `packages/db/src/repos/webhookEvents.ts`; export from `packages/db/src/repos/index.ts`
- Create: `apps/web/app/api/webhooks/plaid/route.ts`
- Modify: `apps/web/test/route-gating.test.ts` + public-api structural test (route is public by design)
- Test: `packages/db/src/repos/webhookEvents.test.ts`, `apps/web/app/api/webhooks/plaid/route.test.ts`

**Interfaces:**
- Produces (repo, cross-owner by design — say so in doc comment):
  - `recordWebhookEvent(db, {provider, bodyHash, itemId, webhookType, webhookCode}): Promise<{id: string} | {duplicate: true}>` (INSERT ... ON CONFLICT (body_hash) DO NOTHING RETURNING id)
  - `resolveWebhookOwner(db, eventId, ownerId): Promise<void>`
  - `markWebhookProcessed(db, eventId, error?: string): Promise<void>`
  - `purgeWebhookEvents(db, olderThanDays: number): Promise<number>`
- Produces (route): POST handler per spec §3 exactly. Reads `await request.text()` first. `findConnectionByItemId(db, itemId)` — add to `packages/db/src/repos/bank.ts`, cross-owner doc comment, returns `{id, ownerId, status} | null` (no ciphertext column in projection).
- Consumes: Task 1 `verifyAndParseWebhook`; `runSync` + `getBankProvider` + keyring loading exactly as `syncNowAction` does today (copy its wiring, not its auth).

Dispatch map (spec §3): TRANSACTIONS/SYNC_UPDATES_AVAILABLE → runSync; ITEM codes {ERROR w/ ITEM_LOGIN_REQUIRED, PENDING_EXPIRATION, USER_PERMISSION_REVOKED} → `recordSyncError(..., {status:'reauth_required', code, message})`; else no-op. Route tests use the fake provider path (inject via the E2E door pattern already used by action tests) covering: 401 bad signature; 200+duplicate on replay; unknown item → processed, 200; sync dispatch calls runSync once; ITEM error marks reauth; post-verification handler crash → error recorded on row, still 200.

### Task 3: Cron route + retention

**Files:**
- Create: `apps/web/app/api/internal/sync/route.ts`
- Modify: `vercel.json` (add crons block, spec §4), route-gating/public-api tests (route is public-with-bearer)
- Modify: `apps/web/middleware.ts` matcher — add `api/internal/sync` to the allowlist (it authenticates by bearer, not session) and `apps/web/test/middleware-allowlist.test.ts`
- Test: `apps/web/app/api/internal/sync/route.test.ts`

**Interfaces:**
- Produces: GET handler; 503 when CRON_SECRET unset; 401 on wrong/missing bearer (timingSafeEqual over equal-length buffers, length-check first); otherwise iterate `listActiveConnectionsAllOwners(db)` (add to `packages/db/src/repos/bank.ts`, cross-owner doc comment, projection without ciphertext... except runSync needs withAccessToken by id — reuse per-connection `withAccessToken` exactly as today), per-connection `getAccounts→upsertAccounts→runSync` with try/catch per connection recording failures; then `purgeWebhookEvents(db, 30)`. Response body `{connections, synced, failed, purgedEvents}` only.
- Consumes: Task 2 purge; existing sync wiring.

Tests: 503/401/200 matrix; one failing connection doesn't stop the second (fake provider script); purge count returned; response contains no ids (walk JSON keys).

### Task 4: Re-authentication (update mode + re-link upsert)

**Files:**
- Modify: `packages/db/src/repos/bank.ts` — add `replaceConnectionToken(db, ownerId, {itemId, accessToken, keyring}): Promise<{id: string} | null>` (null = row exists but different owner; re-encrypt with AAD = existing row id, status 'active', clear lastError*, KEEP cursor — spec §5) and `markConnectionActive(db, ownerId, connectionId)` (status 'active', clear error columns).
- Modify: `apps/web/src/server/actions/bank.ts` — add `createReauthLinkTokenAction(input)` and `markReconnectedAction(input)` (zod-parse connectionId; markReconnected = markConnectionActive → refresh accounts → runSync, mirroring syncNowAction); change `exchangePublicTokenAction`'s `ConnectionAlreadyExistsError` branch: call `replaceConnectionToken`; null → keep Phase 2 "already connected" message; success → refresh accounts + sync (same as create path).
- Modify: `apps/web/app/settings/connections/ConnectionsView.tsx` (+ its test) — banner on status `reauth_required`/`error` showing `lastErrorMessage`, Reconnect button wiring Link update mode via the same island pattern as `ConnectBankButton` (fake kind: skip Link, call markReconnected directly).
- Modify: structural `actions` test count.
- Test: colocated repo/action/component tests.

**Interfaces:**
- Consumes: `provider.createLinkToken({userId, redirectUri, accessToken})` (exists since Phase 2); `withAccessToken`; `CONNECTION_COLUMNS`.
- Produces: the two new actions returning the existing `ActionResult` shape.

Key tests: replaceConnectionToken re-encrypts decryptably via `loadKeysFromEnv` both sides and keeps cursor; wrong-owner returns null and leaves row untouched; exchange upsert path end-to-end with fake provider; banner renders message + Reconnect fires action (component test, action mocked at module boundary).

### Task 5: Disconnect

**Files:**
- Modify: `packages/db/src/repos/bank.ts` — `deleteConnection(db, ownerId, connectionId): Promise<boolean>`
- Modify: `apps/web/src/server/actions/bank.ts` — `disconnectConnectionAction(input)`: withAccessToken→provider.removeItem in try/catch (failure noted in result `{removed: false}` but deletion proceeds), then deleteConnection; structural actions count.
- Modify: `ConnectionsView.tsx` + test — Disconnect with inline type-"disconnect" confirm.
- Test: repo test proves cascade deletes bank_accounts and `transactions.bank_account_id` becomes NULL while rows survive.

### Task 6: Export & delete-all

**Files:**
- Create: `apps/web/app/api/export/route.ts` (auth-gated GET; spec §6 shape; `Content-Disposition` attachment)
- Modify: `apps/web/src/server/actions/bank.ts` or new `apps/web/src/server/actions/account.ts` — `deleteAllDataAction()`: per-connection best-effort removeItem, then owner-scoped deletes (connections first), Auth.js rows survive; structural actions count.
- Create: settings Danger-zone island `apps/web/app/settings/DangerZone.tsx` (+ test) with type-"delete everything" confirm; wire into settings page.
- Modify: route-gating test (export must be PROTECTED — assert it, don't allowlist it).
- Test: export walked recursively — assert no key named or value shaped like ciphertext/cursor/token appears; delete-all leaves a second owner's rows intact.

### Task 7: CSV cross-batch dedupe

**Files:**
- Modify: `packages/db/src/schema/transactions.ts` — partial unique index `transactions_owner_csv_external_key` on `(owner_id, external_id) WHERE provider = 'csv' AND external_id IS NOT NULL`; generate migration (verify emitted SQL includes the WHERE — same drizzle-kit check as Phase 1's partial index).
- Modify: CSV import path in `packages/db/src/repos/imports.ts` (or where the csv upsert lives) — ON CONFLICT on the new index → skip, count `skipped`.
- Test: import same file twice → second reports all rows skipped, row count unchanged; different owner importing same file → rows land (owner-scoped index).

### Task 8: Small fixes (one dispatch)

**Files:** `apps/web/src/server/bank/sync.ts` (+test) — `unknownAccountCount` in `SyncOutcome` returned through `RunSyncResult`; `packages/db/src/repos/bank.ts` `listAccounts` ORDER BY (name, id) (+test); `apps/web/src/server/actions/bank.ts` `createLinkTokenAction` passes `webhookUrl` only when origin protocol is https (+test); ConnectionsView shows the unknown-account note after sync (+component test).

### Task 9: e2e journey extension

**Files:** extend `apps/web/e2e` journey: webhook POST with `fake-verification` header drives a sync that appears in the UI; force a reauth (fake provider script) → banner → Reconnect → active; disconnect → connection gone, transactions remain. Keep the 10-step Phase 2 journey passing; ci fixture untouched.

### Task 10: ESLint 9 flat config

**Files:** `packages/config` eslint → flat `eslint.config.js` with `typescript-eslint@^8`, eslint `^9`; preserve every rule incl. per-package `no-restricted-imports` boundaries; all package `.eslintrc*` removed; lefthook + CI unchanged in behaviour. Acceptance: `pnpm turbo lint` green with zero new disables; deliberately add a forbidden import locally and show lint fails (then remove) — record in report.

---

Each task: TDD (failing test → minimal code → green → commit), full turbo suite green before final commit of the task.
