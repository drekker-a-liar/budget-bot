'use client';

import React, { useState } from 'react';
import { ExpenseTransaction, Project, ExpenseCategory } from '@/lib/types';
import {
  CreditCard,
  Check,
  Tag,
  Upload,
  Plus,
  Zap,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2
} from 'lucide-react';

interface TransactionInboxProps {
  transactions: ExpenseTransaction[];
  projects: Project[];
  onAssignProject: (transactionId: string, projectId: string) => Promise<void>;
  onUpdateCategory: (transactionId: string, category: ExpenseCategory) => Promise<void>;
  onSimulateCardSwipe: () => Promise<void>;
  onImportCsv: (csvContent: string) => Promise<void>;
  onDeleteTransaction: (transactionId: string) => Promise<void>;
}

export function TransactionInbox({
  transactions,
  projects,
  onAssignProject,
  onUpdateCategory,
  onSimulateCardSwipe,
  onImportCsv,
  onDeleteTransaction,
}: TransactionInboxProps) {
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'matched'>('unassigned');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');

  // Filter transactions
  const filtered = transactions.filter((t) => {
    if (filter === 'unassigned' && t.status !== 'unassigned') return false;
    if (filter === 'matched' && t.status !== 'matched') return false;
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        t.description.toLowerCase().includes(q) ||
        t.vendor.toLowerCase().includes(q) ||
        t.amount.toString().includes(q)
      );
    }
    return true;
  });

  const unassignedCount = transactions.filter((t) => t.status === 'unassigned').length;
  const unassignedTotal = transactions
    .filter((t) => t.status === 'unassigned')
    .reduce((sum, t) => sum + t.amount, 0);

  const handleSimulate = async () => {
    setIsSimulating(true);
    try {
      await onSimulateCardSwipe();
    } finally {
      setIsSimulating(false);
    }
  };

  const handleCsvSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) return;
    await onImportCsv(csvText);
    setCsvText('');
    setShowCsvModal(false);
  };

  const getCategoryBadge = (cat: ExpenseCategory) => {
    switch (cat) {
      case 'materials':
        return <span className="badge-materials">MATERIALS</span>;
      case 'tools':
        return <span className="badge-caution">TOOLS & EQUIP</span>;
      case 'mileage_fuel':
        return <span className="badge-neutral">FUEL & VAN</span>;
      case 'permits_fees':
        return <span className="badge-neutral">PERMITS & DISPOSAL</span>;
      default:
        return <span className="badge-neutral">{cat.toUpperCase()}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Action Banner */}
      <div
        className="swiss-card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          backgroundColor: unassignedCount > 0 ? 'rgba(245, 158, 11, 0.05)' : 'var(--bg-card)',
          borderColor: unassignedCount > 0 ? 'rgba(245, 158, 11, 0.3)' : 'var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '8px',
              backgroundColor: unassignedCount > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: unassignedCount > 0 ? 'var(--severity-caution)' : 'var(--severity-healthy)',
            }}
          >
            <CreditCard size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              {unassignedCount > 0 ? `${unassignedCount} Unassigned Card Transactions` : 'All Card Transactions Reconciled'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {unassignedCount > 0 ? (
                <span>
                  <strong className="tnum" style={{ color: 'var(--severity-caution)' }}>${unassignedTotal.toFixed(2)}</strong> pending assignment to jobs. Assign them to keep gross profit margins accurate.
                </span>
              ) : (
                <span>100% of material purchases and operating expenses are mapped to active contracts.</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={handleSimulate}
            disabled={isSimulating}
            className="btn-success"
            title="Simulate live card swipe from Home Depot / Sherwin-Williams"
          >
            <Zap size={14} />
            <span>{isSimulating ? 'Simulating...' : 'Simulate Live Swipe'}</span>
          </button>

          <button
            onClick={() => setShowCsvModal(true)}
            className="btn-secondary"
            title="Upload CSV statement from Chase, Amex, or Capital One"
          >
            <Upload size={14} />
            <span>Import CSV</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            onClick={() => setFilter('unassigned')}
            className={filter === 'unassigned' ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
          >
            Pending Inbox ({unassignedCount})
          </button>

          <button
            onClick={() => setFilter('matched')}
            className={filter === 'matched' ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
          >
            Assigned to Jobs
          </button>

          <button
            onClick={() => setFilter('all')}
            className={filter === 'all' ? 'btn-primary' : 'btn-secondary'}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
          >
            All Swipes ({transactions.length})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Search vendor, amount..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            style={{ width: '220px', padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
          />

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="form-input"
            style={{ width: '150px', padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
          >
            <option value="all">All Categories</option>
            <option value="materials">Materials</option>
            <option value="tools">Tools & Equip</option>
            <option value="mileage_fuel">Fuel & Van</option>
            <option value="permits_fees">Permits & Fees</option>
            <option value="overhead">Overhead</option>
          </select>
        </div>
      </div>

      {/* Transaction List / Table */}
      <div className="swiss-card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={32} style={{ margin: '0 auto 0.75rem auto', color: 'var(--severity-healthy)' }} />
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f8fafc' }}>No transactions found</div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {filter === 'unassigned'
                ? 'All recent card charges have been matched to projects.'
                : 'No charges match your current search filter.'}
            </div>
          </div>
        ) : (
          <table className="swiss-table">
            <thead>
              <tr>
                <th style={{ width: '90px' }}>Date</th>
                <th>Vendor / Charge Description</th>
                <th style={{ width: '120px' }}>Category</th>
                <th style={{ width: '100px', textAlign: 'right' }}>Amount</th>
                <th style={{ width: '240px' }}>Project Assignment</th>
                <th style={{ width: '50px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const assignedProject = projects.find((p) => p.id === t.projectId);
                return (
                  <tr key={t.id}>
                    {/* Date */}
                    <td className="tnum" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {t.date}
                    </td>

                    {/* Description & Vendor */}
                    <td>
                      <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.85rem' }}>
                        {t.vendor}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        {t.description} &bull; <span className="tnum">••• {t.cardLast4 || '4892'}</span>
                        {t.receiptNumber && <span> &bull; Ref #{t.receiptNumber}</span>}
                      </div>
                    </td>

                    {/* Category Selector */}
                    <td>
                      <select
                        value={t.category}
                        onChange={(e) => onUpdateCategory(t.id, e.target.value as ExpenseCategory)}
                        style={{
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border-subtle)',
                          color: '#f8fafc',
                          padding: '0.25rem 0.4rem',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          outline: 'none',
                        }}
                      >
                        <option value="materials">Materials</option>
                        <option value="tools">Tools</option>
                        <option value="mileage_fuel">Fuel & Van</option>
                        <option value="permits_fees">Permits</option>
                        <option value="subcontractor">Subcontractor</option>
                        <option value="overhead">Overhead</option>
                      </select>
                    </td>

                    {/* Amount */}
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem', color: '#f8fafc' }}>
                      ${t.amount.toFixed(2)}
                    </td>

                    {/* Project Matcher Dropdown */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <select
                          value={t.projectId || ''}
                          onChange={(e) => onAssignProject(t.id, e.target.value)}
                          style={{
                            width: '100%',
                            background: t.projectId ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            border: `1px solid ${t.projectId ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
                            color: t.projectId ? '#10b981' : '#f59e0b',
                            padding: '0.35rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            outline: 'none',
                          }}
                        >
                          <option value="">⚡ Unassigned (Select Job...)</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name.length > 28 ? p.name.slice(0, 28) + '...' : p.name} ({p.status})
                            </option>
                          ))}
                        </select>

                        {t.projectId && (
                          <span title="Matched to project" style={{ color: 'var(--severity-healthy)' }}>
                            <Check size={14} />
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Delete button */}
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => onDeleteTransaction(t.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '0.2rem',
                        }}
                        title="Delete expense"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* CSV Statement Import Modal */}
      {showCsvModal && (
        <div className="modal-overlay" onClick={() => setShowCsvModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                Import Credit Card Statement CSV
              </div>
              <button
                onClick={() => setShowCsvModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                &times;
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Paste raw CSV text exported from your bank (e.g. Chase, Capital One Spark, Home Depot Commercial). The smart categorizer will auto-detect Home Depot, Lowe&apos;s, Fastenal, and gas charges.
            </p>

            <form onSubmit={handleCsvSubmit}>
              <textarea
                rows={8}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Date,Description,Amount&#10;2026-08-19,THE HOME DEPOT #0421,124.50&#10;2026-08-19,LOWE'S #1104,89.20"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', marginBottom: '1rem' }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowCsvModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Import Transactions
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
