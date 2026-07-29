import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { recurringTask } from './recurring-task';

// An append-only record that a recurring task was satisfied on a given occasion,
// together with what proved it. This is the audit trail behind auto-completion —
// never update or delete rows here, insert a new one.
export const completionEvent = pgTable('completion_event', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Required. onDelete: 'cascade' — completion history is meaningless without
  // the task it belongs to.
  recurringTaskId: uuid('recurring_task_id')
    .notNull()
    .references(() => recurringTask.id, { onDelete: 'cascade' }),

  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),

  // What proved completion, e.g. 'portal' | 'slack' | 'manual'. Nullable
  // together with evidence_ref: a fallback_manual completion has a human behind
  // it rather than a machine signal.
  evidenceSource: text('evidence_source'),

  // Pointer to the proof: an event id, Slack message ts, portal record id.
  evidenceRef: text('evidence_ref'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export type CompletionEvent = typeof completionEvent.$inferSelect;
export type NewCompletionEvent = typeof completionEvent.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const EVIDENCE_SOURCES = ['portal', 'slack', 'clickup', 'manual'] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const insertCompletionEventSchema = createInsertSchema(completionEvent, {
  evidenceSource: z.enum(EVIDENCE_SOURCES).nullable().optional()
});

export const selectCompletionEventSchema = createSelectSchema(completionEvent, {
  evidenceSource: z.enum(EVIDENCE_SOURCES).nullable()
});
