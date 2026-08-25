import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_EMAIL, runDbScript } from './environment';

/**
 * The one end-to-end run: is this thing actually wired together?
 *
 * It asserts the two halves of the spec that no unit test can reach. First
 * that the door is locked - a visitor with no session gets the sign-in page,
 * and a machine caller gets a 401. Then the journey the app exists for: sign
 * in, see the books, quote a job, file a card charge against it, and watch the
 * job's cost move.
 *
 * Everything below goes through the browser and the real database. There are
 * no mocks in this file.
 */

/** The job this run quotes. Short: the inbox's project menu truncates at 28. */
const PROJECT = {
  name: 'E2E Garage Door Tune-Up',
  client: 'Dana Okonkwo',
  quotedTotal: '4500',
};

/** A seeded charge nobody has filed yet, and what it costs. */
const UNFILED_CHARGE = { text: "LOWE'S #1104", amount: '$219.00' };

/** A seeded job, to prove the dashboard is reading the database. */
const SEEDED_PROJECT = 'Master Bath Tile & Double Vanity Remodel';

/**
 * The scripted bank, and what it hands over. All of it comes from
 * `src/server/bank/fake-provider.ts`, which is the only provider reachable
 * with `E2E=1` set - no Plaid account, no credentials, no network.
 */
const FAKE_BANK = {
  institution: 'Fake Bank (E2E)',
  checkingMask: /••• 0000/,
  cardMask: /••• 4471/,
  cardLimit: '$5,000.00',
  /**
   * What the inbox draws for the card charge on the fake's first page. The
   * *description* is the merchant name when the provider resolved one, which
   * is what makes `raw_descriptor` ("FAKE HARDWARE 4471") a stored column
   * rather than a rendered one; the vendor beside it is what the categoriser
   * made of the same string.
   */
  charge: { description: 'Fake Hardware Supply', amount: '$114.75' },
};

/**
 * The item id `FakeBankProvider` mints for every connection it exchanges
 * (`fake-provider.ts`, `FAKE_ITEM_ID`) - the only one a webhook body can name
 * for this run's connection to resolve.
 */
const FAKE_ITEM_ID = 'item-fake';

/**
 * One value per invocation of this suite, folded into every webhook body it
 * sends. `webhook_events.body_hash` carries a table-wide unique constraint,
 * and `db:seed --reset` only clears the owner's own domain tables - it has no
 * owner to scope a webhook ledger row to before the item is resolved, so a
 * row this suite inserted on a previous run against the same database
 * outlives the reset. A static body would make its second post of a run
 * collide with the first run's row and read back `duplicate:true` where this
 * run expects `true` - not a hazard the door needs to guard against, since a
 * real Plaid webhook body is never byte-identical across two calendar days
 * anyway. The nonce is never read by the route's own dispatch (`type`/`code`/
 * `item_id`/`error.error_code` are the only fields it looks at); it exists
 * purely to make this run's hash this run's own.
 */
const RUN_NONCE = randomUUID();

/** One connection, as `/api/export` (spec §6) is willing to describe it. */
interface ExportConnection {
  institutionName: string | null;
  lastSyncedAt: string | null;
}
interface ExportDoc {
  units: string;
  connections: ExportConnection[];
}

/**
 * The fake provider's stand-in for Plaid's signature (spec §2): a header that
 * has to equal `sha256(rawBody)` hex, computed here the same way
 * `FakeBankProvider.verifyAndParseWebhook` checks it.
 */
