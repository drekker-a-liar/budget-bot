'use client';

import React, { useState, useEffect } from 'react';
import { Project, ProjectFinancialKPIs, BusinessFinancialSummary } from '@budget-bot/core';
import { Navigation } from '@/components/Navigation';
import { JobCostCard } from '@/components/JobCostCard';
import { QuickAddModal } from '@/components/QuickAddModal';
import { SeverityBadge } from '@/components/SeverityBadge';
import { Plus, Filter, Search, ArrowRight, Clock, Hammer } from 'lucide-react';
import Link from 'next/link';

export default function ProjectsPage() {
  const [data, setData] = useState<{
    summary: BusinessFinancialSummary | null;
    projects: Project[];
    projectKPIs: ProjectFinancialKPIs[];
  }>({
    summary: null,
    projects: [],
    projectKPIs: [],
  });

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<'project' | 'expense' | 'labor' | 'invoice'>('project');
  const [quickAddProjectId, setQuickAddProjectId] = useState<string | undefined>(undefined);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredProjects = data.projects.filter((p) => {
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

  const handleCreateProject = async (proj: Partial<Project>) => {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proj),
    });
    await fetchData();
  };

  const handleCreateExpense = async (exp: any) => {
    await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exp),
    });
    await fetchData();
  };

  const handleCreateLabor = async (lab: any) => {
    await fetch('/api/labor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lab),
    });
    await fetchData();
  };

  const handleCreateInvoice = async (inv: any) => {
    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inv),
    });
    await fetchData();
  };

  const openQuickAdd = (tab: 'project' | 'expense' | 'labor' | 'invoice' = 'project', projectId?: string) => {
    setQuickAddTab(tab);
    setQuickAddProjectId(projectId);
    setQuickAddOpen(true);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navigation
        unassignedCount={data.summary?.unassignedTransactionsCount || 0}
        onOpenQuickAdd={openQuickAdd}
      />

      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '1.5rem 1.5rem 3rem 1.5rem' }}>
        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="swiss-label" style={{ marginBottom: '0.2rem' }}>
              Project Cost Centers
            </div>
            <h1 className="swiss-header" style={{ fontSize: '1.85rem', color: '#f8fafc' }}>
              Contract Margins & Job Costing
            </h1>
          </div>

          <button onClick={() => openQuickAdd('project')} className="btn-primary">
            <Plus size={14} />
            <span>New Project Estimate</span>
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {['all', 'in_progress', 'estimating', 'completed'].map((st) => (
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

        {/* Project Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.25rem' }}>
          {filteredProjects.map((project) => {
            const kpi = data.projectKPIs.find((k) => k.projectId === project.id);
            if (!kpi) return null;
            return (
              <JobCostCard
                key={project.id}
                project={project}
                kpi={kpi}
                onOpenQuickLabor={(id) => openQuickAdd('labor', id)}
                onOpenQuickExpense={(id) => openQuickAdd('expense', id)}
              />
            );
          })}
        </div>
      </div>

      <QuickAddModal
        initialTab={quickAddTab}
        initialProjectId={quickAddProjectId}
        projects={data.projects}
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onCreateProject={handleCreateProject}
        onCreateExpense={handleCreateExpense}
        onCreateLabor={handleCreateLabor}
        onCreateInvoice={handleCreateInvoice}
      />
    </div>
  );
}
