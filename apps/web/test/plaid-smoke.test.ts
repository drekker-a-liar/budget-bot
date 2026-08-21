import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SMOKE_INSTITUTION_ID,
  SMOKE_MAX_PAGES,
  decide,
  main,
  type SandboxClient,
} from '../scripts/plaid-smoke';

/**
 * `pnpm --filter web plaid:smoke`, which is the one thing in this repository
 * that talks to the real Plaid.
 *
 * That makes two properties worth pinning, and neither of them can be checked
 * by running it for real - nobody in CI has Sandbox keys, and a test that
 * needed them would be a test that never runs.
 *
 * **It refuses to be pointed anywhere but Sandbox.** A script that creates an
 * Item on demand is harmless against Sandbox and is not harmless against a
 * production Plaid account, so `PLAID_ENV=production` is a refusal rather than
 * a warning, and no keys at all is a clean skip rather than a failure - it is
 * run by hand on the machines that have them, and it must not turn into a red
 * X on the machines that do not.
 *
 * **It prints counts and nothing else.** The live path is exercised here with
 * a fake client returning Plaid-shaped responses, so the assertion that no
 * access token, item id or transaction descriptor reaches stdout is made
 * against the real formatting code rather than against a promise.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/plaid-smoke.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * The real script, in a child process with an environment built from nothing.
 *
 * A directory with a decoy `.env` in it, because the point of the skip is that
 * it depends on the environment and on no hidden second input: a developer who
 * has Sandbox keys in the repository's `.env` still has to export them.
 */
function runScript(env: Record<string, string>, args: string[] = []): Run {
  const dir = mkdtempSync(join(tmpdir(), 'plaid-smoke-'));
  writeFileSync(
    join(dir, '.env'),
    'PLAID_CLIENT_ID=decoy\nPLAID_SECRET=decoy\nPLAID_ENV=production\n'
  );

  const result = spawnSync(TSX, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    // Cast because this app's `ProcessEnv` declares `NODE_ENV` as required,
    // and an environment without it is exactly what is being handed over.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } as unknown as NodeJS.ProcessEnv,
  });

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Sandbox credentials, as far as anything here is concerned. */
const KEYS = { PLAID_CLIENT_ID: 'client-id-for-a-test', PLAID_SECRET: 'secret-for-a-test' };

/** The token the fake mints, which must not appear in any output. */
const ACCESS_TOKEN = 'access-sandbox-must-not-be-printed';
const ITEM_ID = 'item-must-not-be-printed';
const DESCRIPTOR = 'UNITED AIRLINES MUST NOT BE PRINTED';

interface FakePage {
  added: number;
  has_more: boolean;
  next_cursor: string;
}

/**
 * A Plaid client, in the shape the SDK answers in and no more of it.
 *
 * `pages` is the script's paging under test: each call hands back the next
 * one, so a loop that ignored `has_more` or forgot to send the cursor on would
 * be visible in the counts rather than only in a review.
 */
function fakeClient(pages: FakePage[]): SandboxClient & { cursors: Array<string | undefined> } {
  let index = 0;
  const cursors: Array<string | undefined> = [];

  const transaction = (id: number) => ({
    transaction_id: `txn-${id}`,
    account_id: 'acct-1',
    amount: 12.5,
    date: '2026-08-01',
    name: DESCRIPTOR,
    merchant_name: null,
    pending: false,
    pending_transaction_id: null,
    authorized_date: null,
    datetime: null,
    iso_currency_code: 'USD',
    personal_finance_category: null,
  });

  return {
    cursors,
    // `as never` throughout: the SDK's response types come from `plaid`, which
    // this app does not depend on. What the provider actually reads is the
    // shape written out here.
    sandboxPublicTokenCreate: async () => ({ data: { public_token: 'public-sandbox-1' } }),
    itemPublicTokenExchange: async () =>
      ({ data: { access_token: ACCESS_TOKEN, item_id: ITEM_ID } }) as never,
    itemGet: async () => ({ data: { item: { institution_id: SMOKE_INSTITUTION_ID } } }) as never,
    institutionsGetById: async () =>
      ({ data: { institution: { name: 'Platypus OAuth Bank' } } }) as never,
    accountsGet: async () =>
      ({
        data: {
          accounts: [
            {
              account_id: 'acct-1',
              name: 'Plaid Checking',
              official_name: null,
              mask: '0000',
              type: 'depository',
              subtype: 'checking',
              balances: { current: 110, available: 100, limit: null, iso_currency_code: 'USD' },
            },
          ],
        },
      }) as never,
    transactionsSync: async (request: { cursor?: string }) => {
      cursors.push(request.cursor);
      const page = pages[index];
      index += 1;
      return {
        data: {
          added: Array.from({ length: page.added }, (_, id) => transaction(id)),
          modified: [],
          removed: [],
          next_cursor: page.next_cursor,
          has_more: page.has_more,
        },
      } as never;
    },
    linkTokenCreate: async () => ({ data: {} }) as never,
    itemRemove: async () => ({ data: {} }) as never,
  } as SandboxClient & { cursors: Array<string | undefined> };
}

