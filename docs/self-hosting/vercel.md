# Deploying Budget Bot to Vercel

An honest step list. It is a two-pass setup and there is no way around that:
GitHub needs a callback URL that only exists after the first deploy, so the
first deploy is expected to be one you cannot sign in to.

Budget Bot is a pnpm/Turborepo monorepo with the Next.js app at `apps/web`.

## 1. Fork the repository

You are going to hold your own OAuth app, your own database and your own
secrets, and you will want somewhere to pin a version you trust.

## 2. Create the database

Vercel Marketplace → **Neon** (or Supabase, or any Postgres 16 you can reach).
Install it into the project you are about to create, or create the project
first and add the integration to it — either order works, and the integration
sets `DATABASE_URL` for you.

There is no file-backed fallback: a deployment that cannot reach Postgres
refuses to start.

## 3. Import the repository

Vercel → **Add New… → Project** → your fork.

**Set Root Directory to `apps/web`** (Project Settings → General → Root
Directory). Without it Vercel looks for `package.json` at the repository root
and the build fails.

`apps/web/vercel.json` supplies the rest:

- `installCommand`: `pnpm install --frozen-lockfile`
- `buildCommand`: `pnpm --filter @budget-bot/db db:migrate && pnpm --filter web build`

Migrations run as part of the build, from committed SQL.

## 4. Environment variables

Project Settings → Environment Variables. **Scope every secret to Production
only.** A preview deployment is built and run with `NODE_ENV=production`, which
means the boot assertion applies to previews exactly as it does to production —
a preview with no variables of its own will refuse to start, which is the
intended outcome, and much better than a preview holding real secrets.

| Variable | Scope | Value |
| --- | --- | --- |
| `DATABASE_URL` | Production (Preview: a separate branch/database, or nothing) | From the Neon integration |
| `AUTH_SECRET` | Production | `openssl rand -base64 32` |
| `AUTH_GITHUB_ID` | Production | Filled in at step 6 |
| `AUTH_GITHUB_SECRET` | Production | Filled in at step 6 |
| `ALLOWED_EMAILS` | Production | Your verified GitHub address, comma-separated for more |
| `BANK_TOKEN_ENCRYPTION_KEY` | Production | `openssl rand -base64 32` |
| `PLAID_ENV` | — | Leave unset until sub-project 2 |
| `CRON_SECRET` | Production, once `PLAID_ENV=production` | `openssl rand -base64 32` |

**Never set `E2E`.** It adds a password-less sign-in door for the Playwright
suite. A production deployment with it set throws at boot and serves a 500 —
which is the behaviour you want, but it is a bad way to find out.

`.env.example` documents every one of these, including which are required
where.

Before deploying, run the same judgement locally against the same values:

```bash
vercel env pull --environment=production .env.production.local
pnpm check:security --env-file .env.production.local
```

`--env-file` judges that file and *only* that file: variables exported in your
shell, and any other `.env` lying about, are ignored on purpose. Without the
flag it judges the shell's variables instead. Either way it prints which of the
two it read, and the names — never the values — of the variables it found, so
you can see what the verdict is about before you believe it.

The pulled file is called `.env.production.local` rather than `.env` for two
reasons: `.gitignore` covers `.env*.local`, and a file of production secrets
that your next `pnpm dev` picks up is its own accident.

## 5. First deploy

It will build and start. You cannot sign in yet — there is no OAuth app.
`https://<your-host>/api/health` should answer `{"ok":true,"authConfigured":false}`.

Note the domain Vercel assigned you.

## 6. The GitHub OAuth app

<https://github.com/settings/developers> → **New OAuth App**:

- **Homepage URL**: `https://<your-host>`
- **Authorization callback URL**: `https://<your-host>/api/auth/callback/github`

The callback URL must match exactly, and one app cannot hold two of them — a
local development app is a second OAuth app, with
`http://localhost:3000/api/auth/callback/github`.

Put the client id and secret into `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`
(Production only) and **redeploy** — environment variables are read at build
and boot, not live.

## 7. Sign in, then seed

`/api/health` should now say `"authConfigured":true`. Sign in with the account
whose *verified* primary address is on `ALLOWED_EMAILS`; anyone else gets
`AccessDenied` and leaves no row behind.

**Do this by hand, once, and watch it work.** It is the only part of the locked
door that has never run against GitHub. The allow list is checked against the
*verified primary* address, which Auth.js does not hand over by default — this
deployment overrides GitHub's `userinfo` request to go and fetch it, before any
`users` or `accounts` row is created. That override is covered by unit tests
and by nothing else: if it is wrong, either nobody can sign in, or the address
being checked is an unverified one somebody else could have claimed. One real
sign-in settles which. If your account has more than one address on it, the
useful version of this check is that signing in with the *allow-listed* one
works and that an address on your account which is **not** on the list is
refused with `AccessDenied` and leaves no row in `users`.

Signing in once creates your user row. Then, to start from demo data rather
than an empty dashboard:

```bash
DATABASE_URL="<your production connection string>" \
  pnpm --filter @budget-bot/db db:seed --owner-email you@example.com
```

## 8. Check the door is shut

From a browser with no session:

```bash
curl -I https://<your-host>/                   # 302 to /login
curl -I https://<your-host>/projects           # 302 to /login
curl -i  -X POST https://<your-host>/api/import/csv   # 401
curl -s  https://<your-host>/api/health        # 200 {"ok":true,...}
```

And confirm previews are not holding production secrets:

```bash
vercel env ls
```

### Confirm a broken environment is fatal here too

`instrumentation.ts` calls `assertProductionSecurity()` at boot, and a throw
there is meant to stop the deployment serving anything at all. That is proven
locally and in CI; what has never been proven is Vercel's half of it — whether
a throw in `instrumentation.ts` takes the function down or is swallowed into a
warning and a running server. The difference matters: the second one is a
deployment that is not protecting anything while looking healthy.

So break it once, on purpose:

1. Remove `ALLOWED_EMAILS` from the Production environment and redeploy.
2. `curl -I https://<your-host>/` and `curl -s https://<your-host>/api/health`.
   **Every route must return 500**, `/api/health` included — it is public, so
   if anything still answers 200 the throw is not fatal here and the boot
   assertion is not the guarantee this document says it is. Say so in an issue
   rather than working around it.
3. Put `ALLOWED_EMAILS` back and redeploy. Check `/api/health` answers
   `{"ok":true,"authConfigured":true}` again before you walk away.

Do it while the deployment is new and holds nothing you would miss.

## Custom domains

Add the domain in Vercel, then update the OAuth app's callback URL to the new
host and redeploy. Auth.js works the deployment URL out of the request, so
`AUTH_URL` is only needed behind a proxy that rewrites the host.
