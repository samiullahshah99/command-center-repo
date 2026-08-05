import { pgTable, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

/**
 * ACCESS role. What a person is allowed to see.
 *
 * ⚠️ NOT `role_profile`, and the two must never be merged. `role_profile` means
 * TRACKED SIGNALS + QUOTA — the work config that drives My day, Briefs & quota
 * and Automations. This table means ACCESS. They look similar and are not:
 * Founder and Ops lead share almost all access while having different signals
 * and quotas, and a Creative and a Coder differ on both axes independently.
 * Collapsing them means one cannot change without the other.
 *
 * ── Why a lookup TABLE and not a column or a pgEnum ─────────────────────────
 * A pgEnum makes adding a role an `ALTER TYPE`, which cannot run inside a
 * transaction and whose values can never be removed — the same reason
 * `tracked_item.status` and `.source_system` were both converted away from
 * enums. A bare TEXT column on `person` has nowhere to hang `display_name` and
 * nothing to join for "who holds this role?".
 *
 * ── Why NOT Clerk Organizations ─────────────────────────────────────────────
 * ⚠️ Navigation RBAC used to be powered by Clerk Organizations and was
 * DELIBERATELY REMOVED along with Billing. Do not reintroduce
 * `useOrganization()`, `<Protect>`, `has({ plan })`, or `NavItem.access`. This
 * table is the replacement, and it is ours: role assignment is a row in our
 * database, not membership in an external service that also bills us.
 */
export const role = pgTable(
  'role',
  {
    /**
     * ⚠️ EXPLICIT, FIXED ids — deliberately NOT generated.
     *
     * Seeded 1..7 in the ROLE_CODES order below. A serial/identity column
     * assigns ids in whatever order the seed happens to run, so dev, staging and
     * production drift and a hardcoded id in a fixture or a hand-written query
     * means a different role per environment. Fixed ids make the table
     * reproducible everywhere.
     *
     * `smallint` because seven rows will never need four bytes.
     */
    id: smallint('id').primaryKey(),

    /**
     * ⚠️ THE ONLY THING CODE MAY COMPARE AGAINST.
     *
     * Every comparison in application code uses this string, never the numeric
     * id: `role.code === 'ops_lead'` greps, `role_id === 2` does not, and a
     * reader of the second has no way to tell which role is meant without
     * opening this file.
     *
     * ⚠️ There is deliberately NO CHECK constraint pinning these seven values.
     * The point of a lookup table is that adding a role is an INSERT rather than
     * a migration; a CHECK would re-create exactly the pgEnum problem this table
     * exists to avoid. The seven rows themselves are the constraint, seeded from
     * ROLE_CODES, and `RoleCode` gives compile-time safety at every call site.
     */
    code: text('code').notNull(),

    /** Human-facing label. Mutable, display only — never matched on. */
    displayName: text('display_name').notNull()
  },
  (table) => [
    /** Requested explicitly: code is the application-level key, so it is unique. */
    uniqueIndex('role_code_key').on(table.code)
  ]
);

/**
 * The seven roles, in id order. Index 0 is id 1.
 *
 * Source: the PRD persona table, via the frontend contract's role → screen
 * access matrix (§4).
 */
export const ROLE_CODES = [
  'founder',
  'ops_lead',
  'support_manager',
  'cx_agent',
  'creative',
  'coder',
  'agency'
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * code → fixed id, derived from ROLE_CODES order so the two cannot disagree.
 *
 * Used by the seed. Application code should not need it — compare on `code`.
 */
export const ROLE_IDS = Object.fromEntries(ROLE_CODES.map((code, i) => [code, i + 1])) as Record<
  RoleCode,
  number
>;

/** Default labels for the seed. Editable in the database afterwards. */
export const ROLE_DISPLAY_NAMES: Record<RoleCode, string> = {
  founder: 'Founder',
  ops_lead: 'Ops lead',
  support_manager: 'Support manager',
  cx_agent: 'CX agent',
  creative: 'Creative',
  coder: 'Coder',
  agency: 'Agency'
};

export type Role = typeof role.$inferSelect;
export type NewRole = typeof role.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const insertRoleSchema = createInsertSchema(role, {
  // ⚠️ Neither column has a Postgres default, so these overrides do NOT need
  // .optional() — overriding a DEFAULTED column is what silently makes it
  // required on insert (it bit status, auto_complete_rule and the role_profile
  // JSONB columns). `id` is likewise required on purpose: ids are explicit.
  code: z.enum(ROLE_CODES),
  displayName: (s) => s.min(1, 'A display name is required')
});

export const selectRoleSchema = createSelectSchema(role, {
  code: z.enum(ROLE_CODES)
});
