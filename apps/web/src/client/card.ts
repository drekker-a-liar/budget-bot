import { subtractCents, type CardProfile, type Cents } from '@budget-bot/core';

/**
 * How much of the card's limit is left to draw on, or null when no card has
 * been linked. Two pages ask, and a default figure standing in for "we do not
 * know yet" is exactly the kind of number that gets believed.
 */
export function availableCreditOf(cardProfile: CardProfile | null): Cents | null {
  if (!cardProfile) return null;
  return subtractCents(cardProfile.creditLimitCents, cardProfile.currentBalanceCents);
}
