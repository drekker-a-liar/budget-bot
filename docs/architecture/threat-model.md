# Threat Model

**Date:** 2026-08-26 (Phase 5). Revisit when a new trust boundary appears —
a second sign-in provider, a mobile client, a multi-tenant mode.

## What the system holds

Ranked by how bad a leak would be:

1. **Plaid access tokens** — long-lived credentials that can pull a bank's
   transaction history on demand. The only secret whose theft keeps paying
   the thief after the hole is closed.
2. **The book of business** — transactions, invoices, labor entries, margins:
   one contractor's complete finances.
3. **OAuth identity** — the GitHub-verified email and the session rows.
4. **Configuration secrets** — `AUTH_SECRET`, the GitHub OAuth pair,
   `BANK_TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `DATABASE_URL`.

No card numbers, ever. The Plaid integration reads transactions; it cannot
move money.

## Who it holds it for

One owner per deployment, self-hosted, possibly sharing read access with a
bookkeeper via `ALLOWED_EMAILS`. Everyone on the allowlist is fully trusted:
there are no roles, and the model makes no attempt to protect the owner from
someone the owner allowlisted.

## Trust boundaries

```
Browser ──(HTTPS)── Next.js app ──(TLS)── Postgres
                        │
                        ├──(HTTPS)── Plaid (Link, sync, webhooks in)
                        └──(HTTPS)── GitHub (OAuth)
```

Everything inside the app process is trusted; everything arriving over a
boundary is not, including webhook payloads that claim to be Plaid and
requests bearing a session cookie (the cookie gets a presence check at the
Edge, the real `auth()` check in the handler — middleware is a tripwire, not
the gate).

## Threats considered, and what answers them

| Threat | Mitigation |
| --- | --- |
| Stranger completes the OAuth handshake | Allowlist checked against the *verified* primary email before any user row is created (ADR 0003); nothing is left behind on rejection |
| Removed user keeps a live session | Database sessions: revocation is a row delete, effective next request (ADR 0003) |
| Stolen database dump / leaked `DATABASE_URL` | Tokens are AES-256-GCM app-level encrypted, IV per row, AAD bound to the row id so ciphertext cannot be transplanted; reading one requires the database *and* the environment (ADR 0002) |
| Forged or replayed webhook | ES256 JWT verification (other algorithms rejected before key fetch), five-minute `iat` window + 30s skew, timing-safe body hash, and a replay ledger keyed on the body hash; the only non-200 is an id-free 401 (Phase 3) |
| Cron endpoint driven by an outsider | Timing-safe `CRON_SECRET` bearer check on `/api/internal/sync` |
| Misconfigured deployment serves data open | Boot assertion throws in production when any required secret is missing; `pnpm check:security` verifies both directions in CI against a fixture env |
| Cross-owner data access | Every repo function takes `(db, ownerId, …)`; owner isolation is pinned by tests, including the destructive paths (reset, delete-all) |
| SQL injection | Drizzle parameterized queries throughout; the one identifier interpolation (test-database name) is quoted as an identifier and never reachable in production |
| Secrets in the export | "Export my data" is walked by a test proving no token, ciphertext, cursor, or internal handle rides along (Phase 3) |
| Secret committed to the repo | gitleaks in CI and as a pre-commit hook, with the repo's own `.gitleaks.toml` |
| Hostile fork of the deploy button | Each self-hoster owns their own OAuth app, database, and keys; there is no shared secret to inherit and no phone-home |

## Explicitly not defended

- **A compromised deployment platform account** (Vercel, or wherever it
  runs). Whoever controls the environment controls the encryption key and
  the app.
- **A compromised GitHub account of an allowlisted user.** OAuth trust is
  transitive; use 2FA.
- **A malicious owner.** It is their data.
- **Plaid itself**, or a compromise on Plaid's side.
- **Availability.** This is one person's dashboard; a downed deployment is an
  inconvenience, not an incident. There is no rate limiting beyond what the
  platform provides.

## Audit log

| Date | Scope | Outcome |
| --- | --- | --- |
| 2026-08-26 | Phase 5 review of routes, repos, secret handling, webhook verification, and injection surfaces against this model | _recorded when the audit task completes_ |
