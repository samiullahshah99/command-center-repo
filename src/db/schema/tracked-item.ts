import { boolean, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';

// Closed set — a captured item comes from exactly one of these origins and this
// list is not expected to change. Worth a real Postgres enum.
export const sourceTypeEnum = pgEnum('source_type', ['meeting', 'slack', 'manual', 'system']);

/**
 * A commitment we are tracking.
 *
 * ⚠️ ARCHITECTURAL RULE — ClickUp is the authoritative system of record for
 * tasks. This table stores a REFERENCE (`clickup_task_id`) plus OUR OWN
 * intelligence state. It must NOT duplicate ClickUp task data: no title,
 * description, assignee name, comments, priority, or ClickUp status. Mirroring
 * those guarantees drift, and there is no reconciliation story.
 *
 * If a view needs task detail, read it from the ClickUp API at request time.
 *
 * `status` here is OUR lifecycle state for the tracked item, which is not the
 * same thing as the ClickUp task's status.
 */
export const trackedItem = pgTable('tracked_item', {
  id: uuid('id').primaryKey().defaultRandom(),

  // The reference into the system of record.
  clickupTaskId: text('clickup_task_id').notNull(),

  // Nullable: an item can be captured from a meeting before we have resolved who
  // owns it. onDelete: 'set null' keeps the item when a person record goes away.
  ownerPersonId: uuid('owner_person_id').references(() => person.id, {
    onDelete: 'set null'
  }),

  sourceType: sourceTypeEnum('source_type').notNull(),

  // Pointer back to where this came from: a Slack message ts, a transcript id,
  // etc. Nullable because 'manual' capture has no external reference.
  sourceRef: text('source_ref'),

  dueDate: timestamp('due_date', { withTimezone: true }),

  // OUR lifecycle state, validated by Zod rather than a Postgres enum — these
  // values will churn as the product settles, and ALTER TYPE migrations are a
  // poor trade for that. Allowed: open | in_progress | blocked | done | cancelled
  status: text('status').notNull().default('open'),

  // When we last saw movement on this item, used for staleness detection.
  lastUpdateAt: timestamp('last_update_at', { withTimezone: true }),

  riskFlag: boolean('risk_flag').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export type TrackedItem = typeof trackedItem.$inferSelect;
export type NewTrackedItem = typeof trackedItem.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// `status` is text in Postgres by design (see above), so Zod is the single
// source of allowed values. Adding one here needs no migration.

export const TRACKED_ITEM_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled'
] as const;

export type TrackedItemStatus = (typeof TRACKED_ITEM_STATUSES)[number];

// status has a Postgres default ('open'), so it stays optional on INSERT.
export const insertTrackedItemSchema = createInsertSchema(trackedItem, {
  clickupTaskId: (s) => s.min(1, 'A ClickUp task id is required'),
  status: z.enum(TRACKED_ITEM_STATUSES).optional()
});

export const selectTrackedItemSchema = createSelectSchema(trackedItem, {
  status: z.enum(TRACKED_ITEM_STATUSES)
});
