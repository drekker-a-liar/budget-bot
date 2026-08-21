import { fileURLToPath } from 'node:url';

// The monorepo keeps one .env at its root (see .env.example) and Next only
// looks inside the app directory. Node's loader leaves variables that are
// already set alone, so `DATABASE_URL=... pnpm dev` still wins over the file,
// and on Vercel there is no file to read.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env checked out; the environment already has what it needs.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build (spec §3).
  transpilePackages: ['@budget-bot/bank-connectors', '@budget-bot/core', '@budget-bot/db'],
  experimental: {
    // postgres.js is a Node library with its own dynamic requires; leaving it
    // external keeps the server bundle honest.
    serverComponentsExternalPackages: ['postgres'],
    // Next 14 only calls `instrumentation.ts` when asked to. Without this the
    // production boot assertion never runs. (Next 15 made it the default.)
    instrumentationHook: true,
  },
};

export default nextConfig;
