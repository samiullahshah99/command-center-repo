import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { candidateActionItem } from './candidate-action-item';
import { EXTERNAL_SYSTEMS } from './external-system';
import { person } from './person';
import { project } from './project';

// Closed set — a captured item comes from exactly one of these origins and this
// list is not expected to change. Worth a real Postgres enum.
export const sourceTypeEnum = pgEnum('source_type', ['meeting', 'slack', 'manual', 'system']);

/**
 * Which system owns this item's CONTENT.
 *
 * ⚠️ THE COMMAND CENTRE IS THE TASK SYSTEM OF RECORD (amendment 2026-08-04,
 * docs/prd-amendments.md). Approved action items are native rows here with
 * `source_system='internal'`, and NO EXTERNAL TASK TOOL IS WRITTEN TO.
 *
 * ClickUp remains a READ-ONLY, transitional source of content-team events, and
 * its content columns stay NULL — a `'clickup'` row is a reference plus our own
 * intelligence state, never a mirrored title. This column is what lets a
 * mirrored row and a native row coexist in one table.
 *
 * ── Superseded, for anyone reading an older diff ─────────────────────────────
 * This header used to say PRD §3.2 keeps ClickUp as system of record and §5.1
 * requires meeting action items to sync INTO it. **Both are superseded.** The
 * later claim that "Notion is now the mandated task destination" is superseded
 * too — that position was never built. The CHECK constraints below were always
 * correct; only this prose was stale.
 */
/**
 * ⚠️ Was a pgEnum of ('clickup','internal'); now TEXT + CHECK over the shared
 * EXTERNAL_SYSTEMS list. The enum made adding a value an ALTER TYPE, which
 * cannot run inside a transaction and whose values can never be removed.
 * Converted while the table was empty, so the change cost nothing. Same
 * reasoning as `status` below and `project.status`.
 */
export const TASK_SOURCE_SYSTEMS = EXTERNAL_SYSTEMS;

export type TaskSourceSystem = (typeof TASK_SOURCE_SYSTEMS)[number];

/**
 * A commitment we are tracking.
 *
 * ⚠️ ARCHITECTURAL RULE — depends on `source_system`:
 *
 *   'internal' Command Center owns the content. `external_task_id` is NULL and
 *              the content columns (title, description) are populated here.
 *
 *   'clickup'  } The source system owns the content. This row holds a REFERENCE
 *   'notion'   } (`external_task_id`) plus OUR OWN intelligence state, and the
 *              content columns MUST stay NULL — detail is read through to that
 *              system at request time.
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
    sourceSystem: text('source_system').notNull().default('internal'),

    /**
     * The id of this item IN ITS SOURCE SYSTEM. NULL for 'internal' rows,
     * because Command Center owns them and there is nothing to point at.
     *
     * ⚠️ Renamed from `clickup_task_id`. Vendor-neutral naming per CLAUDE.md —
     * a column named after one vendor is a migration, a backfill and a rename
     * across every query the day the vendor changes, and the vendor already
     * changed once mid-project. Verified safe: nothing wrote the old column
     * (the table was empty and had no writers outside its own schema file).
     */
    externalTaskId: text('external_task_id'),

    // ── Content columns: populated ONLY when source_system = 'internal' ───────
    // Every other source keeps these NULL; tracked_item_content_by_source_ck
    // enforces it as an ALLOW-list, so a new source system is excluded by
    // default rather than needing to be remembered.
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

    /** The tracker board's grouping. Nullable: an item can exist unfiled. */
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),

    /**
     * The reviewed candidate this item was promoted FROM, when it came from one.
     *
     * Carries provenance the board needs — chiefly the owner_confidence that was
     * accepted, so a row promoted from a 'fuzzy' or 'unresolved' guess can be
     * marked as such rather than presenting a reviewed guess as settled fact.
     * Also the path Day 4's review-queue promotion writes.
     *
     * onDelete: 'set null' — the tracked item outlives its candidate.
     */
    candidateActionItemId: uuid('candidate_action_item_id').references(
      () => candidateActionItem.id,
      { onDelete: 'set null' }
    ),

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
    index('tracked_item_project_idx').on(table.projectId),

    /**
     * ⚠️ ONE tracked_item per candidate. PARTIAL — most tracked items have no
     * candidate, and NULLs are distinct in a unique index anyway.
     *
     * The promotion path already guards with SELECT ... FOR UPDATE plus a
     * pending-status check, which is what produces a good error message on a
     * double-click. This index is the BACKSTOP: procedural guards live in one
     * code path and the next caller has to remember them, while a constraint
     * cannot be forgotten. Structural over procedural, as everywhere else here.
     */
    uniqueIndex('tracked_item_candidate_key')
      .on(table.candidateActionItemId)
      .where(sql`${table.candidateActionItemId} IS NOT NULL`),
    index('tracked_item_owner_idx').on(table.ownerPersonId),
    index('tracked_item_status_idx').on(table.status),

    check(
      'tracked_item_source_system_ck',
      sql`${table.sourceSystem} IN ('internal','notion','clickup')`
    ),

    /**
     * Content columns belong to 'internal' rows ONLY.
     *
     * ⚠️ Rewritten from `source_system <> 'clickup' OR ...` to an allow-list.
     * The old form was a DENY-list of one, so the moment 'notion' was added it
     * silently started permitting mirrored Notion titles — exactly the drift the
     * constraint exists to prevent, and it would have passed review because the
     * constraint was still there and still named the same thing.
     */
    check(
      'tracked_item_content_by_source_ck',
      sql`${table.sourceSystem} = 'internal' OR (${table.title} IS NULL AND ${table.description} IS NULL)`
    ),

    // An external row must say WHERE it is external to, and an internal row has
    // nothing to point at. Mirrors project_external_pair_ck.
    check(
      'tracked_item_external_ref_ck',
      sql`(${table.sourceSystem} = 'internal' AND ${table.externalTaskId} IS NULL)
          OR (${table.sourceSystem} <> 'internal' AND ${table.externalTaskId} IS NOT NULL)`
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

// ⚠️ Both `status` and `source_system` have Postgres defaults, so their
// overrides MUST carry .optional() — overriding a defaulted column otherwise
// makes it required on insert (see CLAUDE.md; this bit three columns already).
export const insertTrackedItemSchema = createInsertSchema(trackedItem, {
  externalTaskId: (s) => s.min(1, 'An external task id is required').nullish(),
  sourceSystem: z.enum(TASK_SOURCE_SYSTEMS).optional(),
  status: z.enum(TRACKED_ITEM_STATUSES).optional()
});

export const selectTrackedItemSchema = createSelectSchema(trackedItem, {
  sourceSystem: z.enum(TASK_SOURCE_SYSTEMS),
  status: z.enum(TRACKED_ITEM_STATUSES)
});
