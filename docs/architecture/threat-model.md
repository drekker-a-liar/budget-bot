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
| 2026-08-26 | Phase 5: three independent review passes (authorization; secrets and crypto; unauthenticated surface and injection) against this model | Authorization clean: every route, page, and action guarded; every repo call owner-scoped from the session; no injection surfaces. Eight findings fixed in-phase, six ledgered below. |

**Fixed (2026-08-26):** decrypt now pins the GCM tag and IV lengths (a
truncated tag would have lowered forgery cost to 2³²); the webhook route
caps its body at 1 MiB (the one unauthenticated POST could be made to
buffer arbitrarily many bytes); the verifier refuses a signing key Plaid
has marked expired; the boot assertion now also requires `DATABASE_URL`
and holds `CRON_SECRET` to the same 32-character floor as `AUTH_SECRET`;
the GitHub OAuth token is stripped before the `accounts` row is written
and migration 0002 clears what earlier sign-ins stored (nothing ever read
it back — a dump that ADR 0002 keeps from reading a bank must not hand
over GitHub instead); the webhook URL Plaid registers is now built from
the configured `AUTH_URL` first, request host second (the redirect URI
keeps the reverse order because Plaid validates it against a registered
list, which the webhook URL is not); the CSV import failure log carries
the error message rather than the raw driver object.

**Ledgered (accepted or deferred, with reasons):**

- *Key-fetch amplification:* an unsigned request with a random `kid` costs
  one Plaid key-server call, and failures are not negatively cached.
  Bounded by Plaid's own rate limits; a TTL'd negative cache is the fix if
  it is ever observed. Availability-only.
- *Cross-customer JWTs:* Plaid's webhook JWTs carry no audience claim to
  pin, so a JWT+body pair issued to another Plaid customer verifies here.
  Bounded to a no-op (unknown item) plus a ledger row that ages out in 30
  days. Nothing to fix on this side of Plaid's API.
- *Replay-response oracle:* `{duplicate: true}` distinguishes a replay
  from a first delivery, post-signature. Deliberate: the response carries
  no identifier, and only a holder of a validly signed body sees it.
- *`rotate-keys` script:* ADR 0002 promises a bulk re-encryption script
  that does not exist yet; until it does, a retired key stays configured
  as `..._PREVIOUS`. Rotation itself works. Deferred, tracked in the ADR.
- *CSV formula injection:* imported descriptors are stored verbatim; the
  only export today is JSON, so there is no spreadsheet to inject into.
  Neutralize on the day an export becomes CSV.
- *Middleware matcher anchoring:* the Edge matcher's exclusions are
  prefix-anchored more loosely than `isPublicPath`; a future route named
  like a public one would skip the tripwire but still fail the
  authoritative `auth()` check. Defense-in-depth nuance only.