function fakeVerificationHeader(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** Posts a Plaid-shaped webhook body through the real route, fake-signed. */
function postFakeWebhook(page: Page, rawBody: string) {
  return page.request.post('/api/webhooks/plaid', {
    headers: {
      'content-type': 'application/json',
      'fake-verification': fakeVerificationHeader(rawBody),
    },
    data: rawBody,
  });
}

/** The owner's own export, read the same way `DangerZone`'s link would fetch it. */
async function fetchExport(page: Page): Promise<ExportDoc> {
  const response = await page.request.get('/api/export');
  expect(response.status()).toBe(200);
  return response.json() as Promise<ExportDoc>;
}

test.describe('with no session', () => {
  test('the dashboard is the sign-in page', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('the connections screen is the sign-in page too', async ({ page }) => {
    // Named separately from the dashboard: this page is the one that can spend
    // a bank credential, so "it is behind the door" is worth asserting about
    // it by name rather than inferring from the middleware's matcher.
    await page.goto('/settings/connections');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('the CSV import route answers 401 rather than redirecting', async ({ request }) => {
    // A `fetch` cannot act on a 302 to an HTML page; a machine caller needs a
    // status. Playwright's request context carries no cookies from the page.
    const response = await request.post('/api/import/csv', {
      headers: { 'Content-Type': 'text/csv' },
      data: 'Date,Description,Amount\n2026-08-18,THE HOME DEPOT,10.00',
      maxRedirects: 0,
    });

    expect(response.status()).toBe(401);
  });
});

/**
 * `.serial`, because these four are one journey and share a page: each depends
 * on what the last one left behind. Without it, a failure halfway through
 * reports three more failures that are only consequences of the first, and the
 * one line worth reading is buried. Serial mode skips the rest instead.
 */
test.describe.serial('signed in through the test-only door', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Signing in is what creates the user row - so it has to happen before the
    // seed script, which seeds an existing user and refuses to invent one.
    await page.goto('/login');
    await page.getByLabel('End-to-end test sign-in').fill(E2E_EMAIL);
    await page.getByRole('button', { name: 'Sign in for tests' }).click();
    await expect(page).toHaveURL('/');

    runDbScript('db:seed', ['--owner-email', E2E_EMAIL, '--reset']);
    await page.reload();
  });

  test.afterAll(async () => {
    await page.close();
  });

  /**
   * The card on `/settings/connections` for the bank this run connected, and
   * deliberately not `.first()` or `.last()`: there is exactly one, because
   * `db:seed --reset` now takes the owner's linked banks with it. Two would
   * mean a previous run's connection survived, which is worth failing over -
   * its `/transactions/sync` cursor is spent, so the run after it would find
   * an empty inbox and no explanation.
   */
  const connectionCard = () =>
    page.locator('.swiss-card').filter({ hasText: FAKE_BANK.institution });

  test('the dashboard renders the books out of Postgres', async () => {
    await expect(
      page.getByRole('heading', { name: 'Contractor Profit & Expense Command' })
    ).toBeVisible();

    await expect(page.getByRole('link', { name: SEEDED_PROJECT })).toBeVisible();
    await expect(page.getByText('3 Unassigned Card Transactions')).toBeVisible();
  });

  test('a job can be quoted from the projects page', async () => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'New Project Estimate' }).click();

    await page.getByLabel('Project Name').fill(PROJECT.name);
    await page.getByLabel('Client Name').fill(PROJECT.client);
    await page.getByLabel('Quoted Price ($)').fill(PROJECT.quotedTotal);
    await page.getByRole('button', { name: 'Create Project' }).click();

    // The action revalidates the tree, so the card appears without a reload.
    await expect(page.getByRole('link', { name: PROJECT.name })).toBeVisible();
  });

  test('an unfiled card charge can be filed against it', async () => {
    await page.goto('/');
    const row = page.getByRole('row').filter({ hasText: UNFILED_CHARGE.text });
    await expect(row).toBeVisible();

    await row.getByLabel('Assign to project').selectOption({
      // What the menu renders: the job's name and the status it starts in.
      label: `${PROJECT.name} (in_progress)`,
    });

    // The inbox shows unfiled charges, so a filed one leaves it.
    await expect(page.getByText('2 Unassigned Card Transactions')).toBeVisible();
    await expect(row).toBeHidden();
  });

  test("the job's direct costs now carry that charge", async () => {
    await page.goto('/projects');
    await page.getByPlaceholder('Search projects, clients...').fill(PROJECT.name);

    const card = page.locator('.swiss-card').filter({ hasText: PROJECT.name });
    await expect(card).toBeVisible();
    await expect(card.getByText('Direct Costs').locator('..')).toContainText(
      UNFILED_CHARGE.amount
    );
  });

  test('a bank can be connected, and its accounts arrive with it', async () => {
    await page.goto('/settings/connections');
    await expect(page.getByRole('heading', { name: 'Where the Card Inbox Comes From' })).toBeVisible();

    await page.getByRole('button', { name: 'Connect a bank' }).click();

    const connection = connectionCard();
    await expect(connection).toBeVisible();

    // By text, never by index: the two accounts are written by one statement
    // and share a `created_at`, so which of them sorts first is the tie-break
    // on a random uuid and is not the same on two different databases.
    const checking = connection.getByRole('row').filter({ hasText: FAKE_BANK.checkingMask });
    const credit = connection.getByRole('row').filter({ hasText: FAKE_BANK.cardMask });
    await expect(checking).toBeVisible();
    await expect(credit).toBeVisible();
    // The limit only a credit line has, which is the column that proves the
    // account's own fields made it through rather than a shared default.
    await expect(credit).toContainText(FAKE_BANK.cardLimit);
  });

  test('the first sync put the card charge in the inbox', async () => {
    await page.goto('/transactions');

    const row = page.getByRole('row').filter({ hasText: FAKE_BANK.charge.description });
    await expect(row).toBeVisible();
    await expect(row).toContainText(FAKE_BANK.charge.amount);
    // Filed to the card it was charged to, not to the checking account that
    // shares the connection.
    await expect(row).toContainText(FAKE_BANK.cardMask);

    // The header pill reads the linked accounts rather than a hard-coded card,
    // so connecting a bank is what put a name in it - and it is the *credit*
    // account, not whichever of the two the fake happened to write first
    // (spec §6). The name is paired with its own mask, which is the part that
    // would be wrong if the pill were reading them off different rows.
    await expect(page.getByText('Fake Business Card ••• 4471:')).toBeVisible();
  });

  test('sync now runs, and says honestly that there was nothing left', async () => {
    await page.goto('/settings/connections');
    const connection = connectionCard();

    await connection.getByRole('button', { name: 'Sync now' }).click();

    // Zero is the right answer and the interesting one. The sync that runs
    // straight after Link is bounded at five pages and the script is two, so
    // it already reached the end; a button that reported "1 added" here would
    // mean the committed cursor had been lost and the run replayed a page.
    await expect(connection.getByRole('status')).toHaveText(
      'Synced: 0 added, 0 modified, 0 removed.'
    );
    await expect(connection.getByText(/Last synced .* UTC/)).toBeVisible();
  });

  /**
   * From here on the journey drives the lifecycle Plaid pushes at this
   * connection from the outside - a webhook, a redelivery, a broken token -
   * through the real `/api/webhooks/plaid` route rather than the UI, the way
   * Plaid itself would reach the app (spec §2, §3). `lastSyncWebhookBody` is
   * the exact bytes the sync step sent, kept so the replay step can resend
   * them byte-for-byte: a body reconstructed from the same fields would still
   * be a *body Plaid could have sent twice*, not proof this route recognises
   * the one it already saw.
   */
  let lastSyncWebhookBody: string;

  test('a webhook-driven sync updates the connection without the Sync now button', async () => {
    const before = await fetchExport(page);
    const beforeConnection = before.connections.find(
      (c) => c.institutionName === FAKE_BANK.institution
    );
    // Set by the two tests above, which already ran a connect and a manual
    // sync - the baseline this step's own sync has to move past.
    expect(beforeConnection?.lastSyncedAt).toBeTruthy();

    lastSyncWebhookBody = JSON.stringify({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: FAKE_ITEM_ID,
      nonce: RUN_NONCE,
    });
    const response = await postFakeWebhook(page, lastSyncWebhookBody);

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    // The fake script's two pages were already drained by the connect step
    // (spec §2's `defaultFakeScript`), so this sync has nothing new to add -
    // its proof of having run is `last_synced_at` moving, not a new row.
    const after = await fetchExport(page);
    const afterConnection = after.connections.find(
      (c) => c.institutionName === FAKE_BANK.institution
    );
    expect(afterConnection?.lastSyncedAt).toBeTruthy();
    expect(new Date(afterConnection!.lastSyncedAt!).getTime()).toBeGreaterThan(
      new Date(beforeConnection!.lastSyncedAt!).getTime()
    );

    await page.goto('/settings/connections');
    await expect(connectionCard().getByText(/Last synced .* UTC/)).toBeVisible();
  });

  test('replaying the identical webhook body is recognised, not reprocessed', async () => {
    const before = await fetchExport(page);
    const beforeConnection = before.connections.find(
      (c) => c.institutionName === FAKE_BANK.institution
    );

    const response = await postFakeWebhook(page, lastSyncWebhookBody);

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });

    // Nothing ran a second time: the replay ledger's unique `body_hash`
    // caught it before a sync was ever dispatched (spec §3).
    const after = await fetchExport(page);
    const afterConnection = after.connections.find(
      (c) => c.institutionName === FAKE_BANK.institution
    );
    expect(afterConnection?.lastSyncedAt).toBe(beforeConnection?.lastSyncedAt);
  });

  test('an ITEM_LOGIN_REQUIRED webhook shows the reauth banner, and Reconnect clears it', async () => {
    const rawBody = JSON.stringify({
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: FAKE_ITEM_ID,
      error: { error_code: 'ITEM_LOGIN_REQUIRED' },
      nonce: RUN_NONCE,
    });
    const response = await postFakeWebhook(page, rawBody);

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    await page.goto('/settings/connections');
    const connection = connectionCard();
    await expect(connection.getByText('Your bank needs you to sign in again')).toBeVisible();
    await expect(connection.getByRole('alert')).toHaveText(
      'This bank needs you to sign in again.'
    );

    // The fake kind's Reconnect resolves immediately (no Link UI to drive
    // behind the E2E door) - `markReconnectedAction` straight to `'active'`.
    await connection.getByRole('button', { name: 'Reconnect' }).click();

    await expect(connection.getByText('Connected')).toBeVisible();
    await expect(connection.getByRole('alert')).toHaveCount(0);
  });

  test('disconnecting removes the connection but keeps its transactions', async () => {
    const connection = connectionCard();

    await connection.getByRole('button', { name: 'Disconnect' }).click();
    await connection.getByLabel(/Type .disconnect. to confirm/i).fill('disconnect');
    await connection.getByRole('button', { name: 'Disconnect' }).click();

    await expect(connectionCard()).toBeHidden();

    // `bank_accounts` cascades away with the connection, but
    // `transactions.bank_account_id` is `SET NULL` (spec §6) - the charge
    // this run synced earlier stays on the ledger with no bank behind it.
    await page.goto('/transactions');
    const row = page.getByRole('row').filter({ hasText: FAKE_BANK.charge.description });
    await expect(row).toBeVisible();
    await expect(row).toContainText(FAKE_BANK.charge.amount);
  });

  test('the settings page still offers a full export', async () => {
    await page.goto('/settings/connections');

    await expect(page.getByRole('link', { name: 'Export my data' })).toHaveAttribute(
      'href',
      '/api/export'
    );

    // Not a delete-all step deliberately: this suite reseeds by dropping the
    // owner's rows, and running delete-all here would make that reset the
    // test itself rather than `db:seed --reset`'s job. Unit and action tests
    // already cover delete-all's own behaviour.
    const exported = await fetchExport(page);
    expect(exported.units).toBe('cents');
  });
});
