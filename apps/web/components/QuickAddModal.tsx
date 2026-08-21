'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Project, ExpenseCategory, PricingType } from '@budget-bot/core';
import { Receipt, Clock, Hammer, FileText, X } from 'lucide-react';
import { createInvoiceAction } from '@/src/server/actions/invoices';
import { createLaborEntryAction } from '@/src/server/actions/labor';
import { createProjectAction } from '@/src/server/actions/projects';
import { createTransactionAction } from '@/src/server/actions/transactions';
import type { ActionResult, FieldErrors } from '@/src/server/actions/result';

/**
 * The one place a contractor types anything in.
 *
 * It calls the server actions directly rather than taking four `onCreate...`
 * callbacks, because every page was passing the same four `fetch` wrappers and
 * the modal is the thing that knows what it collected. Money is submitted as
 * the user typed it - `1,234.56`, `$85` - and `parseMoney` runs once, on the
 * server, inside the action's schema (ADR 0007).
 *
 * Validation failure comes back as a value, not an exception, so the messages
 * land next to the fields and nothing the user typed is lost.
 */

export type QuickAddTab = 'project' | 'expense' | 'labor' | 'invoice';

interface QuickAddModalProps {
  initialTab?: QuickAddTab;
  initialProjectId?: string;
  projects: Project[];
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fired after a successful write. Server-rendered pages need nothing here -
   * the action revalidates them - so this exists only for the pages that still
   * fetch their own data.
   */
  onCreated?: () => void;
}

/** The message against one field, if the server had one. */
function FieldError({ errors, field }: { errors: FieldErrors; field: string }) {
  const message = errors[field]?.[0];
  if (!message) return null;
  return (
    <div role="alert" style={{ fontSize: '0.7rem', color: 'var(--severity-critical)', marginTop: '0.2rem' }}>
      {message}
    </div>
  );
}

