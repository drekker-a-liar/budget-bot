'use client';

import React, { useState } from 'react';
import { Project, ProjectFinancialKPIs } from '@budget-bot/core';
import { Plus } from 'lucide-react';
import { JobCostCard } from '@/components/JobCostCard';
import { Navigation } from '@/components/Navigation';
import { QuickAddModal, type QuickAddTab } from '@/components/QuickAddModal';

/**
 * The interactive half of `/projects`.
 *
 * The page above is a Server Component: it reads the projects and their KPIs
 * and hands them here as plain props. What stays on the client is what has to
 * - the filter and the search box, which are a view of data already in the
 * browser, and the modal, which calls the server actions itself.
 */

interface ProjectsViewProps {
  projects: Project[];
  projectKPIs: ProjectFinancialKPIs[];
  unassignedCount: number;
}

const STATUS_FILTERS = ['all', 'in_progress', 'estimating', 'completed'] as const;

export function ProjectsView({ projects, projectKPIs, unassignedCount }: ProjectsViewProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [quickAdd, setQuickAdd] = useState<{ tab: QuickAddTab; projectId?: string } | null>(null);

  const filteredProjects = projects.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.clientAddress.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={unassignedCount}
        onOpenQuickAdd={(tab = 'project') => setQuickAdd({ tab })}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Project Cost Centers
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Contract Margins &amp; Job Costing
            </h1>
          </div>

          <button onClick={() => setQuickAdd({ tab: 'project' })} className="btn-primary">
            <Plus size={14} />
            <span>New Project Estimate</span>
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {STATUS_FILTERS.map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={statusFilter === st ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', textTransform: 'capitalize' }}
              >
                {st === 'all' ? 'All Jobs' : st.replace('_', ' ')}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search projects, clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            style={{ width: '260px', padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
          />
        </div>

        {filteredProjects.length === 0 ? (
          <div className="swiss-card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {projects.length === 0
              ? 'No projects yet. Start with a quote: every margin on this dashboard is measured against one.'
              : 'No jobs match that filter.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.25rem' }}>
            {filteredProjects.map((project) => {
              const kpi = projectKPIs.find((k) => k.projectId === project.id);
              if (!kpi) return null;
              return (
                <JobCostCard
                  key={project.id}
                  project={project}
                  kpi={kpi}
                  onOpenQuickLabor={(id) => setQuickAdd({ tab: 'labor', projectId: id })}
                  onOpenQuickExpense={(id) => setQuickAdd({ tab: 'expense', projectId: id })}
                />
              );
            })}
          </div>
        )}
      </div>

      <QuickAddModal
        initialTab={quickAdd?.tab ?? 'project'}
        initialProjectId={quickAdd?.projectId}
        projects={projects}
        isOpen={quickAdd !== null}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  );
}
