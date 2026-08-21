# Deploying to Vercel

Budget Bot is a pnpm/Turborepo monorepo with the Next.js app at `apps/web`.
When creating or configuring the Vercel project, set **Root Directory** to
`apps/web` (Project Settings → General → Root Directory) — otherwise Vercel
looks for `package.json` at the repo root and the build fails.

## The database

`DATABASE_URL` has to point at a Postgres 16 the deployment can reach - a Neon
or Supabase connection string, or your own. There is no file-backed fallback:
the app reads and writes Postgres and nothing else, so a deployment without
this refuses to start, and so does `pnpm dev` in a local checkout. `pnpm db:up`
starts a throwaway one on loopback for development.

Migrations are applied by `pnpm db:migrate` as part of the build command; the
generated SQL is committed, and `drizzle-kit push` is never used.

## The GitHub OAuth app

Sign-in is a GitHub OAuth app you create and own (ADR 0003). Create it at
<https://github.com/settings/developers> → **New OAuth App**, and set:

- **Authorization callback URL**: `https://<your-host>/api/auth/callback/github`
- **Homepage URL**: `https://<your-host>`

The host is only known after the first deploy, so this is a two-pass setup:
deploy, read the domain Vercel assigned, then fill the callback URL in. Put the
app's client id and secret in `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`, list
who may sign in in `ALLOWED_EMAILS`, and set `AUTH_SECRET` and
`BANK_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32` for each). A production
deployment missing any of these refuses to start; `pnpm check:security` says
which, without deploying to find out.

For local development, create a second OAuth app whose callback URL is
`http://localhost:3000/api/auth/callback/github`. One app cannot hold both.

Full self-hosting guide: TBD (later phase).
