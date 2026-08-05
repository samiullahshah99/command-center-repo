import { sql } from 'drizzle-orm';
import { index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { department } from './department';
import { role } from './role';
import { roleProfile } from './role-profile';

// A person in the company. External ids are nullable because not everyone has
// an account in every system, and someone may be onboarded here before their
// Slack/ClickUp/portal accounts exist.
export const person = pgTable(
  'person',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),

    /**
     * ⚠️ THE ONLY AUTOMATIC CROSS-SYSTEM JOIN KEY.
     *
     * Vision, UGC and Command Centre run THREE SEPARATE Clerk instances, so no
     * external id is comparable between them. Names are display-only and are
     * never an auto-match signal. That leaves email as the single field that can
     * link an identity in one system to a person here without a human.
     *
     * Nullable, because a person can be onboarded before their address is known
     * — but an empty one means every identity for them arrives UNRESOLVED.
     */
    email: text('email'),

    // Nullable: a person can exist before a role profile has been assigned.
    // onDelete: 'set null' — deleting a profile must not delete people.
    roleProfileId: uuid('role_profile_id').references(() => roleProfile.id, {
      onDelete: 'set null'
    }),

    /**
     * ACCESS role. ⚠️ A DIFFERENT AXIS from `roleProfileId` above — see the
     * header on `src/db/schema/role.ts`. That one is work config (tracked
     * signals + quota); this one is what the person is allowed to see.
     *
     * Nullable for now: the seven roles exist and people are being assigned to
     * them incrementally, and a NOT NULL here would make every insert depend on
     * a decision that has not been made for every row yet. ⚠️ Nullable means
     * "no access decided", which the authorisation layer must treat as NO
     * ACCESS — never as a default role. Failing open here would grant founder
     * screens to anyone whose row was not filled in.
     *
     * onDelete: 'set null' — retiring a role must not delete people.
     */
    roleId: smallint('role_id').references(() => role.id, { onDelete: 'set null' }),

    /**
     * Nullable: a person can be onboarded before their department is known, and
     * some people (an agency contact) legitimately have none.
     *
     * onDelete: 'set null' — dissolving a department must not delete its people.
     */
    departmentId: uuid('department_id').references(() => department.id, {
      onDelete: 'set null'
    }),

    /**
     * @deprecated Superseded by `person_identity`, which is authoritative.
     *
     * Kept only so the People admin form keeps compiling; all three are NULL for
     * every row today. They cannot express the three-Clerk-instances reality —
     * one column per system with no `source` discriminator is exactly the shape
     * that invites comparing ids across systems. Remove in Phase 3, when the
     * admin UI that reads them is being rewritten anyway.
     */
    slackId: text('slack_id'),
    /** @deprecated see slackId */
    clickupId: text('clickup_id'),
    /** @deprecated see slackId — replaced by person_identity(source='portal') */
    portalId: text('portal_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    /**
     * Case-insensitive uniqueness on a FUNCTIONAL index, rather than the citext
     * extension: citext would need CREATE EXTENSION on Railway and changes the
     * column's comparison semantics everywhere. This keeps the stored value
     * exactly as entered (it is shown in the UI) while making `lower(email)` the
     * thing that must be unique — which is also the expression the resolver
     * matches on, so the lookup uses this index.
     *
     * PARTIAL, because NULLs are distinct in Postgres unique indexes anyway and
     * the predicate makes "many people may have no email" explicit.
     */
    uniqueIndex('person_email_lower_idx')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} IS NOT NULL`),

    /** "Everyone in this department" — the Department and My team screens. */
    index('person_department_idx').on(table.departmentId),

    /** "Everyone holding this role" — the Automations role-profiles table. */
    index('person_role_idx').on(table.roleId)
  ]
);

export type Person = typeof person.$inferSelect;
export type NewPerson = typeof person.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const insertPersonSchema = createInsertSchema(person, {
  name: (s) => s.min(1, 'Name is required')
});

export const selectPersonSchema = createSelectSchema(person);
