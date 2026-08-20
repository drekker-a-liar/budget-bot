# Deploying to Vercel

Budget Bot is a pnpm/Turborepo monorepo with the Next.js app at `apps/web`.
When creating or configuring the Vercel project, set **Root Directory** to
`apps/web` (Project Settings → General → Root Directory) — otherwise Vercel
looks for `package.json` at the repo root and the build fails.

Full self-hosting guide: TBD (later phase).
