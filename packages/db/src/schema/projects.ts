import { date, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { cents, createdAt, ownerId, updatedAt } from './columns';
import { pricingType, projectStatus } from './enums';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text('name').notNull(),
    clientName: text('client_name').notNull(),
    clientPhone: text('client_phone').notNull().default(''),
    clientAddress: text('client_address').notNull().default(''),
    description: text('description').notNull().default(''),
    status: projectStatus('status').notNull(),
    pricingType: pricingType('pricing_type').notNull(),
    quotedTotalCents: cents('quoted_total_cents').notNull(),
    quotedMaterialsCents: cents('quoted_materials_cents').notNull(),
    quotedLaborHours: numeric('quoted_labor_hours', {
      precision: 8,
      scale: 2,
      mode: 'number',
    }).notNull(),
    targetHourlyRateCents: cents('target_hourly_rate_cents').notNull(),
    targetMarginPct: numeric('target_margin_pct', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }).notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    deadlineDate: date('deadline_date', { mode: 'string' }),
    completedDate: date('completed_date', { mode: 'string' }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('projects_owner_created_idx').on(table.ownerId, table.createdAt),
    index('projects_owner_status_idx').on(table.ownerId, table.status),
  ]
);
