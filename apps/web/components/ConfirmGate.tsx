'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The type-to-confirm gate behind every destructive control in this app
 * (spec §6): disconnecting a bank, and deleting everything.
 *
 * It owns exactly one thing - whether the confirmation input is open and
 * whether what is typed in it matches - and hands the actual call back to the
 * caller as `onConfirm`. `busy` and `error` are the caller's own state rather
 * than this component's, because *why* a call is pending or what it says when
 * it is refused differs by what is being confirmed: `disconnectConnectionAction`
 * answers with a sentence about a connection, `deleteAllDataAction` about an
 * account, and neither belongs to a component that does not know which one
 * is calling it.
 *
 * `DisconnectButton` and `DangerZone` are both this component, parameterised.
 */

export interface ConfirmGateProps {
  /** The word or phrase that has to be typed, case-insensitively, to confirm. */
  phrase: string;
  /** Unique per gate on a page, so more than one can render without clashing input ids. */
  idSuffix: string;
  /** The button shown before the gate opens. */
  idleLabel: string;
  idleIcon?: React.ReactNode;
  /** The confirm button's label once the phrase matches. */
  confirmLabel: string;
  confirmIcon?: React.ReactNode;
  /** Shown on the confirm button, and disables the whole gate, while a call is in flight. */
  busyLabel: string;
  busy: boolean;
  /** A refusal from the caller's own call, shown as an alert. */
  error: string | null;
  onConfirm: () => void;
  /** Called in addition to the gate's own reset, so the caller can clear its error too. */
  onCancel?: () => void;
}

export function ConfirmGate({
  phrase,
  idSuffix,
  idleLabel,
  idleIcon,
  confirmLabel,
  confirmIcon,
  busyLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmGateProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const confirmed = typed.trim().toLowerCase() === phrase.toLowerCase();

  const cancel = () => {
    setOpen(false);
    setTyped('');
    onCancel?.();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary"
        style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}
      >
        {idleIcon}
        <span>{idleLabel}</span>
      </button>
    );
  }

  const inputId = `confirm-gate-${idSuffix}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <label htmlFor={inputId} style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          Type “{phrase}” to confirm
        </label>
        <input
          id={inputId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={busy}
          className="form-input"
          style={{ minWidth: '9rem', padding: '0.35rem 0.5rem', fontSize: '0.78rem' }}
        />
        <button
          onClick={onConfirm}
          disabled={!confirmed || busy}
          className="btn-secondary"
          style={{
            padding: '0.4rem 0.75rem',
            fontSize: '0.78rem',
            color: confirmed ? 'var(--severity-critical)' : undefined,
            borderColor: confirmed ? 'var(--severity-critical)' : undefined,
          }}
        >
          {busy ? <Loader2 size={13} /> : confirmIcon}
          <span>{busy ? busyLabel : confirmLabel}</span>
        </button>
        <button onClick={cancel} disabled={busy} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
          Cancel
        </button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--severity-critical)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
