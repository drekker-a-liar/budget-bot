import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `vercel.json` is the one file Vercel reads before any of this repository's
 * code runs, and its build command is a line of shell nobody exercises locally.
 *
 * The rule it has to keep: migrations run for a Production deployment and for
 * nothing else. A preview has no `DATABASE_URL` (the deploy guide scopes every
 * secret to Production), so an unconditional migrate step exits 1 and fails
 * every pull request's build - and a preview that *did* inherit the production
 * URL would migrate the live database ahead of the code that needs it. The
 * command is checked by running it, with `pnpm` replaced by a shim that records
 * what it was asked to do, because a regex over the string would pass a command
 * whose `if` has the wrong shape.
 */

const VERCEL_JSON = fileURLToPath(new URL('../vercel.json', import.meta.url));

interface VercelConfig {
  buildCommand: string;
  installCommand: string;
  crons: Array<{ path: string; schedule: string }>;
}

const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;

/** Runs the build command with `pnpm` shimmed; returns the pnpm invocations, one per line. */
function runBuildCommand(env: Record<string, string | undefined>): string[] {
  const bin = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vercel-build-'));
  const log = join(bin, 'invocations.log');
  const shim = join(bin, 'pnpm');
  writeFileSync(shim, `#!/bin/sh\necho "$*" >> "${log}"\n`);
  chmodSync(shim, 0o755);
  writeFileSync(log, '');

  execFileSync('/bin/sh', ['-c', config.buildCommand], {
    // Deliberately not `process.env`: the command must read only what Vercel
    // would hand it (a build always runs with `NODE_ENV=production`), and the
    // shimmed `pnpm` has to be the first one found.
    env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: 'production', ...env },
    stdio: 'pipe',
  });

  return readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

describe('vercel.json build command', () => {
  it('migrates and then builds for a Production deployment', () => {
    expect(runBuildCommand({ VERCEL_ENV: 'production' })).toEqual([
      '--filter @budget-bot/db db:migrate',
      '--filter web build',
    ]);
  });

  it('builds without migrating for a Preview deployment', () => {
    expect(runBuildCommand({ VERCEL_ENV: 'preview' })).toEqual(['--filter web build']);
  });

  it('builds without migrating when VERCEL_ENV is not set at all', () => {
    // `vercel build` on a laptop, or any CI that is not Vercel: a migrate here
    // would run against whatever `.env` happened to be checked out.
    expect(runBuildCommand({})).toEqual(['--filter web build']);
  });

  it('installs from the lockfile and nothing else', () => {
    expect(config.installCommand).toBe('pnpm install --frozen-lockfile');
  });
});

describe('vercel.json crons', () => {
  it('points the daily sync at a route that exists', () => {
    expect(config.crons).toEqual([{ path: '/api/internal/sync', schedule: expect.any(String) }]);
    const route = new URL('../app/api/internal/sync/route.ts', import.meta.url);
    expect(() => readFileSync(route)).not.toThrow();
  });
});
