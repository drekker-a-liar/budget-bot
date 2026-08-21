import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PlaidItemError,
  PlaidProvider,
  PlaidRateLimited,
  PlaidRequestError,
  createPlaidClient,
  type PlaidClientLike,
  type PlaidResponse,
} from '@budget-bot/bank-connectors';
import type { RawEnv } from '../src/env';

/**
 * `pnpm --filter web plaid:smoke`: the one thing here that talks to real Plaid.
 *
 * Everything else about this connector is proved without credentials - the
 * provider against fixtures, the sync service and the end-to-end journey
 * against a scripted bank. What none of that can prove is that the *request*
 * this application builds is one Plaid accepts: field names, the
 * `country_codes` enum, `cursor` omitted rather than sent as null, the shape
 * of a `/transactions/sync` page. So a person with Sandbox keys runs this by
 * hand, once, and reads six numbers.
 *
 * ## Three rules, and they are the whole design
 *
 * **Sandbox or nothing.** It creates an Item on demand
 * (`/sandbox/public_token/create`), which is free and disposable against
 * Sandbox and is not a thing to do to a production Plaid account. So
 * `PLAID_ENV` must say `sandbox` or say nothing at all; anything else is a
 * refusal with a non-zero exit, not a warning it prints and then ignores.
 *
 * **The environment, and no second input.** It reads `process.env` and never
 * loads a `.env` - the same rule `check-security.ts` follows and for the same
 * reason: a tool that reaches for a file on the developer's machine is a tool
 * whose behaviour cannot be predicted from the command that ran it. Export the
 * keys, or it skips.
 *
 * **A skip is a success.** Nobody in CI has Sandbox keys, and neither does
 * most of anybody who clones this. Missing keys print one line and exit 0, so
 * this can sit in a script list without becoming a red X on every machine that
 * is not the founder's.
 *
 * ## What it may print
 *
 * Counts, and the institution's display name. Never the access token, never
 * the item id, never a transaction descriptor: this is run in a terminal whose
 * scrollback ends up in bug reports (spec §9). A failure is reported as the
 * mapped Plaid code alone - `error_message` is free text from somebody else's
 * system and is not repeated here even though the connector already redacts
 * tokens out of it.
 */

/** Platypus OAuth Bank: Plaid's Sandbox institution for the OAuth flow. */
export const SMOKE_INSTITUTION_ID = 'ins_127287';

/**
 * How many pages one run will follow. A Sandbox Item has a handful; `has_more`
 * that never goes false is a real failure mode, and an unbounded loop against
 * somebody else's rate limit is a bad way to discover it.
 */
export const SMOKE_MAX_PAGES = 50;

const USAGE = 'Usage: plaid-smoke (no arguments; reads PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV)';

/**
 * The Plaid client, plus the one Sandbox-only endpoint the application itself
 * has no business calling - which is why it is declared here rather than added
 * to `PlaidClientLike`, where it would become an endpoint the app could reach.
 *
 * Typed structurally rather than from `plaid`'s own request types: this app
 * does not depend on the `plaid` package, `@budget-bot/bank-connectors` does.
 * A real `PlaidApi` is assigned to it below with no cast, which is what makes
 * this a compile-time claim that the endpoint exists in the shape written
 * here rather than a hope checked at 400.
 */
export interface SandboxClient extends PlaidClientLike {
  sandboxPublicTokenCreate(request: {
    institution_id: string;
    initial_products: string[];
  }): Promise<PlaidResponse<{ public_token: string }>>;
}

/** What the run prints, and the only thing it prints. */
export interface SmokeReport {
  institution: string;
  accounts: number;
  pages: number;
  added: number;
  modified: number;
  removed: number;
}

export type SmokeDecision =
  | { kind: 'skip'; message: string }
  | { kind: 'refuse'; message: string }
  | { kind: 'run'; clientId: string; secret: string };

/**
 * Whether this environment may be run against, decided before anything is
 * built and long before anything is sent.
 *
 * `PLAID_ENV` is judged first: a machine configured for production is not a
 * machine with nothing to say, it is one this must not run on, and finding
 * that out only when the keys happen to be exported too would be a guard that
 * works on the wrong days.
 */
