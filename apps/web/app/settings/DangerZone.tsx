'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { ConfirmGate } from '@/components/ConfirmGate';
import { deleteAllDataAction } from '@/src/server/actions/account';

/**
 * Export and delete-all (spec §6) - the privacy essentials for software
 * holding somebody's financial records: a way to take a copy of everything,
 * and a way to make everything go away.
 *
 * Export is a plain link. `/api/export` is a GET behind the same session
 * check every route in this app has, and a browser already knows how to save
 * whatever a `Content-Disposition: attachment` answers with - there is
 * nothing here for a click handler to do.
 *
 * Delete-all sits behind `ConfirmGate`, the same type-to-confirm pattern
 * `DisconnectButton` uses, with a longer phrase for a wider blast radius:
 * disconnecting loses a link to a bank, this loses everything the owner has
 * ever entered or synced. There is no confirmation screen after this one -
 * the button that runs it is the last chance to back out.
 */

const CONFIRM_PHRASE = 'delete everything';

/** Something went wrong that this component cannot describe. */
const UNREACHABLE = 'Something went wrong connecting to the server. Try again.';

export function DangerZone() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteEverything = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await deleteAllDataAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      // Same gap every action-calling island guards against: a rejected
      // promise rather than a refused result, which without this `catch`
      // leaves the button reading "Deleting…" for the rest of the session.
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="swiss-card"
      style={{
        marginTop: '2rem',
        border: '1px solid var(--severity-critical)',
      }}
    >
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <AlertTriangle size={16} color="var(--severity-critical)" />
        <div>
          <div style={{ fontWeight: 700, color: '#f8fafc' }}>Danger zone</div>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Take a copy of everything, or make everything go away.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="/api/export" className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
          <Download size={13} />
          <span>Export my data</span>
        </a>

        <ConfirmGate
          phrase={CONFIRM_PHRASE}
          idSuffix="delete-all"
          idleLabel="Delete all my data"
          idleIcon={<Trash2 size={13} />}
          confirmLabel="Delete all my data"
          confirmIcon={<Trash2 size={13} />}
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onConfirm={() => void deleteEverything()}
          onCancel={() => setError(null)}
        />
      </div>
    </div>
  );
}
