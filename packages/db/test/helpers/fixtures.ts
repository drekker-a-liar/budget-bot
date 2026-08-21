import { parseMoney } from '@budget-bot/core';
import type { NewProject } from '../../src/repos/projects';

/** A minimal, valid project for tests that need something to hang rows off. */
export const newProject = (overrides: Partial<NewProject> = {}): NewProject => ({
  name: 'Cedar Deck Reconstruction',
  clientName: 'Robert Henderson',
  clientPhone: '(555) 876-5432',
  clientAddress: '1204 Pine Valley Way',
  description: 'Tear out and rebuild a 16x20 deck.',
  status: 'in_progress',
  pricingType: 'fixed',
  quotedTotalCents: parseMoney('4500.00'),
  quotedMaterialsCents: parseMoney('1750.00'),
  quotedLaborHours: 32,
  targetHourlyRateCents: parseMoney('85.00'),
  targetMarginPct: 45,
  startDate: '2026-08-02',
  deadlineDate: '2026-08-12',
  ...overrides,
});
