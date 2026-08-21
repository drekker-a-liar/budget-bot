# Phase 2 — Plaid Sandbox Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in owner connects a bank through Plaid Link, the access token is stored AES-GCM-encrypted, and **Sync now** pulls `/transactions/sync` pages into the inbox under ADR 0004's merge rules — all verifiable without Plaid credentials.

**Architecture:** `PlaidProvider` (stateless, client injected) lives in `@budget-bot/bank-connectors` behind the existing `BankProvider` interface. `@budget-bot/db` owns token storage (`createConnection` / `withAccessToken`), the advisory sync lock, and the three write primitives the merge rule needs (`applyModified`, `reconcilePending`, `applyRemoved`). `apps/web/src/server/bank/sync.ts` composes them page by page, committing the cursor with each page. Server actions + a `/settings/connections` page + `/plaid/oauth-return` drive it; a `FakeBankProvider` behind the existing `E2E=1` door makes the Playwright journey and the sync-service tests credential-free.

**Tech Stack:** Next 15.5.x + React 19, Auth.js v5, Drizzle + postgres.js, `plaid@46` (exact), `react-plaid-link@5`, vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-2-plaid-sandbox-connector-design.md` (binding), which builds on `docs/superpowers/specs/2026-08-20-system-architecture-design.md` §8 and ADRs 0001/0002/0004.

## Global Constraints

- Next upgraded to the latest **15.5.x** (15.5.23 at plan time) with **React 19**; all versions pinned exact; `middleware.ts` keeps its name.
- Money is integer cents (`Cents`); Plaid amounts converted with `parseMoney(amount)`; **positive = money out**, no sign flip (ADR 0004).
- Every repo function is `(db, ownerId, …)`; no action/query/route accepts an owner id from the client.
- The access token is plaintext only inside `exchangePublicTokenAction` (during `createConnection`) and inside `withAccessToken`'s callback; never returned by a repo read, never logged, never in an error message.
- `upsertFromBank` / `applyModified` touch only provider-owned columns: `amount_cents, date, authorized_date, posted_at, pending, pending_transaction_id, raw_descriptor, merchant_name, category_hint_primary, category_hint_detailed, updated_at`. Never `project_id, status, notes, receipt_number, description`; never `category, tax_deductible, vendor` when `user_edited_at IS NOT NULL`.
- Migrations: `0000_initial_schema.sql` is never edited; any schema change is a new numbered migration.
- Every `.tsx` exporting a component ships with a colocated `*.test.tsx` (the structural test `apps/web/test/component-tests.test.ts` enforces it); every new server action is picked up by `apps/web/test/actions.test.ts` (structural).
- `PLAID_ENV=sandbox` is refused in production by `assertProductionSecurity`; `PLAID_ENV=production` requires `PLAID_CLIENT_ID`, `PLAID_SECRET`, `CRON_SECRET`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01YUSyUXym8v2cn2YiJ2Jo2r`.
- Work from `/Users/tylerschmidt/Projects/budget-bot` on branch `feat/plaid-sandbox-connector`; Docker Postgres via `pnpm db:up` (127.0.0.1:5433); never push; no external resources.

---

## File structure

```
apps/web/
  src/env.ts                                   # + PLAID_CLIENT_ID/SECRET/ENV, assertion rules
  src/server/bank/provider.ts                  # getBankProvider(): Plaid | Fake (E2E) | null (unconfigured)
  src/server/bank/sync.ts                      # runSync()
  src/server/bank/fake-provider.ts             # FakeBankProvider (scripted pages)
  src/server/actions/bank.ts                   # createLinkTokenAction, exchangePublicTokenAction, syncNowAction
  src/server/queries/connections.ts            # getConnectionsPage(ownerId)
  app/settings/connections/page.tsx            # RSC
  app/settings/connections/ConnectionsView.tsx # island (+ .test.tsx)
  app/settings/connections/ConnectBankButton.tsx (+ .test.tsx)   # react-plaid-link
  app/plaid/oauth-return/page.tsx              # RSC shell
  app/plaid/oauth-return/OAuthReturn.tsx (+ .test.tsx)
  scripts/plaid-smoke.ts                       # local-only live Sandbox smoke
  test/sync.test.ts                            # runSync against Postgres + FakeBankProvider
  e2e/smoke.spec.ts                            # + connect/sync steps
packages/bank-connectors/
  src/plaid/provider.ts, src/plaid/errors.ts, src/plaid/normalize.ts
  test/plaid/*.test.ts, test/fixtures/plaid/*.json
packages/db/
  src/repos/bank.ts (extended), src/repos/transactions.ts (extended), src/repos/sync-lock.ts
  test/repos/bank.test.ts, test/repos/bank-sync-writes.test.ts
packages/core/src/types.ts, schemas.ts            # bank columns on ExpenseTransaction
docs/self-hosting/{vercel,local}.md, .env.example, ci/env.production.fixture, CHANGELOG.md
```

---

### Task 1: Next 15.5 + React 19 upgrade

**Files:**
- Modify: `apps/web/package.json`, `pnpm-workspace.yaml` (auditConfig), `apps/web/next.config.mjs`, `apps/web/instrumentation.ts`, any `page.tsx` using `params`/`searchParams` (Next 15 makes them Promises), `apps/web/app/projects/[id]/page.tsx`
- Test: the whole existing suite; `apps/web/e2e/smoke.spec.ts`

