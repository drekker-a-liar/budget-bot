import { defineConfig, devices } from '@playwright/test';
import { e2eServerEnv } from './e2e/environment';

/**
 * The end-to-end smoke run: sign in, read the books, file a charge (spec §9).
 *
 * Chromium only, and deliberately so. What is being tested is that the pieces
 * are wired to each other - Auth.js to Postgres, a Server Component to a
 * repository, a Server Action to a revalidation - and none of that differs by
 * browser engine. Rendering is covered by the component tests.
 *
 * `next dev` rather than `next start`: a production build runs with
 * `NODE_ENV=production`, and the boot assertion refuses to start with `E2E`
 * set (spec §7). That is the guard working, so the suite lives with a slower
 * first page rather than weakening it.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // The suite shares one signed-in browser context across its steps, so
  // running the files in parallel would have them reseeding under each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // `next dev` compiles a route the first time it is asked for, which can take
  // longer than the default 30s on a cold machine.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://127.0.0.1:3000/api/health',
    // Never reuse a server somebody else started: the whole point of the
    // environment above is which database this run talks to, and a `pnpm dev`
    // already on this port is pointed at the developer's own. If the port is
    // taken, failing to start is the right answer.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: e2eServerEnv(),
  },
});
