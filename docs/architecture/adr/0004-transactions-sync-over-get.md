# ADR 0004 — Plaid `/transactions/sync` instead of `/transactions/get`

**Status:** Accepted · 2026-08-20

## Context

Plaid offers two ways to read transactions: the date-window `/transactions/get` and the cursor-based `/transactions/sync`, which returns `added`, `modified`, and `removed` sets plus a `next_cursor`.

## Decision

Use **`/transactions/sync` exclusively**, triggered by the `TRANSACTIONS.SYNC_UPDATES_AVAILABLE` webhook with a cron safety net and a manual "Sync now" action.

Rules the sync service enforces:

- Take a Postgres advisory lock per connection so webhook and cron never interleave.
- Apply each page in a transaction; persist `next_cursor` only after the page commits. On failure, retry with the same cursor.
- Upsert on the partial unique index `(provider, bank_account_id, external_id)`.
- **Merge rule:** provider-owned columns (amount, dates, pending, raw descriptor, merchant, category hints) are always overwritten; user-owned columns (`projectId`, `status`, `notes`, `receiptNumber`, and `category` / `taxDeductible` / `vendor` once `user_edited_at` is set) are never overwritten.
- **Pending → posted:** a posted transaction carrying `pendingTransactionId` inherits the pending row's user-owned columns; the pending row is then removed. A `removed` event for a categorized row soft-deletes it so a categorized expense is never silently lost.
- Sign convention: **positive = money out**. Negative rows (payments, refunds) are stored with `status: 'ignored'` by default.

## Consequences

- Deduplication, pending reconciliation, and deletions are handled by Plaid's protocol rather than by date-window heuristics.
- Initial history backfill (up to 730 days requested) arrives asynchronously; the UI must not block Link completion on it.