**Interfaces:** none new. Produces a green tree on Next 15.5.x / React 19 that every later task builds on.

- [ ] **Step 1: Record the baseline**

Run: `pnpm turbo test --force 2>&1 | grep -E "Tests +|Tasks:"` and `E2E=1 pnpm --filter web e2e 2>&1 | tail -3`
Expected: all green (≈712 unit, 6 e2e). Paste counts in your report.

- [ ] **Step 2: Upgrade**

```bash
cd apps/web
pnpm add next@15.5.23 react@19.1.1 react-dom@19.1.1 --save-exact
pnpm add -D @types/react@19 @types/react-dom@19 eslint-config-next@15.5.23 --save-exact
# keep @testing-library/react >= 16 (React 19 support); check: pnpm why @testing-library/react
```
(Use the exact latest 15.5.x / 19.x that `npm view` prints at execution time if these have moved; pin exact.)

- [ ] **Step 3: Run the official codemod, then typecheck**

Run: `pnpm dlx @next/codemod@latest upgrade latest --dry` is NOT wanted (it targets 16). Run instead: `pnpm dlx @next/codemod@15 next-async-request-api apps/web` to convert `params`/`searchParams`/`cookies()`/`headers()` usages, then `pnpm typecheck`.
Expected: typecheck errors point at exactly the async-request-API sites; fix each: `const { id } = await params;` in `app/projects/[id]/page.tsx`; `await searchParams` in `app/login/page.tsx` if it reads `error`.

- [ ] **Step 4: `next.config.mjs`** — `experimental.instrumentationHook` is no longer needed (instrumentation is stable in 15); remove it. Keep `transpilePackages`. Run `pnpm --filter web build`; fix any remaining build error (typical: `react-dom` `useFormState` → `useActionState` from `react`).

- [ ] **Step 5: Drop the GHSA ignores and re-audit**

Edit `pnpm-workspace.yaml` `auditConfig.ignoreGhsas`: remove every `next` advisory. Run: `pnpm audit --prod --audit-level=high`.
Expected: exit 0. If an advisory remains for 15.5.x, re-add only that id with a one-line reason.

- [ ] **Step 6: Full verification**

Run: `pnpm turbo lint typecheck test build --force` then `E2E=1 pnpm --filter web e2e`.
Expected: everything green; same test counts as Step 1 (±0). Paste both.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build: Next 15.5 + React 19; drop the next GHSA ignores