export function QuickAddModal({
  initialTab = 'expense',
  initialProjectId,
  projects,
  isOpen,
  onClose,
  onCreated,
}: QuickAddModalProps) {
  const [activeTab, setActiveTab] = useState<QuickAddTab>(initialTab);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
  const [projPricingType] = useState<PricingType>('fixed');
  const [projQuotedTotal, setProjQuotedTotal] = useState('4500');
  const [projQuotedMaterials, setProjQuotedMaterials] = useState('1500');
  const [projQuotedHours, setProjQuotedHours] = useState('32');

  // Expense Form State
  const [expProjectId, setExpProjectId] = useState(initialProjectId || '');
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
  const [invNumber, setInvNumber] = useState('');
  const [invAmount, setInvAmount] = useState('2500');
  const [invDeposit, setInvDeposit] = useState('1000');
  const [invDueDate, setInvDueDate] = useState(
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  );

  if (!isOpen) return null;

  /**
   * One submit path for all four tabs: clear the last complaint, run the
   * action, and either close or show what was wrong. `useTransition` keeps the
   * form interactive while the server works and marks it pending.
   */
  const submit = <T,>(
    event: React.FormEvent,
    action: (input: unknown) => Promise<ActionResult<T>>,
    payload: unknown
  ) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(payload);
      if (result.ok) {
        onCreated?.();
        onClose();
        return;
      }
      setFormError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    });
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
            aria-label="Close"
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
          {(
            [
              ['expense', 'Receipt', Receipt, 'var(--accent-cyan)'],
              ['labor', 'Labor', Clock, 'var(--accent-indigo)'],
              ['project', 'Project', Hammer, '#ffffff'],
              ['invoice', 'Invoice', FileText, 'var(--severity-healthy)'],
            ] as const
          ).map(([tab, label, Icon, activeColor]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-pressed={activeTab === tab}
              style={{
                padding: '0.45rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: activeTab === tab ? 700 : 500,
                background: activeTab === tab ? 'var(--bg-card)' : 'transparent',
                color: activeTab === tab ? activeColor : 'var(--text-secondary)',
                border: activeTab === tab ? '1px solid var(--border-strong)' : 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
              }}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {formError && (
          <div
            role="alert"
            style={{
              marginBottom: '0.85rem',
              padding: '0.5rem 0.65rem',
              borderRadius: '4px',
              fontSize: '0.78rem',
              color: 'var(--severity-critical)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            {formError}
          </div>
        )}

        {/* Tab 1: Expense / Receipt */}
        {activeTab === 'expense' && (
          <form
            onSubmit={(e) =>
              submit(e, createTransactionAction, {
                projectId: expProjectId,
                vendor: expVendor,
                description: expDesc,
                amount: expAmount,
                category: expCategory,
                date: expDate,
                paymentMethod: 'card',
              })
            }
            style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
          >
            <div>
              <label className="swiss-label" htmlFor="exp-project">Link to Project / Job</label>
              <select
                id="exp-project"
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
                <label className="swiss-label" htmlFor="exp-vendor">Vendor</label>
                <input
                  id="exp-vendor"
                  type="text"
                  value={expVendor}
                  onChange={(e) => setExpVendor(e.target.value)}
                  placeholder="The Home Depot, Lowe's, Shell"
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="vendor" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="exp-amount">Amount ($)</label>
                <input
                  id="exp-amount"
                  type="text"
                  inputMode="decimal"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder="145.50"
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="amount" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label" htmlFor="exp-category">Expense Category</label>
                <select
                  id="exp-category"
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                >
                  <option value="materials">Materials &amp; Supplies</option>
                  <option value="tools">Tools &amp; Equipment</option>
                  <option value="mileage_fuel">Fuel &amp; Van Transit</option>
                  <option value="permits_fees">Permits &amp; Dump Fees</option>
                  <option value="subcontractor">Subcontractor</option>
                  <option value="overhead">Overhead / Office</option>
                </select>
              </div>

              <div>
                <label className="swiss-label" htmlFor="exp-date">Purchase Date</label>
                <input
                  id="exp-date"
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
              </div>
            </div>

            <div>
              <label className="swiss-label" htmlFor="exp-desc">Description / Receipt Notes</label>
              <input
                id="exp-desc"
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
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? 'Saving...' : 'Record Expense'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Labor Hours */}
        {activeTab === 'labor' && (
          <form
            onSubmit={(e) =>
              submit(e, createLaborEntryAction, {
                projectId: labProjectId,
                date: labDate,
                hours: labHours,
                hourlyRate: labRate,
                workerName: 'Mike (Lead)',
                notes: labNotes,
              })
            }
            style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
          >
            <div>
              <label className="swiss-label" htmlFor="lab-project">Project / Job</label>
              <select
                id="lab-project"
                value={labProjectId}
                onChange={(e) => setLabProjectId(e.target.value)}
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              >
                <option value="">Select a job...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <FieldError errors={fieldErrors} field="projectId" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label" htmlFor="lab-hours">Hours Worked</label>
                <input
                  id="lab-hours"
                  type="text"
                  inputMode="decimal"
                  value={labHours}
                  onChange={(e) => setLabHours(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="hours" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="lab-rate">Billable Rate ($/hr)</label>
                <input
                  id="lab-rate"
                  type="text"
                  inputMode="decimal"
                  value={labRate}
                  onChange={(e) => setLabRate(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="hourlyRate" />
              </div>
            </div>

            <div>
              <label className="swiss-label" htmlFor="lab-date">Work Date</label>
              <input
                id="lab-date"
                type="date"
                value={labDate}
                onChange={(e) => setLabDate(e.target.value)}
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div>
              <label className="swiss-label" htmlFor="lab-notes">Tasks Performed</label>
              <input
                id="lab-notes"
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
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? 'Saving...' : 'Log Labor Hours'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: New Project */}
        {activeTab === 'project' && (
          <form
            onSubmit={(e) =>
              submit(e, createProjectAction, {
                name: projName,
                clientName: projClient,
                clientPhone: projPhone,
                clientAddress: projAddress,
                description: projDesc,
                pricingType: projPricingType,
                quotedTotal: projQuotedTotal,
                quotedMaterials: projQuotedMaterials,
                quotedLaborHours: projQuotedHours,
              })
            }
            style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
          >
            <div>
              <label className="swiss-label" htmlFor="proj-name">Project Name</label>
              <input
                id="proj-name"
                type="text"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                placeholder="e.g. Master Bath Tile & Vanity Remodel"
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              />
              <FieldError errors={fieldErrors} field="name" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label" htmlFor="proj-client">Client Name</label>
                <input
                  id="proj-client"
                  type="text"
                  value={projClient}
                  onChange={(e) => setProjClient(e.target.value)}
                  placeholder="John & Lisa Smith"
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="clientName" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="proj-phone">Client Phone</label>
                <input
                  id="proj-phone"
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
              <label className="swiss-label" htmlFor="proj-address">Job Site Address</label>
              <input
                id="proj-address"
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
                <label className="swiss-label" htmlFor="proj-total">Quoted Price ($)</label>
                <input
                  id="proj-total"
                  type="text"
                  inputMode="decimal"
                  value={projQuotedTotal}
                  onChange={(e) => setProjQuotedTotal(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="quotedTotal" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="proj-materials">Est. Materials ($)</label>
                <input
                  id="proj-materials"
                  type="text"
                  inputMode="decimal"
                  value={projQuotedMaterials}
                  onChange={(e) => setProjQuotedMaterials(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="quotedMaterials" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="proj-hours">Est. Hours</label>
                <input
                  id="proj-hours"
                  type="text"
                  inputMode="decimal"
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
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 4: Invoice */}
        {activeTab === 'invoice' && (
          <form
            onSubmit={(e) =>
              submit(e, createInvoiceAction, {
                projectId: invProjectId,
                invoiceNumber: invNumber,
                amount: invAmount,
                depositAmount: invDeposit,
                dueDate: invDueDate,
              })
            }
            style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
          >
            <div>
              <label className="swiss-label" htmlFor="inv-project">Project / Client</label>
              <select
                id="inv-project"
                value={invProjectId}
                onChange={(e) => setInvProjectId(e.target.value)}
                className="form-input"
                style={{ marginTop: '0.25rem' }}
              >
                <option value="">Select a job...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.clientName})
                  </option>
                ))}
              </select>
              <FieldError errors={fieldErrors} field="projectId" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label" htmlFor="inv-number">Invoice Number</label>
                <input
                  id="inv-number"
                  type="text"
                  value={invNumber}
                  onChange={(e) => setInvNumber(e.target.value)}
                  placeholder="INV-2026-045"
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="invoiceNumber" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="inv-amount">Total Amount ($)</label>
                <input
                  id="inv-amount"
                  type="text"
                  inputMode="decimal"
                  value={invAmount}
                  onChange={(e) => setInvAmount(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="amount" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="swiss-label" htmlFor="inv-deposit">Deposit Requested ($)</label>
                <input
                  id="inv-deposit"
                  type="text"
                  inputMode="decimal"
                  value={invDeposit}
                  onChange={(e) => setInvDeposit(e.target.value)}
                  className="form-input"
                  style={{ marginTop: '0.25rem' }}
                />
                <FieldError errors={fieldErrors} field="depositAmount" />
              </div>

              <div>
                <label className="swiss-label" htmlFor="inv-due">Due Date</label>
                <input
                  id="inv-due"
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
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? 'Issuing...' : 'Issue Invoice'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
