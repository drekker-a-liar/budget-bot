# ADR 0005 — Modular monolith in a monorepo, not microservices

**Status:** Accepted · 2026-08-20

## Context

The maintainers value modularity and reusable services. The product is an open-source app that individuals self-host on a free Vercel plan. True microservices would multiply the number of deployments, secrets, and failure modes every self-hoster has to manage.

## Decision

A **modular monolith** in a **Turborepo + pnpm** monorepo with exactly one deployable application.

```
apps/web                  the Next.js app
packages/core             pure domain (types, money, schemas, categorizer, metrics) — deps: zod only
packages/db               Drizzle schema, migrations, repositories, seed, token crypto — deps: core
packages/bank-connectors  BankProvider interface + Plaid/CSV providers, stateless — deps: core
packages/ui               presentational React — deps: core
packages/config           shared tsconfig / eslint / vitest — no runtime code
```

Dependency direction `config ← core ← {db, bank-connectors, ui} ← web` is enforced by pnpm `workspace:*` declarations and per-package `no-restricted-imports` rules. Packages ship TypeScript source via `transpilePackages`; there is no package build step.

## Consequences

- One-click self-hosting stays possible; every boundary that would become a service later already exists as a package with a typed interface.
- Background work (bank sync) runs as authenticated cron/webhook routes inside the same app. If long-running sync ever needs its own process, `bank-connectors` lifts out without a rewrite.
- Strict boundaries are enforced by tooling, not convention.
