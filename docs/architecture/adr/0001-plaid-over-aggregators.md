# ADR 0001 — Plaid as the bank-data provider

**Status:** Accepted · 2026-08-20

## Context

The product needs read-only credit-card transaction data from a California Credit Union Visa, arriving in each self-hoster's own deployment. Candidates: Plaid, SimpleFIN Bridge (consumer-facing, used by Actual Budget), Teller/MX, and statement CSV/OFX export only.

## Decision

Use **Plaid**. Each self-hoster creates their own Plaid account and supplies their own `PLAID_CLIENT_ID` / `PLAID_SECRET`; the project has no central Plaid tenant and the maintainers never hold anyone's credentials. CSV import remains as the zero-trust fallback behind the same `BankProvider` interface.

## Consequences

- Broadest institution coverage and the richest transaction data (pending state, merchant enrichment, category hints).
- As of April 2026 Plaid's free Trial plan allows up to 10 real Production Items including OAuth institutions, so personal use costs nothing. The Development environment no longer exists; only `sandbox` and `production` do.
- Each self-hoster must complete Plaid's Production application (use case, privacy policy, security questionnaire). The docs ship pre-written answers and a privacy-policy template.
- Credit unions are frequently OAuth institutions: the app must serve an OAuth return page and every self-hoster must register their own redirect URI.
- The connector is a stateless provider behind an interface so that SimpleFIN or others can be added without touching the sync service.
