# ADR 0003 — Auth.js v5 with GitHub OAuth, an email allowlist, and database sessions

**Status:** Accepted · 2026-08-20

## Context

The deployment holds financial data and must be protected on every plan (Vercel Hobby included) and off Vercel entirely. Vercel's Password Protection is Pro-only and does not travel with the code. The app is single-tenant: one owner, possibly a bookkeeper.

## Decision

- **Auth.js v5** (`next-auth@5`, minimum Next.js 14.0) with the **GitHub** provider. Every self-hoster has a GitHub account because they forked the repo.
- Access is governed by **`ALLOWED_EMAILS`**: the `signIn` callback rejects any verified primary email not on the list *before* a user row is created.
- **Database sessions** via `@auth/drizzle-adapter`: instant revocation, a visible session list, and no long-lived JWT that can outlive an allowlist change. Cost is one query per request — trivial at one user.
- **Fail closed.** `middleware.ts` protects everything except an explicit allowlist. Because Edge middleware cannot reach the database, it performs a cookie-presence check only; every server component, server action, and route handler calls `auth()` for the authoritative check.
- **Boot assertion.** In production, `instrumentation.ts` throws if `AUTH_SECRET`, the GitHub OAuth pair, a non-empty `ALLOWED_EMAILS`, or the bank-token encryption key is missing. A misconfigured deployment serves a 500, never data.

## Consequences

- Works on Hobby, works self-hosted anywhere, no paid Vercel features required. Vercel Deployment Protection is optional defence in depth.
- Two-pass setup: the GitHub OAuth callback URL is only known after the first deploy. Documented honestly.
- Additional providers (Google, magic link) can be added later behind the same allowlist.
