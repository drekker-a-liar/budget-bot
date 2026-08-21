import type { CardProfile } from '@budget-bot/core';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { bankAccounts, bankConnections } from '../schema';
import { toIso } from './rows';

/**
 * The card the dashboard shows. `CardProfile` is the prototype's shape - one
 * card, flat - while the tables model many accounts behind many connections.
 * Until the card UI is rebuilt, the profile is synthesised from the first
 * enabled account: a view over the real tables rather than a second copy of
 * the data that could disagree with them.
 */

export type CardProfileUpdate = Partial<Omit<CardProfile, 'id'>>;

interface CardRow {
  id: string;
  cardName: string | null;
  name: string | null;
  mask: string | null;
  type: string | null;
  currentBalanceCents: number | null;
  limitCents: number | null;
  cycleResetDay: number | null;
  balancesUpdatedAt: Date | null;
  updatedAt: Date;
  institutionName: string | null;
}

function toCardProfile(row: CardRow): CardProfile {
  return {
    id: row.id,
    cardName: row.cardName ?? row.name ?? '',
    issuer: row.institutionName ?? '',
    last4: row.mask ?? '',
    // Plaid's account types are broader than the two the card UI knows about;
    // anything that is not a credit line spends like a debit card.
    cardType: row.type === 'credit' ? 'credit' : 'debit',
    currentBalanceCents: (row.currentBalanceCents ?? 0) as CardProfile['currentBalanceCents'],
    creditLimitCents: (row.limitCents ?? 0) as CardProfile['creditLimitCents'],
    cycleResetDay: row.cycleResetDay ?? 1,
    lastSyncedAt: toIso(row.balancesUpdatedAt ?? row.updatedAt),
  };
}

async function firstEnabledAccount(
  db: Database,
  ownerId: string
): Promise<CardRow | undefined> {
  const [row] = await db
    .select({
      id: bankAccounts.id,
      cardName: bankAccounts.cardName,
      name: bankAccounts.name,
      mask: bankAccounts.mask,
      type: bankAccounts.type,
      currentBalanceCents: bankAccounts.currentBalanceCents,
      limitCents: bankAccounts.limitCents,
      cycleResetDay: bankAccounts.cycleResetDay,
      balancesUpdatedAt: bankAccounts.balancesUpdatedAt,
      updatedAt: bankAccounts.updatedAt,
      institutionName: bankConnections.institutionName,
    })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankAccounts.connectionId, bankConnections.id))
    .where(and(eq(bankAccounts.ownerId, ownerId), eq(bankAccounts.isEnabled, true)))
    .orderBy(asc(bankAccounts.createdAt), asc(bankAccounts.id))
    .limit(1);
  return row;
}

/** Null when the owner has not linked an account yet. */
export async function getCardProfile(
  db: Database,
  ownerId: string
): Promise<CardProfile | null> {
  const row = await firstEnabledAccount(db, ownerId);
  return row ? toCardProfile(row) : null;
}

/**
 * Writes back only the fields the card screen actually lets a user change.
 * Balances and the mask come from the provider and are not editable here.
 */
export async function updateCardProfile(
  db: Database,
  ownerId: string,
  updates: CardProfileUpdate
): Promise<CardProfile | null> {
  const existing = await firstEnabledAccount(db, ownerId);
  if (!existing) return null;

  await db
    .update(bankAccounts)
    .set({
      ...(updates.cardName !== undefined && { cardName: updates.cardName }),
      ...(updates.cycleResetDay !== undefined && { cycleResetDay: updates.cycleResetDay }),
      updatedAt: new Date(),
    })
    .where(and(eq(bankAccounts.ownerId, ownerId), eq(bankAccounts.id, existing.id)));

  return getCardProfile(db, ownerId);
}
