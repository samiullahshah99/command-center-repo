import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

// A role profile defines what "doing this job well" looks like: which signals we
// watch for someone in this role, their quota expectations, and which channels
// their work shows up in.
export const roleProfile = pgTable('role_profile', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: text('name').notNull(),

  // Signals to monitor for this role, e.g. ['returns_acknowledged', 'qa_review'].
  // JSONB rather than a join table: the shape is still moving, and we never
  // query across profiles by individual signal.
  trackedSignals: jsonb('tracked_signals').notNull().default([]),

  // Expected volumes / cadences, shape TBD as the Control Tower work lands.
  quotaConfig: jsonb('quota_config').notNull().default({}),

  // Slack channel ids (and later other sources) this role's work appears in.
  sourceChannels: jsonb('source_channels').notNull().default([]),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export type RoleProfile = typeof roleProfile.$inferSelect;
export type NewRoleProfile = typeof roleProfile.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// Columns are derived from the table by drizzle-zod so they cannot drift. Only
// the things Drizzle cannot express — JSONB shapes — are hand-written.

// NOTE: these three columns have Postgres defaults, so they must stay optional
// on INSERT. Overriding a defaulted column with a bare schema silently makes it
// required — add .optional() or every insert has to pass them explicitly.
export const insertRoleProfileSchema = createInsertSchema(roleProfile, {
  name: (s) => s.min(1, 'Name is required'),
  trackedSignals: z.array(z.string()).optional(),
  quotaConfig: z.record(z.string(), z.unknown()).optional(),
  sourceChannels: z.array(z.string()).optional()
});

export const selectRoleProfileSchema = createSelectSchema(roleProfile, {
  trackedSignals: z.array(z.string()),
  quotaConfig: z.record(z.string(), z.unknown()),
  sourceChannels: z.array(z.string())
});
