import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What `pnpm check:security` is judging, and what it is not.
 *
 * The script used to load the repository's `.env` before reading
 * `process.env`, which made it possible for it to print "safe to deploy to
 * production" about an environment that was missing `ALLOWED_EMAILS` - the dev
 * `.env` sitting on the machine supplied it. A security tool whose only
 * possible error is saying *yes* too often cannot have a hidden input, so it
 * now reads `process.env` and nothing else unless it is handed an explicit
 * `--from`, and it says out loud which of the two it did.
 *
 * These run the real script in a child process, because the defect was never
 * in the assertion - it was in what the script fed it.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/check-security.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const WEB = fileURLToPath(new URL('..', import.meta.url));

/** A complete production environment, in the shape of the CI fixture. */
const COMPLETE: Record<string, string> = {
  AUTH_SECRET: 'notnotnotnotnotnotnotnotnotnotnot',
  AUTH_GITHUB_ID: 'Iv1.0123456789abcdef',
  AUTH_GITHUB_SECRET: 'notarealgithuboauthclientsecret0',
  ALLOWED_EMAILS: 'ci@example.com',
  BANK_TOKEN_ENCRYPTION_KEY: 'bm90LWEtcmVhbC1rZXktLW5vdC1hLXJlYWwta2V5MzI=',
  E2E: '0',
};

/**
 * A directory with a decoy `.env` in it, so that a run whose working directory
 * contains one still has to ignore it.
 */
function scratchWithDecoyEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-security-'));
  writeFileSync(join(dir, '.env'), 'ALLOWED_EMAILS=decoy@example.com\n');
  return dir;
}

function envFile(contents: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-security-file-'));
  const path = join(dir, 'pulled.env');
  writeFileSync(
    path,
    Object.entries(contents)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n') + '\n'
  );
  return path;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * The script, with an environment built from nothing. `PATH` and `HOME` are
 * passed through because node needs them; nothing else the developer happens
 * to have exported comes along, which is the point.
 */
function runCheck(env: Record<string, string>, args: string[] = []): Run {
  const result = spawnSync(TSX, [SCRIPT, ...args], {
    cwd: scratchWithDecoyEnv(),
    encoding: 'utf8',
    // Cast because this app's `ProcessEnv` declares `NODE_ENV` as required,
    // and an environment without it is exactly what is being handed over.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    } as unknown as NodeJS.ProcessEnv,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('reading the environment', () => {
  it('passes a complete production environment, and says what it read', () => {
    const run = runCheck(COMPLETE);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Source: environment only');
    expect(run.stdout).toContain('safe to deploy to production');
  });

  it('refuses one with no allow list, whatever `.env` files exist', () => {
    // The reproduction. This machine's repository root may well hold a `.env`
    // with a real ALLOWED_EMAILS in it - the script has to fail anyway.
    const { ALLOWED_EMAILS: _allowed, ...withoutAllowList } = COMPLETE;

    const run = runCheck(withoutAllowList);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/ALLOWED_EMAILS/);
    expect(run.stdout).not.toContain('safe to deploy to production');
  });

  it('reports which variables it found, and which it did not', () => {
    const { CRON_SECRET: _cron, ...noCron } = COMPLETE;

    const run = runCheck(noCron);

    expect(run.stdout).toMatch(/Set: .*ALLOWED_EMAILS/);
    expect(run.stdout).toMatch(/Not set: .*CRON_SECRET/);
  });

  it('never prints a value, only names', () => {
    const run = runCheck(COMPLETE);

    for (const value of Object.values(COMPLETE)) {
      if (value === '0') continue; // E2E=0 is a name/value pair nobody can leak.
      expect(run.stdout + run.stderr).not.toContain(value);
    }
  });
});

describe('reading an explicit --from', () => {
  it('judges the file, and names it as the source', () => {
    const path = envFile(COMPLETE);

    const run = runCheck({}, ['--from', path]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Source: ${path}`);
    expect(run.stdout).toContain('safe to deploy to production');
  });

  it('judges the file rather than the surrounding shell', () => {
    // The variable the file is missing is exported in the environment. A
    // check that merged the two would pass here, and would be judging an
    // environment no deployment will ever have.
    const { ALLOWED_EMAILS: _allowed, ...withoutAllowList } = COMPLETE;
    const path = envFile(withoutAllowList);

    const run = runCheck({ ALLOWED_EMAILS: 'shell@example.com' }, ['--from', path]);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/ALLOWED_EMAILS/);
  });

  it('reads quoted and commented files the way `vercel env pull` writes them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-security-quoted-'));
    const path = join(dir, '.env');
    writeFileSync(
      path,
      [
        '# Created by Vercel CLI',
        'AUTH_SECRET="notnotnotnotnotnotnotnotnotnotnot"',
        "AUTH_GITHUB_ID='Iv1.0123456789abcdef'",
        'AUTH_GITHUB_SECRET=notarealgithuboauthclientsecret0',
        'ALLOWED_EMAILS=ci@example.com',
        'BANK_TOKEN_ENCRYPTION_KEY=bm90LWEtcmVhbC1rZXktLW5vdC1hLXJlYWwta2V5MzI=',
        '',
        'E2E=0',
      ].join('\n')
    );

    const run = runCheck({}, ['--from', path]);

    expect(run.status).toBe(0);
  });

  it('resolves a relative path against where the command was typed, not against apps/web', () => {
    // `pnpm check:security --from .env` from the repository root is how every
    // document spells it. pnpm runs the script with `apps/web` as its working
    // directory and records the caller's directory in `INIT_CWD`; a path
    // resolved against the script's own cwd fails loudly on exactly the
    // invocation the docs recommend.
    const path = envFile(COMPLETE);

    const run = runCheck({ INIT_CWD: dirname(path) }, ['--from', 'pulled.env']);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Source: ${path}`);
  });

  it('refuses a file it cannot read rather than falling back to the environment', () => {
    // The flag is `--from`, not `--env-file`, precisely so that node's own
    // `--env-file` pre-flight never gets a say: this script owns the error.
    const run = runCheck(COMPLETE, ['--from', join(WEB, 'no-such-file.env')]);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/no-such-file\.env/);
    expect(run.stdout).not.toContain('safe to deploy to production');
  });

  it('refuses `--from` with no path after it', () => {
    const run = runCheck(COMPLETE, ['--from']);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--from/);
  });

  it('refuses an argument it does not recognise rather than ignoring it', () => {
    const run = runCheck(COMPLETE, ['--envfile=.env']);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--envfile=\.env/);
  });
});
