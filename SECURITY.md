# Security Policy

## Supported versions

`main`, and only `main`. There are no release branches and no backports; a
self-hosted deployment is expected to track `main` (or a fork pinned to a
commit its owner has read). A fix for a security issue lands as a normal
commit and ships with the next deploy.

## Reporting a vulnerability

Use **GitHub's private vulnerability reporting** on this repository
(Security tab → "Report a vulnerability"). That keeps the report out of the
public issue tracker and off anyone's published email address.

Please include what you did, what you saw, and what you expected the
fail-closed behaviour to have been — a request/response transcript beats a
description of one.

**What to expect, honestly:** this is a one-maintainer project. A report gets
a first human reply within a week, usually much sooner; a confirmed
vulnerability in the authentication gate, the webhook verifier, the token
encryption, or owner-scoping gets fixed before any other work continues.
There is no bug bounty.

Please do not test against someone else's deployment. Every part of this
system runs locally (`docs/self-hosting/local.md`) — test there.

## Posture in brief

The deployment is private and fails closed. The load-bearing decisions are
recorded as ADRs rather than restated here, so they cannot drift from the
code they describe:

- Sign-in is an email allowlist over GitHub OAuth, enforced before a user row
  exists; sessions live in Postgres and die with the allowlist entry
  ([ADR 0003](docs/architecture/adr/0003-db-sessions-authjs.md)).
- A production boot missing its secrets throws instead of serving data
  (`instrumentation.ts`; `pnpm check:security` proves it without deploying).
- Plaid access tokens are AES-256-GCM encrypted with a key that exists only
  in the deployment environment, so the database alone is not enough
  ([ADR 0002](docs/architecture/adr/0002-app-level-token-encryption.md)).
- Webhooks are signature-verified with a replay ledger; the cron endpoint is
  bearer-guarded with a timing-safe compare (Phase 3, `CHANGELOG.md`).
- No card number is ever stored, processed, or transmitted.

The threat model — what is defended, against whom, and what deliberately is
not — lives at
[docs/architecture/threat-model.md](docs/architecture/threat-model.md).
