'use client';

import React, { useState } from 'react';
import {
  addCents,
  formatCents,
  ExpenseTransaction,
  Project,
  ExpenseCategory,
} from '@budget-bot/core';
import { CreditCard, Check, Upload, CheckCircle2, Trash2 } from 'lucide-react';

interface TransactionInboxProps {
  transactions: ExpenseTransaction[];
  projects: Project[];
  onAssignProject: (transactionId: string, projectId: string) => void;
  onUpdateCategory: (transactionId: string, category: ExpenseCategory) => void;
  /** The chosen file's text: read here so the page can POST it as a raw
   * text/csv body, with no FormData in between. */
  onImportCsv: (text: string) => void;
  onDeleteTransaction: (transactionId: string) => void;
}

export function TransactionInbox({
  transactions,
  projects,
  onAssignProject,
  onUpdateCategory,
  onImportCsv,
  onDeleteTransaction,
}: TransactionInboxProps) {
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'matched'>('unassigned');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

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
        // Amount as typed, without the currency chrome: "1420.75".
        formatCents(t.amountCents).replace(/[$,]/g, '').includes(q)
      );
    }
    return true;
  });

  const unassignedCount = transactions.filter((t) => t.status === 'unassigned').length;
  const unassignedTotalCents = addCents(
    ...transactions.filter((t) => t.status === 'unassigned').map((t) => t.amountCents)
  );

  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(onImportCsv);
    // Cleared so choosing the same file twice still fires a change: uploading
    // one statement again is something people do on purpose. Safe to do
    // immediately - `file` above is already the reference this read needs.
    event.target.value = '';
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
                  <strong className="tnum" style={{ color: 'var(--severity-caution)' }}>{formatCents(unassignedTotalCents)}</strong> pending assignment to jobs. Assign them to keep gross profit margins accurate.
                </span>
              ) : (
                <span>100% of material purchases and operating expenses are mapped to active contracts.</span>
              )}
            </div>
          </div>
        </div>

        <label
          className="btn-secondary"
          style={{ cursor: 'pointer' }}
          title="Upload a CSV statement exported from your bank"
        >
          <Upload size={14} />
          <span>Import CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Import CSV statement"
            onChange={handleFileChosen}
            style={{ display: 'none' }}
          />
        </label>
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
                        {t.description}
                        {t.cardLast4 && (
                          <span>
                            {' '}&bull; <span className="tnum">••• {t.cardLast4}</span>
                          </span>
                        )}
                        {t.receiptNumber && <span> &bull; Ref #{t.receiptNumber}</span>}
                      </div>
                    </td>

                    {/* Category Selector */}
                    <td>
                      <select
                        aria-label="Expense category"
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
                      {formatCents(t.amountCents)}
                    </td>

                    {/* Project Matcher Dropdown */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <select
                          aria-label="Assign to project"
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

    </div>
  );
}
