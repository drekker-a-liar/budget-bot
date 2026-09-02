// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpenseCategorySchema, parseMoney } from '@budget-bot/core';
import { aProject, aTransaction } from '@/test/helpers/props';
import { TransactionInbox } from './TransactionInbox';

/**
 * The triage table: card charges on the left, jobs on the right, and one
 * dropdown between them. What is asserted is that the right transaction id
 * reaches the right callback - filing a receipt against the wrong job is the
 * failure that quietly corrupts every margin on the dashboard.
 */

afterEach(cleanup);

const PROJECTS = [
  aProject({ id: 'proj-1', name: 'Cedar Deck' }),
  aProject({ id: 'proj-2', name: 'Kitchen Island' }),
];

const TRANSACTIONS = [
  aTransaction({ id: 'tx-1', vendor: 'The Home Depot', status: 'unassigned' }),
  aTransaction({
    id: 'tx-2',
    vendor: "Lowe's Home Improvement",
    description: "LOWE'S #1104 - Disposal",
    amountCents: parseMoney(219),
    status: 'unassigned',
  }),
  aTransaction({
    id: 'tx-3',
    vendor: 'Ferguson Plumbing Supply',
    description: 'FERGUSON - PEX',
    status: 'matched',
    projectId: 'proj-1',
  }),
];

function renderInbox(overrides: Partial<Parameters<typeof TransactionInbox>[0]> = {}) {
  const props = {
    transactions: TRANSACTIONS,
    projects: PROJECTS,
    onAssignProject: vi.fn(),
    onUpdateCategory: vi.fn(),
    onImportCsv: vi.fn(),
    onDeleteTransaction: vi.fn(),
    ...overrides,
  };
  render(<TransactionInbox {...props} />);
  return props;
}

/** The row for one vendor. Rows have no accessible name of their own. */
function rowFor(vendor: string): HTMLElement {
  const cell = screen.getByText(vendor).closest('tr');
  if (!cell) throw new Error(`no row for ${vendor}`);
  return cell;
}

