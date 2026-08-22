'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ExpenseCategory } from '@budget-bot/core';
import {
  assignTransactionAction,
  deleteTransactionAction,
  updateTransactionCategoryAction,
} from '@/src/server/actions/transactions';
import type { ActionResult } from '@/src/server/actions/result';

/**
 * The inbox's four writes, wired to the server actions.
 *
 * Two pages render `TransactionInbox` - the dashboard and the ledger - and
 * both need exactly these handlers, so they live here rather than being
 * written twice and drifting apart.
 *
 * `useTransition` keeps the table interactive while the server works: the row
 * the user just filed stays on screen until the server component re-renders
 * with it filed, rather than the whole page blanking.
 *
 * The CSV upload is a `fetch` rather than an action because the route is the
 * one thing here that takes a file (spec §6); `router.refresh()` is what an
 * action's `revalidatePath` would have done. It posts the file's text as a
 * raw `text/csv` body - the browser computes `Content-Length` for a string
 * body on its own, so nothing here needs to.
 */

export interface TransactionInboxActions {
  onAssignProject: (transactionId: string, projectId: string) => void;
  onUpdateCategory: (transactionId: string, category: ExpenseCategory) => void;
  onDeleteTransaction: (transactionId: string) => void;
  onImportCsv: (text: string) => void;
  /** What went wrong with the last write, for the page to show. */
  error: string | null;
  pending: boolean;
}

export function useTransactionInboxActions(): TransactionInboxActions {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (write: () => Promise<ActionResult<unknown>>) => {
    setError(null);
    startTransition(async () => {
      const result = await write();
      if (!result.ok) setError(result.error);
    });
  };

  return {
    pending,
    error,
    onAssignProject: (id, projectId) => run(() => assignTransactionAction({ id, projectId })),
    onUpdateCategory: (id, category) =>
      run(() => updateTransactionCategoryAction({ id, category })),
    onDeleteTransaction: (id) => run(() => deleteTransactionAction({ id })),
    onImportCsv: (text) => {
      setError(null);
      startTransition(async () => {
        const response = await fetch('/api/import/csv', {
          method: 'POST',
          headers: { 'content-type': 'text/csv' },
          body: text,
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error ?? 'That file could not be imported.');
          return;
        }
        if (result.skipped > 0) {
          // `skipped` can now exceed `errors.length` (spec §7): a row that
          // parsed fine is still skipped when it repeats an earlier import,
          // and that has no line or reason to report - only a parse failure
          // does. `first` is undefined exactly in the all-duplicates case.
          const [first] = result.errors as Array<{ line: number; reason: string }>;
          setError(
            first
              ? `Imported ${result.inserted}, skipped ${result.skipped}. Line ${first.line}: ${first.reason}`
              : `Imported ${result.inserted}, skipped ${result.skipped} - already imported.`
          );
        }
        router.refresh();
      });
    },
  };
}