/** `main`, with everything it prints captured instead. */
async function runMain(
  env: Record<string, string | undefined>,
  client: SandboxClient,
  argv: string[] = []
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    raw: env,
    argv,
    createClient: () => client,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

describe('deciding whether to run at all', () => {
  it('skips, successfully, when there are no Sandbox keys', () => {
    expect(decide({})).toEqual({
      kind: 'skip',
      message: 'Plaid Sandbox keys not set (PLAID_CLIENT_ID, PLAID_SECRET); skipping.',
    });
  });

  it('skips when only one of the pair is set', () => {
    expect(decide({ PLAID_CLIENT_ID: 'only-half' }).kind).toBe('skip');
    expect(decide({ PLAID_SECRET: 'only-half' }).kind).toBe('skip');
  });

  it('runs when both are set and PLAID_ENV is unset', () => {
    expect(decide(KEYS)).toEqual({
      kind: 'run',
      clientId: KEYS.PLAID_CLIENT_ID,
      secret: KEYS.PLAID_SECRET,
    });
  });

  it('runs when PLAID_ENV says sandbox out loud', () => {
    expect(decide({ ...KEYS, PLAID_ENV: 'sandbox' }).kind).toBe('run');
  });

  it('refuses production, keys or no keys', () => {
    // Louder than the skip on purpose: a machine configured for production is
    // not a machine that has nothing to say, it is one this must not run on.
    expect(decide({ ...KEYS, PLAID_ENV: 'production' }).kind).toBe('refuse');
    expect(decide({ PLAID_ENV: 'production' }).kind).toBe('refuse');
  });

  it('refuses anything that is not sandbox, rather than assuming it', () => {
    expect(decide({ ...KEYS, PLAID_ENV: 'development' }).kind).toBe('refuse');
  });

  it('never repeats the value it was given', () => {
    const refusal = decide({ ...KEYS, PLAID_ENV: 'production' });
    expect(refusal.kind).toBe('refuse');
    expect(JSON.stringify(refusal)).not.toContain(KEYS.PLAID_SECRET);
  });
});

describe('the live run, against a fake Plaid', () => {
  it('pages to exhaustion and reports what it counted', async () => {
    const client = fakeClient([
      { added: 16, has_more: true, next_cursor: 'cursor-1' },
      { added: 4, has_more: false, next_cursor: 'cursor-2' },
    ]);

    const { code, out, err } = await runMain(KEYS, client);

    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({
      institution: 'Platypus OAuth Bank',
      accounts: 1,
      pages: 2,
      added: 20,
      modified: 0,
      removed: 0,
    });
    // The first page asks for nothing; the second asks for what the first
    // handed back. A loop that dropped the cursor would re-read page one for
    // ever and still report a plausible number.
    expect(client.cursors).toEqual([undefined, 'cursor-1']);
  });

  it('prints counts and never a token, an id or a descriptor', async () => {
    const client = fakeClient([{ added: 3, has_more: false, next_cursor: 'cursor-1' }]);

    const { out } = await runMain(KEYS, client);

    const printed = out.join('\n');
    expect(printed).toContain('"added":3');
    for (const secret of [ACCESS_TOKEN, ITEM_ID, DESCRIPTOR, KEYS.PLAID_SECRET, 'public-sandbox-1']) {
      expect(printed).not.toContain(secret);
    }
  });

  it('stops at the page cap rather than following a bank for ever', async () => {
    // `has_more` for ever is a real Plaid failure mode and an unbounded loop
    // against somebody else's rate limit is a bad way to find out.
    const forever = Array.from({ length: SMOKE_MAX_PAGES + 5 }, (_, index) => ({
      added: 1,
      has_more: true,
      next_cursor: `cursor-${index}`,
    }));

    const { code, out } = await runMain(KEYS, fakeClient(forever));

    expect(code).toBe(0);
    expect(JSON.parse(out[0]).pages).toBe(SMOKE_MAX_PAGES);
  });

  it('reports a failure as the mapped code and nothing else', async () => {
    const client = fakeClient([]);
    client.accountsGet = async () => {
      // What the SDK throws: an axios error carrying the request that failed,
      // which is the object the access token travels in.
      throw Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        config: { data: JSON.stringify({ access_token: ACCESS_TOKEN }) },
        response: {
          status: 400,
          data: {
            error_type: 'INVALID_REQUEST',
            error_code: 'INVALID_FIELD',
            error_message: `the access token ${ACCESS_TOKEN} is malformed`,
            request_id: 'req-1',
          },
        },
      });
    };

    const { code, out, err } = await runMain(KEYS, client);

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(['Plaid Sandbox smoke failed: INVALID_FIELD']);
    expect(err.join('\n')).not.toContain(ACCESS_TOKEN);
  });

  it('refuses an argument it does not understand', async () => {
    const { code, err } = await runMain(KEYS, fakeClient([]), ['--production']);

    expect(code).toBe(2);
    expect(err.join('\n')).toContain('plaid-smoke');
  });
});

describe('run as a command', () => {
  it('says it is skipping, and exits 0, with no keys exported', () => {
    const run = runScript({});

    expect(run.stdout.trim()).toBe(
      'Plaid Sandbox keys not set (PLAID_CLIENT_ID, PLAID_SECRET); skipping.'
    );
    expect(run.status).toBe(0);
  });

  it('does not read a .env sitting next to it', () => {
    // The decoy in the scratch directory names production and two keys. If it
    // were loaded, this would refuse - or worse, run.
    const run = runScript({});

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('skipping.');
  });

  it('refuses to start against production', () => {
    const run = runScript({ ...KEYS, PLAID_ENV: 'production' });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('sandbox');
    expect(run.stdout).toBe('');
  });
});
