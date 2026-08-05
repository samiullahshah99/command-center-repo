import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

/**
 * A department. The grouping the Control Tower and Department screens are built
 * around.
 *
 * ⚠️ NO HEALTH COLUMN, DELIBERATELY. The frontend contract asks for
 * `health: good | needs_attention | bad` on every department card, and the rule
 * that computes it is NOT YET DECIDED. Storing it before the rule exists would
 * create a column that either sits null on every row or holds a number nobody
 * can explain — and health is the Control Tower's headline signal, so a
 * hand-wavy value becomes the number the founder reads every morning.
 *
 * Health will be a COMPUTED function over items and events, alongside
 * `summary` (which reuses the `ai_summary` two-gate cache). Neither belongs in
 * this table. When the rule lands, it can be materialised here if the query
 * proves too slow — but that is an optimisation with a known correct answer to
 * check against, not a schema guess.
 */
export const department = pgTable(
  'department',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),

    /**
     * Which conditional panels a department screen renders.
     *
     * The mockup drives these off `dept.isCreative` / `dept.isCx` booleans — one
     * flag per type, which cannot express "exactly one type" and grows a column
     * per department kind. The frontend contract itself recommends an enum
     * instead, so this ships as the enum and the booleans are derived in the
     * theme layer.
     *
     * TEXT + CHECK rather than pgEnum, per repo convention: `ALTER TYPE` cannot
     * run inside a transaction and an enum value can never be removed.
     */
    deptType: text('dept_type').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    /**
     * Case-insensitive uniqueness on a FUNCTIONAL index, matching
     * `person_email_lower_idx`: the stored value keeps its original casing for
     * display while `lower(name)` is what must be unique.
     *
     * This is also what lets the seed be idempotent — it keys departments on
     * name, exactly as it already does for `role_profile`.
     */
    uniqueIndex('department_name_lower_idx').on(sql`lower(${table.name})`),

    check(
      'department_dept_type_ck',
      sql`${table.deptType} IN ('creative','cx','ops','engineering')`
    )
  ]
);

export const DEPT_TYPES = ['creative', 'cx', 'ops', 'engineering'] as const;
export type DeptType = (typeof DEPT_TYPES)[number];

export type Department = typeof department.$inferSelect;
export type NewDepartment = typeof department.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const insertDepartmentSchema = createInsertSchema(department, {
  name: (s) => s.min(1, 'A name is required'),
  // `dept_type` has no Postgres default, so this override stays required — which
  // is correct. ⚠️ Overriding a column that HAS a default makes it required on
  // insert unless .optional() is added; see CLAUDE.md.
  deptType: z.enum(DEPT_TYPES)
});

export const selectDepartmentSchema = createSelectSchema(department, {
  deptType: z.enum(DEPT_TYPES)
});