…footer…"
```

---

### Task 2: CSV upload is `text/csv` only

**Files:**
- Modify: `apps/web/app/api/import/csv/route.ts`, `apps/web/src/client/useTransactionInboxActions.ts` (the `fetch` at ~:64), `apps/web/components/TransactionInbox.tsx` (file input handler), `apps/web/test/import-csv-route.test.ts`, `apps/web/components/TransactionInbox.test.tsx`
- Docs: `README.md` (import section), `CHANGELOG.md`

**Interfaces:** Produces `POST /api/import/csv` accepting only `Content-Type: text/csv` (body = file text, `Content-Length` required, ≤ `CSV_IMPORT_MAX_BYTES`); multipart → `415`.

- [ ] **Step 1: Failing tests** (in `test/import-csv-route.test.ts`)

```ts
it('refuses multipart now that the client sends text/csv', async () => {
  const form = new FormData();
  form.set('file', new File(['Date,Description,Amount\n'], 'a.csv', { type: 'text/csv' }));
  const res = await POST(request('/api/import/csv', { method: 'POST', body: form }));
  expect(res.status).toBe(415);
  expect(db.importCsvBatch).not.toHaveBeenCalled();
});
```
Update the existing multipart happy-path tests to post `text/csv` bodies.

- [ ] **Step 2: Run → FAIL** (`pnpm --filter web exec vitest run test/import-csv-route.test.ts`): multipart currently returns 200.

- [ ] **Step 3: Implement** — in `route.ts` `readUpload`: if `content-type` does not start with `text/csv` → `return problem(415, 'Send the file contents as text/csv')`; delete the `formData()` branch and the `file.size` re-check; keep `assertDeclaredSizeIsSane` + `readCappedText`. In `useTransactionInboxActions.ts`: `const text = await file.text(); fetch('/api/import/csv', { method: 'POST', headers: { 'content-type': 'text/csv', 'content-length': String(new TextEncoder().encode(text).byteLength) }, body: text })` — note browsers set `Content-Length` themselves for string bodies; keep the header computation only if the route needs it on the test side, otherwise rely on the browser.

- [ ] **Step 4: Run → PASS**; update `TransactionInbox.test.tsx` so the file-input test asserts the callback receives the file's **text** (mock `File.prototype.text`).

- [ ] **Step 5: Commit** — `feat(import): CSV upload is text/csv only; multipart and its pre-check buffering are gone`.

---

### Task 3: Bank columns on the core transaction type

**Files:**
- Modify: `packages/core/src/schemas.ts` (`TransactionInput` stays the *form* schema; add a `BankTransactionFields` object), `packages/core/src/types.ts`, `packages/db/src/repos/transactions.ts` (`toTransaction` mapper), `apps/web/src/server/queries/weeks.ts` (no change expected — it already reads `postedAt`), fixtures in `packages/core/test/fixtures.ts`
- Test: `packages/core/test/types.test.ts` (new, type-level via `expectTypeOf`), `packages/db/test/repos/transactions.test.ts`, `apps/web/test/weeks.test.ts`

**Interfaces:** Produces on `ExpenseTransaction`:
```ts
postedAt: string | null; pending: boolean; source: 'manual' | 'csv' | 'plaid';
provider: string | null; externalId: string | null; bankAccountId: string | null;
removedAt: string | null; userEditedAt: string | null;
```
Defaults for manual rows: `source: 'manual'`, `pending: false`, the rest `null`.

- [ ] **Step 1: Failing db test** (`packages/db/test/repos/transactions.test.ts`)

```ts
it('surfaces the bank columns it stores', async () => {
  const [row] = await transactionsRepo.upsertFromBank(db, ownerA, [bankRow({ externalId: 'tx-1', postedAt: '2026-08-18T15:00:00.000Z', pending: true })]);
  const read = await transactionsRepo.getTransaction(db, ownerA, row.id);
  expect(read).toMatchObject({ source: 'plaid', provider: 'plaid', externalId: 'tx-1', pending: true, postedAt: '2026-08-18T15:00:00.000Z', bankAccountId: account.id, removedAt: null, userEditedAt: null });
});
it('defaults a manual row to source manual, not pending', async () => {
  const created = await transactionsRepo.createTransaction(db, ownerA, manualInput());
  expect(created).toMatchObject({ source: 'manual', pending: false, postedAt: null, externalId: null });
});
```

- [ ] **Step 2: Run → FAIL** (fields undefined / type error).
- [ ] **Step 3: Implement** — extend the `Persisted`-side type in `types.ts` (not the zod *input* — forms never send these), map the eight columns in `toTransaction`, add them to any `select` projections that enumerate columns, update `weeks.test.ts` fixture helper to include defaults, and add the core `expectTypeOf` test asserting the field set.
- [ ] **Step 4: Run → PASS** across core, db, web (`pnpm turbo test`); core coverage stays 100%.
- [ ] **Step 5: Commit** — `feat(core,db): the transaction type carries its bank columns`.

---

### Task 4: `PlaidProvider` with fixtures

**Files:**
- Create: `packages/bank-connectors/src/plaid/provider.ts`, `src/plaid/errors.ts`, `src/plaid/normalize.ts`, `src/plaid/index.ts`; export from `src/index.ts`
- Create: `packages/bank-connectors/test/plaid/{provider,normalize,errors}.test.ts`, `test/fixtures/plaid/{link-token,exchange,item,institution,accounts,sync-page-1,sync-page-2,sync-page-3,sync-modified,sync-removed,sync-pending-to-posted,error-rate-limit,error-mutation,error-item-login-required}.json`
- Modify: `packages/bank-connectors/package.json` (`plaid` exact dep)

**Interfaces:**
- Consumes: `BankProvider`, `NormalizedTransaction`, `NormalizedAccount`, `SyncResult` from `src/types.ts`; `parseMoney` from core.
- Produces:
```ts
export interface PlaidClientLike { linkTokenCreate; itemPublicTokenExchange; itemGet; institutionsGetById; accountsGet; transactionsSync; itemRemove }  // the subset of PlaidApi used, typed with the SDK's request/response types
export function createPlaidClient(opts: { clientId: string; secret: string; env: 'sandbox' | 'production' }): PlaidApi
export class PlaidProvider implements BankProvider { constructor(deps: { client: PlaidClientLike; now?: () => Date }) }
export class PlaidRateLimited extends Error { retryAfterSeconds: number }
export class PlaidMutationDuringPagination extends Error {}
export class PlaidItemError extends Error { code: string }   // e.g. 'ITEM_LOGIN_REQUIRED'
export class PlaidRequestError extends Error { code: string; requestId?: string }
export function normalizeTransaction(t: PlaidTransaction): NormalizedTransaction
export function normalizeAccount(a: PlaidAccount): NormalizedAccount
```

- [ ] **Step 1: Install** `pnpm --filter @budget-bot/bank-connectors add plaid@46.0.0 --save-exact` (use the exact latest 46.x). Confirm the SDK's `PlaidEnvironments`, `Configuration`, `PlaidApi`, and the `transactionsSync` request shape in `node_modules/plaid/dist/api.d.ts` before writing fixtures — fixtures must match the SDK's response types so the tests typecheck.

- [ ] **Step 2: Failing normalize tests** (`test/plaid/normalize.test.ts`)

```ts
it('keeps Plaid sign: a purchase is positive, a payment negative', () => {
  expect(normalizeTransaction(tx({ amount: 114.75 })).amountCents).toBe(11475);
  expect(normalizeTransaction(tx({ amount: -500 })).amountCents).toBe(-50000);
});
it('carries the pending link and the bank memo line', () => {
  const n = normalizeTransaction(tx({ pending: false, pending_transaction_id: 'p-1', name: 'HOME DEPOT #1234', merchant_name: 'The Home Depot' }));
  expect(n).toMatchObject({ pendingTransactionId: 'p-1', rawDescriptor: 'HOME DEPOT #1234', merchantName: 'The Home Depot', pending: false });
});
it('maps personal_finance_category to hints', () => {
  expect(normalizeTransaction(tx({ personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_SUPERSTORES', confidence_level: 'VERY_HIGH' } })).categoryHints)
    .toEqual({ primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_SUPERSTORES', confidence: 'VERY_HIGH' });
});
it('converts balances and limit to cents, null when absent', () => {
  expect(normalizeAccount(acct({ balances: { current: 1234.56, available: 765.44, limit: 5000 } }))).toMatchObject({ currentBalanceCents: 123456, availableBalanceCents: 76544, limitCents: 500000 });
  expect(normalizeAccount(acct({ balances: { current: null, available: null, limit: null } })).limitCents).toBeNull();
});
```

- [ ] **Step 3: Run → FAIL** (module missing).
- [ ] **Step 4: Implement `normalize.ts`** with `parseMoney(String(amount))` (Plaid amounts are numbers with ≤2 decimals; go through the string path so `1.005`-class rounding never appears).
- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Failing provider tests** (`test/plaid/provider.test.ts`) using a `fakeClient()` that returns fixtures:

```ts
it('requests transactions with 730 days and the redirect uri', async () => {
  const client = fakeClient();
  const p = new PlaidProvider({ client });
  await p.createLinkToken({ userId: 'u1', redirectUri: 'https://x/plaid/oauth-return' });
  expect(client.linkTokenCreate).toHaveBeenCalledWith(expect.objectContaining({
    user: { client_user_id: 'u1' }, products: ['transactions'], transactions: { days_requested: 730 }, redirect_uri: 'https://x/plaid/oauth-return',
  }));
});
it('returns the token and item once on exchange, with the institution name', async () => {
  const r = await p.exchangePublicToken('public-sandbox-1');
  expect(r).toEqual({ accessToken: 'access-sandbox-abc', itemId: 'item-1', institutionId: 'ins_127287', institutionName: 'Platypus OAuth Bank' });
});
it('returns one sync page and its cursor', async () => {
  const page = await p.syncTransactions('access-sandbox-abc', null);
  expect(page.added).toHaveLength(3); expect(page.nextCursor).toBe('cursor-1'); expect(page.hasMore).toBe(true);
  expect(client.transactionsSync).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'access-sandbox-abc', cursor: undefined, count: 500 }));
});
it('maps a 429 to PlaidRateLimited with the retry hint', async () => { await expect(p.syncTransactions('t', 'c')).rejects.toBeInstanceOf(PlaidRateLimited); });
it('maps TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', async () => { await expect(...).rejects.toBeInstanceOf(PlaidMutationDuringPagination); });
it('maps ITEM_LOGIN_REQUIRED to PlaidItemError', async () => { const e = await p.syncTransactions('t','c').catch(x=>x); expect(e).toBeInstanceOf(PlaidItemError); expect(e.code).toBe('ITEM_LOGIN_REQUIRED'); });
it('never puts the access token in an error message', async () => {
  const e = await p.syncTransactions('access-sandbox-SECRET', 'c').catch(x => x);
  expect(String(e.message)).not.toContain('SECRET'); expect(JSON.stringify(e)).not.toContain('SECRET');
});
it('verifyAndParseWebhook is not supported yet', async () => { await expect(p.verifyAndParseWebhook('{}', new Headers())).rejects.toBeInstanceOf(NotSupportedError); });
```

- [ ] **Step 7: Run → FAIL.**
- [ ] **Step 8: Implement `provider.ts` + `errors.ts`**: wrap every SDK call in `try/catch`; Plaid errors arrive as axios errors with `response.data.error_code`; map `RATE_LIMIT_EXCEEDED`/HTTP 429 → `PlaidRateLimited`, `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` → `PlaidMutationDuringPagination`, `error_type === 'ITEM_ERROR'` → `PlaidItemError(code)`, else `PlaidRequestError(code, request_id)`. Build messages from `error_code` + `error_message` only. `syncTransactions` passes `cursor: cursor ?? undefined` and `count: 500`.
- [ ] **Step 9: Run → PASS; lint** (`pnpm --filter @budget-bot/bank-connectors lint typecheck test`).
- [ ] **Step 10: Commit** — `feat(bank-connectors): PlaidProvider over the official SDK, tested against fixtures`.

---

### Task 5: Token storage, sync lock, and the merge-rule writes (`@budget-bot/db`)

**Files:**
- Modify: `packages/db/src/repos/bank.ts`, `packages/db/src/repos/transactions.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/repos/sync-lock.ts`
- Test: `packages/db/test/repos/bank.test.ts`, `packages/db/test/repos/bank-sync-writes.test.ts`, `packages/db/test/repos/sync-lock.test.ts`
- Modify (stamping): `apps/web/src/server/actions/transactions.ts` (`assignTransactionAction`, `updateTransactionCategoryAction` set `userEditedAt`), `apps/web/test/actions.test.ts`

**Interfaces:** Consumes `encryptToken/decryptToken/loadKeysFromEnv` (`@budget-bot/db/crypto`, keyring shape `{ current: { keyId, key }, keys }`). Produces:
```ts
bankRepo.createConnection(db, ownerId, { provider: 'plaid', itemId, accessToken, institutionId, institutionName }, keyring): Promise<BankConnection>   // no token field
bankRepo.withAccessToken<T>(db, ownerId, connectionId, keyring, fn: (token: string) => Promise<T>): Promise<T>
bankRepo.upsertAccounts(db, ownerId, connectionId, accounts: NormalizedAccount[]): Promise<BankAccount[]>
bankRepo.getConnection(db, ownerId, id): Promise<BankConnection | null>
bankRepo.listConnections(db, ownerId): Promise<Array<BankConnection & { accounts: BankAccount[] }>>
bankRepo.setCursor(db, ownerId, id, cursor: string): Promise<void>
bankRepo.recordSyncResult(db, ownerId, id, { added, modified, removed, pages, hasMore }): Promise<void>
bankRepo.recordSyncError(db, ownerId, id, { code, status: 'error' | 'reauth_required' }): Promise<void>
withSyncLock<T>(db, connectionId, fn: (tx) => Promise<T>): Promise<{ skipped: true } | { skipped: false; result: T }>
transactionsRepo.upsertFromBank(db, ownerId, rows)            // + setWhere owner
transactionsRepo.applyModified(db, ownerId, rows: BankTransactionRow[]): Promise<number>
transactionsRepo.reconcilePending(db, ownerId, bankAccountId, posted: BankTransactionRow[]): Promise<number>
transactionsRepo.applyRemoved(db, ownerId, bankAccountId, externalIds: string[]): Promise<{ softDeleted: number; deleted: number }>
```

- [ ] **Step 1: Failing bank repo tests** (`bank.test.ts`, real Postgres, `describeDb`)

```ts
it('stores the token encrypted and never returns it', async () => {
  const c = await bankRepo.createConnection(db, ownerA, { provider: 'plaid', itemId: 'item-1', accessToken: 'access-sandbox-abc', institutionId: 'ins_1', institutionName: 'Bank' }, keyring);
  expect(JSON.stringify(c)).not.toContain('access-sandbox');
  const raw = await db.select().from(bankConnections).where(eq(bankConnections.id, c.id));
  expect(raw[0].accessTokenCiphertext).toMatch(/^v1:[0-9a-f]{8}:/);
  expect(raw[0].accessTokenCiphertext).not.toContain('access-sandbox');
  const listed = await bankRepo.listConnections(db, ownerA);
  expect(JSON.stringify(listed)).not.toContain('access-sandbox');
});
it('hands the plaintext only to the callback, bound to the row', async () => {
  await expect(bankRepo.withAccessToken(db, ownerA, c.id, keyring, async (t) => t)).resolves.toBe('access-sandbox-abc');
  await expect(bankRepo.withAccessToken(db, ownerB, c.id, keyring, async (t) => t)).rejects.toThrow(/not found/);  // owner isolation
});
it('upserts accounts by (connection, external id)', async () => { /* insert 2, upsert 1 changed balance → still 2 rows, balance updated */ });
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `bank.ts`** — `createConnection` in one `db.transaction`: insert row with `accessTokenCiphertext: ''` to get the id, then `encryptToken(accessToken, { keyId: keyring.current.keyId, key: keyring.current.key, aad: id })` and update; `withAccessToken` selects by `(id, owner_id)`, decrypts with `aad: id`, calls `fn`. `listConnections` selects an explicit column list that omits the ciphertext.
- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Failing sync-write tests** (`bank-sync-writes.test.ts`)

```ts
it('applyModified changes amount and memo but not the user's filing', async () => {
  await transactionsRepo.upsertFromBank(db, ownerA, [row('tx-1', { amountCents: 1000 })]);
  await transactionsRepo.updateTransaction(db, ownerA, id, { projectId: projA, category: 'tools', notes: 'drill', userEditedAt: NOW });
  await transactionsRepo.applyModified(db, ownerA, [row('tx-1', { amountCents: 1250, rawDescriptor: 'HOME DEPOT 1234 POSTED' })]);
  const t = await transactionsRepo.getTransaction(db, ownerA, id);
  expect(t).toMatchObject({ amountCents: 1250, rawDescriptor: 'HOME DEPOT 1234 POSTED', projectId: projA, category: 'tools', notes: 'drill' });
});
it('applyModified may recategorise a row the user never touched', async () => { /* userEditedAt null → category follows categorizer of new descriptor? NO: category is set on insert only; applyModified must NOT change category at all. Assert category unchanged in both cases. */ });
it('reconcilePending moves the filing from the pending row to the posted one and drops the pending row', async () => {
  await transactionsRepo.upsertFromBank(db, ownerA, [row('pend-1', { pending: true, amountCents: 1000 })]);
  await transactionsRepo.updateTransaction(db, ownerA, pendId, { projectId: projA, notes: 'receipt 77', userEditedAt: NOW });
  const moved = await transactionsRepo.reconcilePending(db, ownerA, account.id, [row('post-1', { pending: false, pendingTransactionId: 'pend-1', amountCents: 1000 })]);
  expect(moved).toBe(1);
  expect(await transactionsRepo.getByExternalId(db, ownerA, account.id, 'pend-1')).toBeNull();
  expect(await transactionsRepo.getByExternalId(db, ownerA, account.id, 'post-1')).toMatchObject({ projectId: projA, notes: 'receipt 77', status: 'matched' });
});
it('applyRemoved soft-deletes a filed row and deletes an unfiled one', async () => { /* two rows, one with projectId → removedAt set; other gone */ });
it('upsertFromBank cannot write across owners even with a colliding key', async () => { /* ownerB upsert with ownerA's account id → FK/owner failure, not an update of A's row */ });
```

- [ ] **Step 6: Run → FAIL.**
- [ ] **Step 7: Implement** the three functions in `transactions.ts` with explicit column lists (copy the provider-owned list from Global Constraints into a `PROVIDER_OWNED` constant and use it for both `upsertFromBank`'s `set` and `applyModified`); `reconcilePending` in one transaction per call; add `getByExternalId`. Add `userEditedAt` to `TransactionUpdate` and stamp it in the two actions (tests in `actions.test.ts`: the repo is called with `userEditedAt` set).
- [ ] **Step 8: Failing lock test** (`sync-lock.test.ts`): two concurrent `withSyncLock(db, 'conn-1', …)` on separate connections — second returns `{ skipped: true }` while the first holds; sequential both run. Implement with `select pg_try_advisory_xact_lock(hashtext(${id}))` inside `db.transaction`.
- [ ] **Step 9: Run → PASS** (`pnpm --filter @budget-bot/db test` against Docker) and `pnpm --filter web test`.
- [ ] **Step 10 (optional, only if ≤ 1 repo function + 1 test): CSV synthetic account** — `bankRepo.ensureCsvAccount(db, ownerId)` returning the per-owner `bank_accounts` row (`provider: 'csv'`, `externalId: 'csv:<ownerId>'`); `/api/import/csv` uses it so CSV rows carry `bank_account_id` and dedupe across uploads. Test: import the same file twice → second reports all skipped. If it grows, leave it out and note it.
- [ ] **Step 11: Commit** — `feat(db): encrypted connections, advisory sync lock, and the three merge-rule writes`.

---

### Task 6: Sync service + `FakeBankProvider`

**Files:**
- Create: `apps/web/src/server/bank/sync.ts`, `apps/web/src/server/bank/fake-provider.ts`, `apps/web/src/server/bank/provider.ts`
- Test: `apps/web/test/sync.test.ts` (real Postgres via `DATABASE_URL_TEST`, same `describeDb` helper pattern as `packages/db/test/helpers/db.ts` — copy the helper into `apps/web/test/helpers/db.ts` if not importable), `apps/web/test/fake-provider.test.ts`
- Modify: `apps/web/src/env.ts` (+ `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` enum `['sandbox','production']` default `'sandbox'`; assertion rules from Global Constraints), `apps/web/test/env.test.ts`, `.env.example`, `ci/env.production.fixture` (+ `PLAID_CLIENT_ID=notarealplaidclientid0000`, `PLAID_SECRET=notarealplaidsecret00000000000`, `PLAID_ENV=production`), `apps/web/test/ci-fixture.test.ts`, `.gitleaks.toml` (only if gitleaks flags the dummies — prefer dummies it does not flag)

**Interfaces:** Consumes Task 4's provider + errors, Task 5's repos. Produces:
```ts
export type SyncOutcome = { added: number; modified: number; removed: number; pages: number; hasMore: boolean } | { skipped: true };
export function runSync(db, ownerId, connectionId, deps: { provider: BankProvider; keyring: TokenKeyring; now: () => Date; maxPages?: number; maxRestarts?: number }): Promise<SyncOutcome>
export class FakeBankProvider implements BankProvider { constructor(script: { accounts: NormalizedAccount[]; pages: SyncResult[]; failAtPage?: { index: number; error: Error } }) }
export function getBankProvider(): BankProvider | null   // Fake when E2E==='1' (and NODE_ENV!=='production'), Plaid when env configured, else null
```

- [ ] **Step 1: Failing `runSync` tests**

```ts
it('applies three pages, committing the cursor with each', async () => {
  const provider = new FakeBankProvider({ accounts, pages: [page1, page2, page3] });
  const out = await runSync(db, ownerA, conn.id, { provider, keyring, now });
  expect(out).toMatchObject({ added: 7, modified: 0, removed: 0, pages: 3, hasMore: false });
  expect((await bankRepo.getConnection(db, ownerA, conn.id))?.cursor).toBe('cursor-3');
});
it('leaves the previous cursor when a page fails', async () => {
  const provider = new FakeBankProvider({ accounts, pages: [page1, page2], failAtPage: { index: 1, error: new PlaidRequestError('INTERNAL_SERVER_ERROR') } });
  await expect(runSync(...)).rejects.toThrow();
  expect(cursorOf(conn)).toBe('cursor-1');
  expect(await countTransactions(ownerA)).toBe(page1.added.length);
});
it('restarts from the committed cursor on mutation-during-pagination, once', ...);
it('stops cleanly on rate limit and records the error', ...);
it('records reauth_required on ITEM_LOGIN_REQUIRED', ...);
it('categorises on insert and files negatives as ignored', async () => { /* page with HOME DEPOT purchase → category materials; -500 payment → status ignored */ });
it('returns skipped when another sync holds the lock', ...);
it('stops after maxPages and reports hasMore', ...);
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `sync.ts`** per spec §5 (loop inside `withSyncLock`; each page: `withAccessToken` → `provider.syncTransactions`; then one `tx` for `upsertFromBank` (categorise via `categorizeVendor(merchantName ?? rawDescriptor)`, `status: amountCents < 0 ? 'ignored' : 'unassigned'`), `applyModified`, `reconcilePending`, `applyRemoved`, `setCursor`). Catch `PlaidMutationDuringPagination` → re-read cursor, continue (bounded by `maxRestarts = 2`); `PlaidRateLimited` → `recordSyncError({ code: 'RATE_LIMIT_EXCEEDED', status: 'error' })` and return what was committed; `PlaidItemError` with `ITEM_LOGIN_REQUIRED` → `recordSyncError({ code, status: 'reauth_required' })` and rethrow.
- [ ] **Step 4: Implement `fake-provider.ts`** (scripted; `createLinkToken` returns `'link-fake'`; `exchangePublicToken('public-fake')` returns `{ accessToken: 'access-fake', itemId: 'item-fake', institutionName: 'Fake Bank (E2E)' }`) and `provider.ts` (`getBankProvider`: E2E door check reuses `isE2eSignInEnabled()` from `lib/e2eProvider.ts`; Plaid when `env.PLAID_CLIENT_ID && env.PLAID_SECRET`; else `null`).
- [ ] **Step 5: env + assertion** — failing `env.test.ts` cases: `PLAID_ENV: 'sandbox'` in production → refused with a message naming it; `PLAID_ENV: 'production'` without `PLAID_SECRET` → refused; complete → accepted. Update `.env.example` (mechanical test), the fixture (pinned by `ci-fixture.test.ts` — extend `EXPECTED_DUMMIES`/the full-file assertion), and `ci.yml` if the must-pass fixture now needs `PLAID_ENV=production` (it does, since sandbox is refused).
- [ ] **Step 6: Run → PASS** (`pnpm turbo test`), `pnpm check:security --from ci/env.production.fixture` passes.
- [ ] **Step 7: Commit** — `feat(web): runSync — cursor per page, merge rule, pending→posted; FakeBankProvider behind the E2E door`.

---

### Task 7: Actions, Connections page, OAuth return

**Files:**
- Create: `apps/web/src/server/actions/bank.ts`, `apps/web/src/server/queries/connections.ts`, `apps/web/app/settings/connections/{page.tsx,ConnectionsView.tsx,ConnectionsView.test.tsx,ConnectBankButton.tsx,ConnectBankButton.test.tsx}`, `apps/web/app/plaid/oauth-return/{page.tsx,OAuthReturn.tsx,OAuthReturn.test.tsx}`
- Modify: `apps/web/components/Navigation.tsx` (+ link to Connections; remove hardcoded "Spark"; `Navigation.test.tsx`), `apps/web/src/server/queries/dashboard.ts` (card profile from `bankRepo`), `apps/web/package.json` (`react-plaid-link@5.0.0` exact)
- Test: `apps/web/test/actions.test.ts` (structural — new module auto-included; add happy-path cases), `apps/web/test/middleware-allowlist.test.ts` (new routes must be gated — no change to allowlist)

**Interfaces:** Consumes Task 5/6. Produces:
```ts
createLinkTokenAction(): Promise<Result<{ linkToken: string }>>
exchangePublicTokenAction(input: { publicToken: string }): Promise<Result<{ connectionId: string; accounts: number; firstSync: SyncOutcome }>>
syncNowAction(input: { connectionId: string }): Promise<Result<SyncOutcome>>
getConnectionsPage(ownerId): Promise<{ configured: boolean; connections: Array<BankConnection & { accounts: BankAccount[] }> }>
```

- [ ] **Step 1: Failing action tests** (append to the existing table-driven file so the structural walk includes `bank.ts`):

```ts
it('createLinkTokenAction builds the redirect uri from the request origin, never from input', async () => {
  mockSession('user-1'); headersMock({ origin: 'https://app.example' });
  await createLinkTokenAction();
  expect(provider.createLinkToken).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', redirectUri: 'https://app.example/plaid/oauth-return' }));
});
it('exchangePublicTokenAction stores, loads accounts, and runs a bounded first sync', async () => {
  const r = await exchangePublicTokenAction({ publicToken: 'public-fake' });
  expect(r.ok).toBe(true);
  expect(bankRepo.createConnection).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.objectContaining({ itemId: 'item-fake', accessToken: 'access-fake' }), expect.anything());
  expect(runSync).toHaveBeenCalledWith(expect.anything(), 'user-1', 'conn-1', expect.objectContaining({ maxPages: 5 }));
});
it('syncNowAction refuses a connection the owner does not have', ...);
it('returns { ok: false, error: "Plaid is not configured" } when the provider is null', ...);
```

- [ ] **Step 2: Run → FAIL**; **Step 3: implement** actions (owner from `currentOwnerId()`; origin from `headers()` `origin` or `x-forwarded-host`+proto, falling back to `env.AUTH_URL`); query; pages. `page.tsx` for connections is an RSC that calls `requireOwnerId()` then `getConnectionsPage`. `ConnectBankButton` (`'use client'`): on click → `createLinkTokenAction` → `sessionStorage.setItem('plaid_link_token', token)` → `usePlaidLink({ token, onSuccess: (publicToken) => exchangePublicTokenAction({ publicToken }) })` → `open()`; shows the not-configured state when `configured === false`. `OAuthReturn` (`'use client'`): reads `sessionStorage.getItem('plaid_link_token')`; if absent → message + link back; else `usePlaidLink({ token, receivedRedirectUri: window.location.href, onSuccess })` then `router.replace('/settings/connections')`.
- [ ] **Step 4: Component tests** — `ConnectionsView.test.tsx` (renders institutions/accounts/balances via `formatCents`, "Sync now" calls the mocked action with the connection id, `{ok:false}` → alert, not-configured state), `ConnectBankButton.test.tsx` (mock `react-plaid-link`'s `usePlaidLink`; click → `createLinkTokenAction` called → `open` invoked; success → `exchangePublicTokenAction` called with the public token), `OAuthReturn.test.tsx` (no stored token → message; stored → `usePlaidLink` receives `receivedRedirectUri`). `Navigation.test.tsx`: card label comes from the account's `cardName`/`officialName`, no literal "Spark".
- [ ] **Step 5: Run → PASS** incl. `component-tests.test.ts`, `actions.test.ts` (derived count now 13), `middleware-allowlist.test.ts` (both new routes matched by the matcher, not public).
- [ ] **Step 6: Commit** — `feat(web): connect a bank through Plaid Link, see its accounts, sync on demand`.

---

### Task 8: E2E journey, live Sandbox smoke, docs

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`, `apps/web/playwright.config.ts` (no change expected), `.github/workflows/ci.yml` (E2E job already sets `E2E=1`)
- Create: `apps/web/scripts/plaid-smoke.ts`; `apps/web/package.json` script `plaid:smoke`
- Modify: `docs/self-hosting/vercel.md` (§ env table + a "Connecting a bank" section incl. redirect URI registration in the Plaid dashboard and the Production application note), `docs/self-hosting/local.md` (Sandbox keys, `plaid:smoke`), `README.md` (one paragraph), `CHANGELOG.md` (`v0.2.0-plaid-sandbox` Unreleased entry)

- [ ] **Step 1: Extend the Playwright journey** (serial describe, after the existing steps):

```ts
test('connects a bank through the fake provider and syncs it', async ({ page }) => {
  await page.goto('/settings/connections');
  await page.getByRole('button', { name: 'Connect a bank' }).click();   // FakeBankProvider: the button completes without Link UI when E2E=1
  await expect(page.getByText('Fake Bank (E2E)')).toBeVisible();
  await expect(page.getByText(/Checking •••• 0000/)).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Synced .* added/)).toBeVisible();
  await page.goto('/transactions');
  await expect(page.getByText('FAKE HARDWARE 4471')).toBeVisible();
});
```
Design note: when the provider is the Fake, `ConnectBankButton` must skip `react-plaid-link` and call `exchangePublicTokenAction({ publicToken: 'public-fake' })` directly — gate that branch on a `fake: boolean` prop that `getConnectionsPage` sets only when `getBankProvider()` is the Fake (which only exists behind the E2E door).

- [ ] **Step 2: Run** `E2E=1 pnpm --filter web e2e` → PASS (7 tests).
- [ ] **Step 3: `plaid-smoke.ts`** — exits 0 with "Plaid keys not set; skipping" when `PLAID_CLIENT_ID`/`PLAID_SECRET` are absent; otherwise: `createPlaidClient({ env: 'sandbox' })` → `sandboxPublicTokenCreate({ institution_id: 'ins_127287', initial_products: ['transactions'] })` → `exchangePublicToken` → `getAccounts` → loop `syncTransactions` until `!hasMore` → print `{ accounts, added, pages }` and nothing else; wrap in the redacting logger. Script documented as local-only; never referenced by CI.
- [ ] **Step 4: Docs** — env table rows for the three Plaid vars with scoping (Production-only for Production keys; previews use Sandbox keys); "Register `https://<host>/plaid/oauth-return` under Allowed redirect URIs in the Plaid dashboard"; note that Production needs Plaid's application approval (each self-hoster applies). CHANGELOG entry.
- [ ] **Step 5: Full gates** — `pnpm turbo lint typecheck test build --force`, e2e, `gitleaks detect`, `pnpm check:security --from ci/env.production.fixture`.
- [ ] **Step 6: Commit** — `feat(e2e,docs): the journey connects and syncs a bank; a local Sandbox smoke for real keys`.

---

## Self-review (done at authoring)

- **Spec coverage:** §2.1 → T1; §2.2 → T2; §2.3 → T3; §3 → T4; §4 → T5 (+ optional CSV account); §5 → T6; §6 → T7; §7 → T6 (env) + T8 (docs); §8 → tests in T4–T8; §9 → T5 (`withAccessToken`), T6 (`getBankProvider` door), T7 (origin-derived redirect, `sessionStorage` check); §10 → T8 journey.
- **Type consistency:** `TokenKeyring { current: { keyId, key }, keys }` is the Phase 1 shape; `BankTransactionRow` is the Phase 1 upsert input and is reused by `applyModified`/`reconcilePending`; `SyncOutcome` defined in T6 and consumed in T7's action results.
- **Placeholders:** the two `/* … */` test bodies in T5 are described in their comments with exact assertions; implementers write them out.