describe('TransactionInbox', () => {
  it('opens on the charges still waiting to be filed, and nothing else', () => {
    renderInbox();

    expect(screen.getByText('The Home Depot')).toBeInTheDocument();
    expect(screen.getByText("Lowe's Home Improvement")).toBeInTheDocument();
    expect(screen.queryByText('Ferguson Plumbing Supply')).not.toBeInTheDocument();
  });

  it('counts and totals what is waiting', () => {
    renderInbox();

    expect(screen.getByText('2 Unassigned Card Transactions')).toBeInTheDocument();
    expect(screen.getByText('$307.65')).toBeInTheDocument();
  });

  it('says so, rather than showing an empty table, when nothing is waiting', () => {
    renderInbox({ transactions: [TRANSACTIONS[2]] });

    expect(screen.getByText('All Card Transactions Reconciled')).toBeInTheDocument();
    expect(screen.getByText(/All recent card charges have been matched/)).toBeInTheDocument();
  });

  it('shows the filed charges when asked for them', async () => {
    renderInbox();

    await userEvent.click(screen.getByRole('button', { name: /assigned to jobs/i }));

    expect(screen.getByText('Ferguson Plumbing Supply')).toBeInTheDocument();
    expect(screen.queryByText('The Home Depot')).not.toBeInTheDocument();
  });

  it('searches on the vendor, the description and the amount as typed', async () => {
    renderInbox();
    const search = screen.getByPlaceholderText(/search vendor/i);

    await userEvent.type(search, '219.00');

    expect(screen.getByText("Lowe's Home Improvement")).toBeInTheDocument();
    expect(screen.queryByText('The Home Depot')).not.toBeInTheDocument();
  });

  it('files a charge against the job the user picked', async () => {
    const { onAssignProject } = renderInbox();
    const row = rowFor('The Home Depot');

    await userEvent.selectOptions(
      within(row).getByRole('combobox', { name: /assign to project/i }),
      'proj-2'
    );

    expect(onAssignProject).toHaveBeenCalledWith('tx-1', 'proj-2');
  });

  it('unfiles a charge when the user picks the empty option', async () => {
    const { onAssignProject } = renderInbox({
      transactions: [aTransaction({ id: 'tx-9', projectId: 'proj-1', status: 'unassigned' })],
    });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /assign to project/i }),
      ''
    );

    expect(onAssignProject).toHaveBeenCalledWith('tx-9', '');
  });

  it('recategorises the charge the dropdown belongs to', async () => {
    const { onUpdateCategory } = renderInbox();
    const row = rowFor("Lowe's Home Improvement");

    await userEvent.selectOptions(
      within(row).getByRole('combobox', { name: /expense category/i }),
      'tools'
    );

    expect(onUpdateCategory).toHaveBeenCalledWith('tx-2', 'tools');
  });

  it('deletes the charge whose button was pressed', async () => {
    const { onDeleteTransaction } = renderInbox();
    const row = rowFor('The Home Depot');

    await userEvent.click(within(row).getByRole('button', { name: /delete expense/i }));

    expect(onDeleteTransaction).toHaveBeenCalledWith('tx-1');
  });

  it('hands the chosen file’s text to the page, which is what does the uploading', async () => {
    const { onImportCsv } = renderInbox();
    const csv = 'Date,Description,Amount\n2026-08-18,LOWES,10.00';
    const file = new File([csv], 'august.csv', { type: 'text/csv' });

    await userEvent.upload(screen.getByLabelText(/import csv statement/i), file);

    // Reading the file is async - not part of the `userEvent.upload` promise
    // it resolves inside `onChange`, so the assertion waits for it.
    await waitFor(() => expect(onImportCsv).toHaveBeenCalledWith(csv));
  });

  it('shows the card a charge was made on only when the charge names one', () => {
    // The prototype printed •••• 4892 on every row whether or not the row came
    // from that card, which made an imported statement look like a card feed.
    renderInbox({
      transactions: [
        aTransaction({ id: 'tx-a', vendor: 'Carded', cardLast4: '4892' }),
        aTransaction({ id: 'tx-b', vendor: 'Imported' }),
      ],
    });

    expect(within(rowFor('Carded')).getByText('••• 4892')).toBeInTheDocument();
    expect(within(rowFor('Imported')).queryByText(/•••/)).not.toBeInTheDocument();
  });

  it('names the delete button for a screen reader, not only on hover', () => {
    // `title` shows a tooltip; it is not a reliable accessible name. An
    // icon-only button without `aria-label` is announced as just "button".
    renderInbox();

    const button = within(rowFor('The Home Depot')).getByRole('button', { name: /delete expense/i });
    expect(button).toHaveAttribute('aria-label', 'Delete expense');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('tells assistive tech which filter is pressed', async () => {
    // Three look-alike buttons where only a colour says which one is active;
    // aria-pressed is how that state reaches anyone not looking at the colour.
    renderInbox();
    const pending = screen.getByRole('button', { name: /pending inbox/i });
    const assigned = screen.getByRole('button', { name: /assigned to jobs/i });

    expect(pending).toHaveAttribute('aria-pressed', 'true');
    expect(assigned).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(assigned);

    expect(pending).toHaveAttribute('aria-pressed', 'false');
    expect(assigned).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers every category core knows as a filter, subcontractor included', () => {
    // The filter was a second hand-typed list and had lost `subcontractor`,
    // so sub invoices could be filed under it but never filtered back out.
    // Deriving both selects from the schema keeps them from drifting again.
    renderInbox();

    const filter = screen.getByDisplayValue('All Categories');
    const values = [...filter.querySelectorAll('option')].map((option) => option.value);
    expect(values).toEqual(['all', ...ExpenseCategorySchema.options]);
    expect(values).toContain('subcontractor');

    const rowSelect = within(rowFor('The Home Depot')).getByRole('combobox', { name: /expense category/i });
    expect([...rowSelect.querySelectorAll('option')].map((option) => option.value)).toEqual([
      ...ExpenseCategorySchema.options,
    ]);
  });

  it('offers every job as somewhere to file a charge', () => {
    renderInbox();

    const options = within(rowFor('The Home Depot'))
      .getByRole('combobox', { name: /assign to project/i })
      .querySelectorAll('option');
    expect([...options].map((option) => option.textContent)).toEqual([
      '⚡ Unassigned (Select Job...)',
      'Cedar Deck (in_progress)',
      'Kitchen Island (in_progress)',
    ]);
  });
});
