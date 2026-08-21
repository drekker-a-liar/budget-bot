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

test.describe('with no session', () => {
  test('the dashboard is the sign-in page', async ({ page }) => {
    await page.goto('/');

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
});
