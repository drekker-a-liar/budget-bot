# Release Checklist

What "releasing" means here: `main` moved, the deployment followed, and
somebody proved it. There is no versioned artifact besides the git tag; a
release branch would only be something else to forget. Every step below is
manual on purpose — the list is short enough that automating it would mostly
automate skipping it.

## Before merging the release PR

- [ ] Full suite, twice back to back — the second run catches state the
      first one leaked:

      ```bash
      pnpm turbo lint typecheck test build && pnpm turbo test
      ```

- [ ] End-to-end, twice, against the local stack (`docs/self-hosting/local.md`
      has the setup):

      ```bash
      pnpm --filter web e2e && pnpm --filter web e2e
      ```

- [ ] `pnpm check:security` passes against a production-shaped env
      (CI runs it against `ci/env.production.fixture` both ways; a local run
      is only needed when the env schema changed).
- [ ] `CHANGELOG.md`: the `— unreleased` heading for this phase gets its
      date. New env variables are in `.env.example` **and** documented in
      `docs/self-hosting/vercel.md` §4 (a test pins `.env.example` against
      the env schema, but nothing can pin prose).

## Merging and tagging

- [ ] Merge with the repo's merge-commit convention
      (`Merge PR #N: <phase title>`).
- [ ] Tag it, matching the CHANGELOG heading:

      ```bash
      git tag v0.N.0 && git push origin v0.N.0
      ```

## After the deploy

- [ ] Vercel shows the production deployment **Ready** — not just the check
      green on the PR; open the deployment itself.
- [ ] Signed out, the production URL redirects to sign-in (the door is still
      shut — `docs/self-hosting/vercel.md` §8 is the fuller version).
- [ ] Signed in: dashboard renders with data, `/margin` renders its chart,
      `/settings/connections` shows each linked bank healthy with a
      plausible last-synced time.
- [ ] If the release touched sync, webhooks, or Plaid config: the Plaid
      dashboard's webhook log shows the most recent delivery answered 200.

## Rolling back

Vercel keeps every previous deployment: **promote the last good one** from
the dashboard (Deployments → ⋯ → Promote to Production) and production is
back before the git history moves. Then revert the merge on `main` so the
next push does not re-deploy the problem. Migrations run forward-only at
build time, so promoting an old deployment does **not** undo them — the old
code must tolerate the new schema. Check the release's migrations before
promoting across one: if any is destructive rather than additive, the
rollback is a revert-and-redeploy with a compensating migration, not a
promote.