export function decide(raw: RawEnv): SmokeDecision {
  const environment = raw.PLAID_ENV;
  if (environment !== undefined && environment !== '' && environment !== 'sandbox') {
    return {
      kind: 'refuse',
      // The name, never the value: nothing this script prints is worth a
      // second thought about where it came from.
      message:
        'PLAID_ENV is set to something other than sandbox. This script creates a Plaid Item ' +
        'on demand and will not do that outside Sandbox. Unset PLAID_ENV or set it to sandbox.',
    };
  }

  const clientId = raw.PLAID_CLIENT_ID;
  const secret = raw.PLAID_SECRET;
  if (!clientId || !secret) {
    return {
      kind: 'skip',
      message: 'Plaid Sandbox keys not set (PLAID_CLIENT_ID, PLAID_SECRET); skipping.',
    };
  }

  return { kind: 'run', clientId, secret };
}

/**
 * The provider's own failure classes, as a code.
 *
 * The same four cases `@budget-bot/bank-connectors` maps every Plaid failure
 * into, and the same choice the connections screen makes: the code, because it
 * is what support asks for and what a reader can act on, and never the
 * message.
 */
export function codeOf(error: unknown): string {
  if (error instanceof PlaidRateLimited) return 'RATE_LIMIT_EXCEEDED';
  if (error instanceof PlaidItemError) return error.code;
  if (error instanceof PlaidRequestError) return error.code;
  return 'UNKNOWN';
}

/**
 * Link an Item, list its accounts, and pull every page there is.
 *
 * Deliberately not `runSync`: this writes nothing and needs no database, and
 * the point of the exercise is the round trip to Plaid rather than the merge
 * rules, which have their own tests against a real Postgres.
 */
export async function runSmoke(client: SandboxClient): Promise<SmokeReport> {
  const provider = new PlaidProvider({ client });

  const { data } = await client.sandboxPublicTokenCreate({
    institution_id: SMOKE_INSTITUTION_ID,
    initial_products: ['transactions'],
  });

  const item = await provider.exchangePublicToken(data.public_token);
  const accounts = await provider.getAccounts(item.accessToken);

  const report: SmokeReport = {
    institution: item.institutionName ?? '(the institution did not give a name)',
    accounts: accounts.length,
    pages: 0,
    added: 0,
    modified: 0,
    removed: 0,
  };

  let cursor: string | null = null;
  while (report.pages < SMOKE_MAX_PAGES) {
    const page = await provider.syncTransactions(item.accessToken, cursor);
    report.pages += 1;
    report.added += page.added.length;
    report.modified += page.modified.length;
    report.removed += page.removed.length;
    cursor = page.nextCursor;

    // `hasMore` with no cursor to ask with is Plaid saying "later" rather than
    // "next"; either way there is nothing further this run can request.
    if (!page.hasMore || cursor === null) break;
  }

  return report;
}

export interface SmokeIo {
  raw?: RawEnv;
  argv?: string[];
  createClient?: (credentials: { clientId: string; secret: string }) => SandboxClient;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/**
 * The command. Returns the exit code rather than taking it: everything above
 * is testable without a subprocess, and this is what makes the printing
 * testable too.
 *
 * - `0` — skipped, or ran and reported.
 * - `1` — it ran and Plaid refused. The code says which.
 * - `2` — it was pointed somewhere it will not go, or asked for something it
 *   does not understand. Nothing was sent.
 */
export async function main({
  raw = process.env,
  argv = process.argv.slice(2),
  createClient = ({ clientId, secret }) =>
    createPlaidClient({ clientId, secret, env: 'sandbox' }),
  out = (line: string) => console.log(line),
  err = (line: string) => console.error(line),
}: SmokeIo = {}): Promise<number> {
  if (argv.length > 0) {
    err(`Unrecognised argument '${argv[0]}'. ${USAGE}`);
    return 2;
  }

  const decision = decide(raw);
  if (decision.kind === 'refuse') {
    err(decision.message);
    return 2;
  }
  if (decision.kind === 'skip') {
    out(decision.message);
    return 0;
  }

  try {
    const report = await runSmoke(
      createClient({ clientId: decision.clientId, secret: decision.secret })
    );
    out(JSON.stringify(report));
    return 0;
  } catch (error) {
    err(`Plaid Sandbox smoke failed: ${codeOf(error)}`);
    return 1;
  }
}

/**
 * True when node was told to run this file, rather than a test importing it.
 * Without this, importing the module to test its pieces would run the command.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // `exitCode` rather than `exit`: the latter can cut stdout off mid-line.
  void main().then((code) => {
    process.exitCode = code;
  });
}
