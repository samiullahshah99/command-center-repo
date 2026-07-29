import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';

// A recurring obligation, e.g. "acknowledge returns awaiting review, daily".
// Completion is normally inferred from an inbound event signal rather than being
// ticked off by hand — see auto_complete_rule.
export const recurringTask = pgTable('recurring_task', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Required: a recurring task without an owner cannot be monitored.
  // onDelete: 'cascade' — if the person is removed, their recurring obligations
  // go with them.
  ownerPersonId: uuid('owner_person_id')
    .notNull()
    .references(() => person.id, { onDelete: 'cascade' }),

  // Allowed: daily | weekly | biweekly | monthly | quarterly.
  // text + Zod rather than a Postgres enum, for the same churn reason as
  // tracked_item.status.
  cadence: text('cadence').notNull(),

  // The event signal that counts as completion, e.g.
  //   { source: 'portal', event: 'returns_acknowledged', within: '24h' }
  // JSONB because the rule shape is still being designed.
  autoCompleteRule: jsonb('auto_complete_rule').notNull().default({}),

  // When true, a human may mark this complete if no signal arrives.
  fallbackManual: boolean('fallback_manual').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export type RecurringTask = typeof recurringTask.$inferSelect;
export type NewRecurringTask = typeof recurringTask.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'] as const;

export type Cadence = (typeof CADENCES)[number];

// The completion signal to watch for. Loose on purpose while the rule shape is
// still being designed — tighten once the first real monitor exists.
export const autoCompleteRuleSchema = z.object({
  source: z.string().optional(),
  event: z.string().optional(),
  within: z.string().optional()
});

// autoCompleteRule has a Postgres default ({}), so it stays optional on INSERT.
// cadence has no default and is genuinely required.
export const insertRecurringTaskSchema = createInsertSchema(recurringTask, {
  cadence: z.enum(CADENCES),
  autoCompleteRule: autoCompleteRuleSchema.optional()
});

export const selectRecurringTaskSchema = createSelectSchema(recurringTask, {
  cadence: z.enum(CADENCES),
  autoCompleteRule: autoCompleteRuleSchema
});
