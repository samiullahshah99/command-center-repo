import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';
import { personIdentity } from './person-identity';
import { rawEvent, RAW_EVENT_SOURCES } from './raw-event';

/**
 * The unified data layer: one row per thing that happened, whatever sent it.
 *
 * ⚠️ DERIVED AND DISPOSABLE. `raw_event` is the source of truth; every row here
 * can be rebuilt from it. That is what makes mapping logic safe to change — see
 * `normaliserVersion` and scripts/renormalise.ts.
 *
 * ⚠️ REBUILD BY UPSERT, NEVER DELETE-AND-REINSERT. Week 2's extraction pipeline
 * will reference `unified_event.id`; recreating rows would change those ids and
 * break the references. The (raw_event_id, source_seq) unique key exists so a
 * re-run updates in place and ids survive.
 */
export const unifiedEvent = pgTable(
  'unified_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * CASCADE, unlike person_identity's SET NULL: a derived row is meaningless
     * without the event it was derived from, and keeping it would strand a row
     * that can never be rebuilt or verified.
     */
    rawEventId: uuid('raw_event_id')
      .notNull()
      .references(() => rawEvent.id, { onDelete: 'cascade' }),

    /**
     * Which event WITHIN one payload this is. 0 for every source today.
     *
     * ClickUp's `history_items` is an array and their API may batch several
     * distinct changes into a single webhook. Every payload we have carries
     * exactly one, so this is always 0 in practice — but it is part of the
     * unique key from the start, because widening a UNIQUE constraint later on a
     * table the extraction pipeline references is a far worse migration than
     * carrying an integer that is currently always zero.
     */
    sourceSeq: integer('source_seq').notNull().default(0),

    source: text('source').notNull(),

    /**
     * The sender's own type string, stored verbatim.
     *
     * ⚠️ NOT constrained to a known set. Every sender's contract says their
     * catalog will grow, and an unknown type must be stored rather than
     * rejected — an event never stored cannot be replayed.
     */
    eventType: text('event_type').notNull(),

    /**
     * When it happened, per the SENDER. Five different wire formats collapse
     * here — see src/features/normalise/time.ts.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    /**
     * Whether occurredAt came from the payload or fell back to
     * raw_event.received_at.
     *
     * A silently substituted timestamp skews every time-series query with no way
     * to notice, so the substitution is recorded rather than hidden.
     */
    occurredAtSource: text('occurred_at_source').notNull().default('payload'),

    /**
     * NULL is a real, expected state, not a failure.
     *
     * Every real Vision event so far carries `email: null`, and Slack sends no
     * email at all without a scope we do not hold, so a large share of events
     * genuinely cannot be attributed on arrival. Holding them out of this table
     * until someone links them would make "what happened last week" quietly
     * under-report, with no way to see the hole.
     */
    personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),

    /**
     * WHICH external account produced this, resolved or not.
     *
     * The reason a null person_id is cheap to repair: linking an identity later
     * is one UPDATE over this column and every historical event is attributed at
     * once, with no re-normalisation.
     */
    personIdentityId: uuid('person_identity_id').references(() => personIdentity.id, {
      onDelete: 'set null'
    }),

    /** What the event was about — a brief, a task, a channel, a meeting. */
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    /** Human-readable, MUTABLE, display only. Never join on it. */
    subjectLabel: text('subject_label'),

    /** Source-specific remainder. Never the whole payload — that is raw_event's job. */
    metadata: jsonb('metadata').notNull().default({}),

    /**
     * Which mapping logic produced this row. Bump NORMALISER_VERSION when the
     * mapping changes, then re-normalise `WHERE normaliser_version < n`.
     */
    normaliserVersion: integer('normaliser_version').notNull(),

    /** Set once. A re-normalise updates `updatedAt`, so drift is visible. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    /** The natural key. Makes re-normalising an upsert instead of a duplicate. */
    uniqueIndex('unified_event_raw_event_seq_key').on(table.rawEventId, table.sourceSeq),

    /** "What did this person do, most recent first" — the timeline query. */
    index('unified_event_person_occurred_idx').on(table.personId, table.occurredAt.desc()),
    index('unified_event_source_occurred_idx').on(table.source, table.occurredAt.desc()),
    index('unified_event_occurred_idx').on(table.occurredAt.desc()),
    index('unified_event_event_type_idx').on(table.eventType),
    /** Backs the one-UPDATE attribution backfill described on personIdentityId. */
    index('unified_event_identity_idx').on(table.personIdentityId),
    index('unified_event_subject_idx').on(table.subjectType, table.subjectId),

    /** The unattributed queue, and the metric that keeps the gap visible. */
    index('unified_event_unattributed_idx')
      .on(table.occurredAt.desc())
      .where(sql`${table.personId} IS NULL`),

    check(
      'unified_event_source_ck',
      sql`${table.source} IN ('slack','clickup','fireflies','ugc','vision')`
    ),
    check(
      'unified_event_occurred_at_source_ck',
      sql`${table.occurredAtSource} IN ('payload','received_at')`
    )
  ]
);

export const OCCURRED_AT_SOURCES = ['payload', 'received_at'] as const;
export type OccurredAtSource = (typeof OCCURRED_AT_SOURCES)[number];

export type UnifiedEvent = typeof unifiedEvent.$inferSelect;
export type NewUnifiedEvent = typeof unifiedEvent.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const insertUnifiedEventSchema = createInsertSchema(unifiedEvent, {
  source: z.enum(RAW_EVENT_SOURCES),
  eventType: (s) => s.min(1, 'event_type is required'),
  // ⚠️ Overriding a column that HAS a default makes it required on insert unless
  // .optional() is added — the override replaces the whole type, optionality
  // included. This already bit status and the role_profile JSONB columns.
  occurredAtSource: z.enum(OCCURRED_AT_SOURCES).optional(),
  sourceSeq: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const selectUnifiedEventSchema = createSelectSchema(unifiedEvent);
