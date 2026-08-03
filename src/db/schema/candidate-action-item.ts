import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';
import { unifiedEvent } from './unified-event';

/**
 * An action item the extractor believes it found — pending human review.
 *
 * ⚠️ CANDIDATE, not fact. Nothing here has been confirmed by a person until
 * `review_status` says so, and nothing reaches Notion before that. The whole
 * table exists so an LLM's output has somewhere to sit that is clearly NOT the
 * system of record.
 *
 * ⚠️ THE DESTINATION IS NOTION (Ocean), and no column says so. `external_task_id`
 * and `external_system` are generic on purpose: naming a column after one vendor
 * is how a whole day of ClickUp work had to be retargeted.
 */
export const candidateActionItem = pgTable(
  'candidate_action_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** CASCADE: a candidate derived from an event is meaningless without it. */
    unifiedEventId: uuid('unified_event_id')
      .notNull()
      .references(() => unifiedEvent.id, { onDelete: 'cascade' }),

    description: text('description').notNull(),

    /**
     * The name EXACTLY as the transcript said it, kept permanently.
     *
     * Even after `owner_person_id` is set. It is the audit record of what the
     * model actually saw: when an attribution turns out wrong, this is how you
     * tell a bad extraction from a bad resolution.
     */
    ownerName: text('owner_name').notNull(),

    ownerPersonId: uuid('owner_person_id').references(() => person.id, { onDelete: 'set null' }),

    /**
     * ⚠️ 'fuzzy' EXISTS HERE AND NOWHERE ELSE.
     *
     * `person_identity.confidence` has no name tier, deliberately — two people
     * can share a display name and a wrong auto-link silently attributes one
     * person's work to another. A name match is tolerable on a CANDIDATE only
     * because this is a review queue and 'fuzzy' can never auto-approve.
     *
     * On approval the identity link is written with confidence='manual', because
     * by then a human really did confirm it.
     */
    ownerConfidence: text('owner_confidence').notNull(),

    /**
     * `date`, not timestamptz. "Friday" from a transcript has no timezone, and
     * storing it as an instant would invent precision the source lacks.
     */
    dueDate: date('due_date'),

    /**
     * Dependent items mentioned alongside, as free text.
     *
     * text[] rather than jsonb: a flat list, queryable with ANY() and no JSON
     * path. Not modelled as relations — at extraction time these are phrases,
     * not identified items.
     */
    followUps: text('follow_ups')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    /** The model's self-reported confidence. Not a measured quantity. */
    confidence: real('confidence').notNull(),

    /**
     * ⚠️ NOT NULL, ever.
     *
     * The quoted transcript text this came from. Without it a reviewer cannot
     * verify the item against the source, which makes the review UI useless —
     * they would be approving the model's assertion on trust. It is also the
     * only defence against a confidently-worded hallucination.
     */
    sourceSpan: text('source_span').notNull(),

    reviewStatus: text('review_status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /** Which fields a human changed. The live precision metric. */
    editedFields: text('edited_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    /**
     * sha256 of owner_name + source_span, normalised.
     *
     * ⚠️ NOT the description. Re-running extraction — after a prompt change or a
     * model swap — rewords the same commitment, so hashing the description would
     * make every re-run a new row and fill the queue with duplicates. The source
     * span is quoted from a transcript that does not change.
     */
    contentHash: text('content_hash').notNull(),

    /** Populated when the item is pushed to its destination. */
    externalTaskId: text('external_task_id'),
    externalSystem: text('external_system'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    /**
     * GLOBAL, not scoped to the event. Re-processing a transcript updates rather
     * than duplicating, and the same commitment quoted in two meetings collapses
     * to one row.
     */
    uniqueIndex('candidate_action_item_content_hash_key').on(table.contentHash),

    index('candidate_action_item_unified_event_idx').on(table.unifiedEventId),
    /** The review queue: pending first, oldest first. */
    index('candidate_action_item_review_idx').on(table.reviewStatus, table.createdAt),
    index('candidate_action_item_owner_idx').on(table.ownerPersonId),
    /** "What still needs pushing to the destination?" */
    index('candidate_action_item_unsynced_idx')
      .on(table.reviewStatus)
      .where(sql`${table.externalTaskId} IS NULL`),

    check(
      'candidate_action_item_owner_confidence_ck',
      sql`${table.ownerConfidence} IN ('exact','email','fuzzy','unresolved')`
    ),
    check(
      'candidate_action_item_review_status_ck',
      sql`${table.reviewStatus} IN ('pending','approved','rejected','auto_approved')`
    ),
    check(
      'candidate_action_item_external_system_ck',
      sql`${table.externalSystem} IS NULL OR ${table.externalSystem} IN ('notion','internal')`
    ),
    check(
      'candidate_action_item_confidence_range_ck',
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
    ),

    /** An owner and its confidence must agree — see the contract's Zod refine. */
    check(
      'candidate_action_item_owner_coherent_ck',
      sql`(${table.ownerConfidence} = 'unresolved' AND ${table.ownerPersonId} IS NULL)
          OR (${table.ownerConfidence} <> 'unresolved' AND ${table.ownerPersonId} IS NOT NULL)`
    ),

    /**
     * A review outcome records who and when; 'pending' records neither.
     *
     * 'auto_approved' is exempt from `reviewed_by` — nobody reviewed it — but
     * still needs `reviewed_at`, so you can tell when the rule fired.
     */
    check(
      'candidate_action_item_review_provenance_ck',
      sql`(${table.reviewStatus} = 'pending' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL)
          OR (${table.reviewStatus} = 'auto_approved' AND ${table.reviewedAt} IS NOT NULL)
          OR (${table.reviewStatus} IN ('approved','rejected') AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`
    ),

    /** An external id and the system it belongs to travel together. */
    check(
      'candidate_action_item_external_pair_ck',
      sql`(${table.externalTaskId} IS NULL) = (${table.externalSystem} IS NULL)`
    )
  ]
);

export type CandidateActionItem = typeof candidateActionItem.$inferSelect;
export type NewCandidateActionItem = typeof candidateActionItem.$inferInsert;

export const insertCandidateActionItemSchema = createInsertSchema(candidateActionItem, {
  description: (s) => s.min(1),
  ownerName: (s) => s.min(1),
  sourceSpan: (s) => s.min(10, 'source_span must quote enough transcript to verify against'),
  // ⚠️ Overriding a column with a default makes it REQUIRED on insert unless
  // .optional() is added — the override replaces the whole type.
  confidence: z.number().min(0).max(1),
  reviewStatus: z.enum(['pending', 'approved', 'rejected', 'auto_approved']).optional(),
  ownerConfidence: z.enum(['exact', 'email', 'fuzzy', 'unresolved']),
  followUps: z.array(z.string()).optional(),
  editedFields: z.array(z.string()).optional()
});

export const selectCandidateActionItemSchema = createSelectSchema(candidateActionItem);
