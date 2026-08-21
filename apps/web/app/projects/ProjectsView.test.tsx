// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KPIS, PROJECTS, mockNextNavigation } from '@/test/helpers/islands';

/**
 * The interactive half of `/projects`.
 *
 * Its data arrives as props from the Server Component above, so what is worth
 * asserting is what it does with them: which jobs the filters leave on screen,
 * and that the quick-add modal opens against the right job.
 */

vi.mock('next/navigation', () => mockNextNavigation());
vi.mock('@/src/server/actions/projects', () => ({ createProjectAction: vi.fn() }));
vi.mock('@/src/server/actions/transactions', () => ({ createTransactionAction: vi.fn() }));
vi.mock('@/src/server/actions/labor', () => ({ createLaborEntryAction: vi.fn() }));
vi.mock('@/src/server/actions/invoices', () => ({ createInvoiceAction: vi.fn() }));

const { ProjectsView } = await import('./ProjectsView');

afterEach(cleanup);

function renderView(overrides: Partial<Parameters<typeof ProjectsView>[0]> = {}) {
  render(
    <ProjectsView
      projects={PROJECTS}
      projectKPIs={KPIS}
      unassignedCount={3}
      {...overrides}
    />
  );
}

describe('ProjectsView', () => {
  it('renders a card for every job it was given', () => {
    renderView();

    expect(screen.getByText('Cedar Deck')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Island')).toBeInTheDocument();
  });

  it('carries each job’s own margin onto its card', () => {
    renderView();

    expect(screen.getByText('18.4%').parentElement).toHaveClass('badge-critical');
  });

  it('passes the inbox count to the header', () => {
    renderView();

    expect(screen.getByRole('link', { name: /card inbox/i })).toHaveTextContent('3');
  });

  it('narrows to one status when a filter is chosen', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /estimating/i }));

    expect(screen.getByText('Kitchen Island')).toBeInTheDocument();
    expect(screen.queryByText('Cedar Deck')).not.toBeInTheDocument();
  });

  it('searches the job, the client and the site address', async () => {
    renderView();

    await userEvent.type(screen.getByPlaceholderText(/search projects/i), 'thorne');

    expect(screen.getByText('Kitchen Island')).toBeInTheDocument();
    expect(screen.queryByText('Cedar Deck')).not.toBeInTheDocument();
  });

  it('says nothing matched rather than showing an empty grid', async () => {
    renderView();

    await userEvent.type(screen.getByPlaceholderText(/search projects/i), 'zzzz');

    expect(screen.getByText('No jobs match that filter.')).toBeInTheDocument();
  });

  it('invites a first quote when there are no jobs at all', () => {
    renderView({ projects: [], projectKPIs: [] });

    expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
  });

  it('opens quick add on the project tab from the page button', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: /new project estimate/i }));

    expect(screen.getByText('Quick Entry Center')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('opens quick add on the labor tab, against the job whose button was pressed', async () => {
    renderView();

    await userEvent.click(screen.getAllByRole('button', { name: /log hours/i })[0]);

    expect(screen.getByRole('button', { name: 'Labor' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByLabelText(/project \/ job/i)).toHaveValue('proj-1');
  });

  it('closes the modal again', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: /new project estimate/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByText('Quick Entry Center')).not.toBeInTheDocument();
  });
});
