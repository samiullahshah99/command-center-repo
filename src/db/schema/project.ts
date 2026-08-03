import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';
import { EXTERNAL_SYSTEMS } from './external-system';

/**
 * A project: the grouping the tracker board is organised around.
 *
 * ⚠️ There was no project table before this. It exists because leadership asked
 * for a Monday.com-style tracker, and it is deliberately MINIMAL — the shape
 * that will eventually matter is whatever Notion (Ocean) already uses, and
 * inventing structure ahead of seeing it means migrating twice.
 *
 * Two deferrals, made knowingly:
 *
 *   - `lead_person_id` is SINGULAR. Notion people-properties are multi-value, so
 *     if Ocean projects have several owners this becomes a join table. One
 *     column now, because a join table for a field that is single-valued in
 *     practice is harder to read and harder to seed.
 *   - Projects are FLAT. Notion databases often nest; `parent_project_id` is
 *     purely additive and costs nothing to add later.
 */
export const PROJECT_STATUSES = ['active', 'paused', 'complete', 'archived'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),
    description: text('description'),

    /**
     * Lifecycle state. TEXT + CHECK rather than a pgEnum, matching
     * `tracked_item.status` and for the same reason: these values will churn
     * while the product settles, and `ALTER TYPE` is a bad trade for that —
     * it cannot run in a transaction and a value cannot be removed at all.
     */
    status: text('status').notNull().default('active'),

    /** Nullable: a project can exist before anyone is named to run it. */
    leadPersonId: uuid('lead_person_id').references(() => person.id, {
      onDelete: 'set null'
    }),

    /**
     * Where this project mirrors from, when it mirrors from anywhere.
     *
     * ⚠️ Added NOW, empty, on purpose. If Ocean turns out to be the system of
     * record, every project needs a pointer back to its Notion page — and
     * retrofitting that means a migration plus a backfill against page ids
     * nobody wrote down. A nullable column costs nothing while unused.
     *
     * Vendor-neutral naming per CLAUDE.md: a `notion_page_id` column is the
     * mistake that cost a day when the destination changed from ClickUp.
     */
    externalId: text('external_id'),
    externalSystem: text('external_system'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    index('project_status_idx').on(table.status),
    index('project_lead_idx').on(table.leadPersonId),

    check('project_status_ck', sql`${table.status} IN ('active','paused','complete','archived')`),

    check(
      'project_external_system_ck',
      sql`${table.externalSystem} IS NULL OR ${table.externalSystem} IN ('internal','notion','clickup')`
    ),

    // Both or neither — a dangling id with no system is unreadable, and a system
    // with no id points at nothing. Same rule as candidate_action_item.
    check(
      'project_external_pair_ck',
      sql`(${table.externalId} IS NULL) = (${table.externalSystem} IS NULL)`
    )
  ]
);

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// ⚠️ `status` has a Postgres default, so the override MUST carry .optional() —
// overriding a defaulted column otherwise makes it required on insert. That
// exact mistake already broke three columns in this repo (see CLAUDE.md).

export const insertProjectSchema = createInsertSchema(project, {
  name: (s) => s.min(1, 'A project name is required'),
  status: z.enum(PROJECT_STATUSES).optional(),
  externalSystem: z.enum(EXTERNAL_SYSTEMS).nullish()
});

export const selectProjectSchema = createSelectSchema(project, {
  status: z.enum(PROJECT_STATUSES)
});
