import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { roleProfile } from './role-profile';

// A person in the company. External ids are nullable because not everyone has
// an account in every system, and someone may be onboarded here before their
// Slack/ClickUp/portal accounts exist.
export const person = pgTable('person', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: text('name').notNull(),

  // Nullable: a person can exist before a role profile has been assigned.
  // onDelete: 'set null' — deleting a profile must not delete people.
  roleProfileId: uuid('role_profile_id').references(() => roleProfile.id, {
    onDelete: 'set null'
  }),

  slackId: text('slack_id'),
  clickupId: text('clickup_id'),
  portalId: text('portal_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export type Person = typeof person.$inferSelect;
export type NewPerson = typeof person.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const insertPersonSchema = createInsertSchema(person, {
  name: (s) => s.min(1, 'Name is required')
});

export const selectPersonSchema = createSelectSchema(person);
