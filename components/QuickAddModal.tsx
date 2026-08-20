'use client';

import React, { useState, useEffect } from 'react';
import { Project, ExpenseCategory, PricingType, ProjectStatus } from '@/lib/types';
import { Receipt, Clock, Hammer, FileText, X } from 'lucide-react';

interface QuickAddModalProps {
  initialTab?: 'project' | 'expense' | 'labor' | 'invoice';
  initialProjectId?: string;
  projects: Project[];
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (data: Partial<Project>) => Promise<void>;
  onCreateExpense: (data: any) => Promise<void>;
  onCreateLabor: (data: any) => Promise<void>;
  onCreateInvoice: (data: any) => Promise<void>;
}

export function QuickAddModal({
  initialTab = 'expense',
  initialProjectId,
  projects,
  isOpen,
  onClose,
  onCreateProject,
  onCreateExpense,
  onCreateLabor,
  onCreateInvoice,
}: QuickAddModalProps) {
  const [activeTab, setActiveTab] = useState<'project' | 'expense' | 'labor' | 'invoice'>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Project Form State
  const [projName, setProjName] = useState('');
  const [projClient, setProjClient] = useState('');
  const [projPhone, setProjPhone] = useState('');
  const [projAddress, setProjAddress] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projPricingType, setProjPricingType] = useState<PricingType>('fixed');
  const [projQuotedTotal, setProjQuotedTotal] = useState('4500');
  const [projQuotedMaterials, setProjQuotedMaterials] = useState('1500');
  const [projQuotedHours, setProjQuotedHours] = useState('32');
  const [projTargetRate, setProjTargetRate] = useState('85');

  // Expense Form State
  const [expProjectId, setExpProjectId] = useState(initialProjectId || (projects[0]?.id || ''));
  const [expVendor, setExpVendor] = useState('The Home Depot');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('materials');
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));

  // Labor Form State
  const [labProjectId, setLabProjectId] = useState(initialProjectId || (projects[0]?.id || ''));
  const [labDate, setLabDate] = useState(new Date().toISOString().slice(0, 10));
  const [labHours, setLabHours] = useState('8');
  const [labRate, setLabRate] = useState('85');
  const [labNotes, setLabNotes] = useState('');

  // Invoice Form State
  const [invProjectId, setInvProjectId] = useState(initialProjectId || (projects[0]?.id || ''));
  const [invNumber, setInvNumber] = useState(`INV-2026-0${Math.floor(10 + Math.random() * 89)}`);
  const [invAmount, setInvAmount] = useState('2500');
  const [invDeposit, setInvDeposit] = useState('1000');
  const [invDueDate, setInvDueDate] = useState(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));

  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onCreateProject({
        name: projName,
        clientName: projClient,
        clientPhone: projPhone,
        clientAddress: projAddress,
        description: projDesc,
        pricingType: projPricingType,
        quotedTotal: parseFloat(projQuotedTotal) || 0,
        quotedMaterials: parseFloat(projQuotedMaterials) || 0,
        quotedLaborHours: parseFloat(projQuotedHours) || 0,
        targetHourlyRate: parseFloat(projTargetRate) || 85,
        targetMarginPct: 45,
        status: 'in_progress' as ProjectStatus,
        startDate: new Date().toISOString().slice(0, 10),
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expAmount) return;
    setLoading(true);
    try {
      await onCreateExpense({
        projectId: expProjectId || undefined,
        vendor: expVendor,
        description: expDesc || `${expVendor} purchase`,
        amount: parseFloat(expAmount),
        category: expCategory,
        date: expDate,
        paymentMethod: 'card',
        cardLast4: '4892',
        status: expProjectId ? 'matched' : 'unassigned',
        taxDeductible: true,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleLaborSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!labHours) return;
    setLoading(true);
    try {
      await onCreateLabor({
        projectId: labProjectId,
        date: labDate,
        hours: parseFloat(labHours),
        hourlyRate: parseFloat(labRate),
        workerName: 'Mike (Lead)',
        notes: labNotes,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleInvoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invAmount) return;
    setLoading(true);
    try {
      await onCreateInvoice({
        projectId: invProjectId,
        invoiceNumber: invNumber,
        amount: parseFloat(invAmount),
        depositAmount: parseFloat(invDeposit),
        dueDate: invDueDate,
        dateIssued: new Date().toISOString().slice(0, 10),
        status: 'sent',
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            Quick Entry Center
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.35rem',
            background: 'var(--bg-input)',
            padding: '0.3rem',
            borderRadius: '6px',
            marginBottom: '1.25rem',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('expense')}
            style={{
              padding: '0.45rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: activeTab === 'expense' ? 700 : 500,
              background: activeTab === 'expense' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'expense' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              border: activeTab === 'expense' ? '1px solid var(--border-strong)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
            }}
          >
            <Receipt size={13} />
            <span>Receipt</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('labor')}
            style={{
              padding: '0.45rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: activeTab === 'labor' ? 700 : 500,
              background: activeTab === 'labor' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'labor' ? 'var(--accent-indigo)' : 'var(--text-secondary)',
              border: activeTab === 'labor' ? '1px solid var(--border-strong)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
            }}
          >
            <Clock size={13} />
            <span>Labor</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('project')}
            style={{
              padding: '0.45rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: activeTab === 'project' ? 700 : 500,
              background: activeTab === 'project' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'project' ? '#ffffff' : 'var(--text-secondary)',
              border: activeTab === 'project' ? '1px solid var(--border-strong)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
            }}
          >
            <Hammer size={13} />
            <span>Project</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('invoice')}
            style={{
              padding: '0.45rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: activeTab === 'invoice' ? 700 : 500,
              background: activeTab === 'invoice' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'invoice' ? 'var(--severity-healthy)' : 'var(--text-secondary)',
              border: activeTab === 'invoice' ? '1px solid var(--border-strong)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
            }}
          >
            <FileText size={13} />
            <span>Invoice</span>
          </button>
        </div>

        {/* Tab 1: Expense / Receipt */}
        {activeTab === 'expense' && (
          <form onSubmit={handleExpenseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="swiss-label">Link to Project / Job</label>
              <select
                value={expProjectId}
                onChange={(e) => setExpProjectId(e.target.value)}
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              >
                <option value="">⚡ Unassigned / Operating Overhead</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label">Vendor</label>
                <input
                  type="text"
                  value={expVendor}
                  onChange={(e) => setExpVendor(e.target.value)}
                  placeholder="The Home Depot, Lowe's, Shell"
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder="145.50"
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label">Expense Category</label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                >
                  <option value="materials">Materials & Supplies</option>
                  <option value="tools">Tools & Equipment</option>
                  <option value="mileage_fuel">Fuel & Van Transit</option>
                  <option value="permits_fees">Permits & Dump Fees</option>
                  <option value="subcontractor">Subcontractor</option>
                  <option value="overhead">Overhead / Office</option>
                </select>
              </div>

              <div>
                <label className="swiss-label">Purchase Date</label>
                <input
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div>
              <label className="swiss-label">Description / Receipt Notes</label>
              <input
                type="text"
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="Subway tile boxes, screws, thinset mortar"
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Saving...' : 'Record Expense'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Labor Hours */}
        {activeTab === 'labor' && (
          <form onSubmit={handleLaborSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="swiss-label">Project / Job</label>
              <select
                value={labProjectId}
                onChange={(e) => setLabProjectId(e.target.value)}
                required
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label">Hours Worked</label>
                <input
                  type="number"
                  step="0.5"
                  value={labHours}
                  onChange={(e) => setLabHours(e.target.value)}
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Billable Rate ($/hr)</label>
                <input
                  type="number"
                  value={labRate}
                  onChange={(e) => setLabRate(e.target.value)}
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div>
              <label className="swiss-label">Work Date</label>
              <input
                type="date"
                value={labDate}
                onChange={(e) => setLabDate(e.target.value)}
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div>
              <label className="swiss-label">Tasks Performed</label>
              <input
                type="text"
                value={labNotes}
                onChange={(e) => setLabNotes(e.target.value)}
                placeholder="Framing subfloor, setting tile, plumbing hookups"
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Saving...' : 'Log Labor Hours'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: New Project */}
        {activeTab === 'project' && (
          <form onSubmit={handleProjectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="swiss-label">Project Name</label>
              <input
                type="text"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                placeholder="e.g. Master Bath Tile & Vanity Remodel"
                required
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label">Client Name</label>
                <input
                  type="text"
                  value={projClient}
                  onChange={(e) => setProjClient(e.target.value)}
                  placeholder="John & Lisa Smith"
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Client Phone</label>
                <input
                  type="text"
                  value={projPhone}
                  onChange={(e) => setProjPhone(e.target.value)}
                  placeholder="(555) 012-3456"
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div>
              <label className="swiss-label">Job Site Address</label>
              <input
                type="text"
                value={projAddress}
                onChange={(e) => setProjAddress(e.target.value)}
                placeholder="104 Elm Street, Riverdale"
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              <div>
                <label className="swiss-label">Quoted Price ($)</label>
                <input
                  type="number"
                  value={projQuotedTotal}
                  onChange={(e) => setProjQuotedTotal(e.target.value)}
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Est. Materials ($)</label>
                <input
                  type="number"
                  value={projQuotedMaterials}
                  onChange={(e) => setProjQuotedMaterials(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Est. Hours</label>
                <input
                  type="number"
                  value={projQuotedHours}
                  onChange={(e) => setProjQuotedHours(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 4: Invoice */}
        {activeTab === 'invoice' && (
          <form onSubmit={handleInvoiceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="swiss-label">Project / Client</label>
              <select
                value={invProjectId}
                onChange={(e) => setInvProjectId(e.target.value)}
                required
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.clientName})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label">Invoice Number</label>
                <input
                  type="text"
                  value={invNumber}
                  onChange={(e) => setInvNumber(e.target.value)}
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Total Amount ($)</label>
                <input
                  type="number"
                  value={invAmount}
                  onChange={(e) => setInvAmount(e.target.value)}
                  required
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label">Deposit Requested ($)</label>
                <input
                  type="number"
                  value={invDeposit}
                  onChange={(e) => setInvDeposit(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>

              <div>
                <label className="swiss-label">Due Date</label>
                <input
                  type="date"
                  value={invDueDate}
                  onChange={(e) => setInvDueDate(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Issuing...' : 'Issue Invoice'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
