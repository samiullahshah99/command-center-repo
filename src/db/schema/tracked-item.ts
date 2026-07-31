import { sql } from 'drizzle-orm';
import { boolean, check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';

// Closed set — a captured item comes from exactly one of these origins and this
// list is not expected to change. Worth a real Postgres enum.
export const sourceTypeEnum = pgEnum('source_type', ['meeting', 'slack', 'manual', 'system']);

/**
 * Which system owns this item's CONTENT.
 *
 * ClickUp is explicitly TEMPORARY (lead's direction: in-platform brief creation
 * and studio stats APIs are expected to replace it), while PRD §3.2 keeps it as
 * system of record for now and §5.1 still requires meeting action items to sync
 * INTO it. This column lets both be true at once, so the swap is a data change
 * rather than a migration.
 */
export const TASK_SOURCE_SYSTEMS = ['clickup', 'internal'] as const;

export type TaskSourceSystem = (typeof TASK_SOURCE_SYSTEMS)[number];

export const sourceSystemEnum = pgEnum('source_system', TASK_SOURCE_SYSTEMS);

/**
 * A commitment we are tracking.
 *
 * ⚠️ ARCHITECTURAL RULE — depends on `source_system`:
 *
 *   'clickup'  ClickUp is the system of record. This row holds a REFERENCE
 *              (`clickup_task_id`) plus OUR OWN intelligence state, and the
 *              content columns (title, description) MUST stay NULL. Task detail
 *              is read through to the ClickUp API at request time.
 *
 *   'internal' Command Center owns the content. `clickup_task_id` is NULL and
 *              the content columns are populated here.
 *
 * The rule is enforced by the CHECK constraint below, not by convention, because
 * ClickUp is expected to be replaced and a cached title that drifts is exactly
 * what makes that replacement painful.
 *
 * `status` is OUR lifecycle state under BOTH source systems, and is not the same
 * thing as the source system's own status.
 */
export const trackedItem = pgTable(
  'tracked_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Which system owns the content of this item.
    sourceSystem: sourceSystemEnum('source_system').notNull().default('clickup'),

    // The reference into ClickUp. NULL when source_system = 'internal', because
    // there is no ClickUp task to point at.
    clickupTaskId: text('clickup_task_id'),

    // ── Content columns: populated ONLY when source_system = 'internal' ───────
    // For 'clickup' rows these stay NULL and the CHECK constraint enforces it.
    title: text('title'),
    description: text('description'),

    // Who is actually doing the work, per the source system. Distinct from
    // owner_person_id, which is who Command Center holds accountable — usually the
    // same person, but a lead can own an item an editor is executing.
    assigneePersonId: uuid('assignee_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),

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
  },
  (table) => [
    // Makes the system-of-record rule structural instead of a comment. A future
    // refactor cannot quietly start caching ClickUp titles.
    check(
      'tracked_item_content_by_source_ck',
      sql`${table.sourceSystem} <> 'clickup' OR (${table.title} IS NULL AND ${table.description} IS NULL)`
    )
  ]
);

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
