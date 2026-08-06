import { check, date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { recurringTask } from './recurring-task';

// An append-only record that a recurring task was satisfied on a given occasion,
// together with what proved it. This is the audit trail behind auto-completion —
// never update or delete rows here, insert a new one.
//
// ⚠️⚠️ APPEND-ONLY IS A CONTRACT, NOT A STYLE NOTE. A completion is a fact about
// what happened; a correction is a NEW row, never an edit. There is deliberately
// no UPDATE path anywhere in the codebase — `recordEvidence()` in
// src/lib/evidence.ts is the ONLY writer and it is INSERT … ON CONFLICT DO
// NOTHING. See docs/completion-engine-design.md §3.4.
export const completionEvent = pgTable(
  'completion_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Required. onDelete: 'cascade' — completion history is meaningless without
    // the task it belongs to.
    recurringTaskId: uuid('recurring_task_id')
      .notNull()
      .references(() => recurringTask.id, { onDelete: 'cascade' }),

    /**
     * WHICH rule/criterion was satisfied — `AutoCompleteRule.signal`, or the
     * constant `manual_checkoff`.
     *
     * ⚠️ A STABLE IDENTIFIER, never generated prose. Design §2.3: model wording
     * is not reproducible run to run (the temperature-0 finding that already
     * broke `content_hash`), so nothing keyed may come from an LLM.
     */
    signal: text('signal').notNull(),

    /**
     * The window this completion credits — a DATE in COMPLETION_TZ
     * (Asia/Karachi), from `windowStartFor()`. Half of the idempotency key.
     *
     * ⚠️ A `date`, not a timestamp: two signals at different times on the same
     * day must produce the same key or the unique index below does nothing.
     */
    windowStart: date('window_start').notNull(),

    /**
     * Whether the proving event was attributed to a person.
     *
     * ⚠️ `unattributed` is a REAL and expected value, not an error. UGC and
     * Fireflies events routinely carry a null `person_id` (audit D4), so a rule
     * with `actor: 'any'` completes without knowing who did it. The UI must say
     * "completed by an unattributed signal" and never show a name — writing the
     * owner's id in would fabricate the one fact this ledger exists to record.
     *
     * ⚠️⚠️ NOT NULL WITH NO DEFAULT, DELIBERATELY. A schema default would mean a
     * future writer that forgets this column silently produces an ATTRIBUTED
     * completion — and `attributed` is precisely the DISHONEST value to fall back
     * to, because it asserts we know who did the work when we do not. With no
     * default, a forgetful writer fails loudly at INSERT instead. The table was
     * empty when this landed, so there was no backfill to trade against.
     */
    attribution: text('attribution').notNull(),

    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),

    // What proved completion. Nullable together with evidence_ref: a
    // fallback_manual completion has a human behind it rather than a signal.
    evidenceSource: text('evidence_source'),

    // Pointer to the proof: a unified_event id, or a person id for a manual
    // check-off. ⚠️ ALWAYS AN ID — never a description, quote or summary.
    evidenceRef: text('evidence_ref'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    /**
     * ⚠️⚠️ ONE COMPLETION PER TASK PER WINDOW — enforced by Postgres, not by
     * application logic.
     *
     * This single index is what makes the whole engine safe under at-least-once
     * queue delivery, under `pnpm renormalise`, and under a sweep running on two
     * containers. Writes are ON CONFLICT DO NOTHING, so the FIRST qualifying
     * signal wins the window and a later one cannot overwrite its evidence
     * pointer (design §3.4, §5.3). One statement, never select-then-insert —
     * the same reasoning that makes `ingestRawEvent` safe against concurrent
     * duplicate deliveries.
     */
    uniqueIndex('completion_event_task_window_key').on(table.recurringTaskId, table.windowStart),

    // A real, expected value — see the column note.
    check(
      'completion_event_attribution_ck',
      sql`${table.attribution} IN ('attributed','unattributed')`
    )
  ]
);

export type CompletionEvent = typeof completionEvent.$inferSelect;
export type NewCompletionEvent = typeof completionEvent.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

/**
 * WHERE the proof lives.
 *
 * ⚠️ DELIBERATELY A SUPERSET OF `RAW_EVENT_SOURCES`, not a copy of it. It adds
 * `portal` (our own records) and `manual` (a human), neither of which is a
 * webhook source — reusing RAW_EVENT_SOURCES here would make a manual check-off
 * unrepresentable, which is precisely how "evidenced" degrades into
 * "self-declared with no marker".
 *
 * ⚠️ `vision`, `ugc` and `fireflies` ADDED 2026-08-06 (design §2.2). Three of our
 * five real event sources were missing, so a Vision-proved completion could not
 * name what proved it. TEXT + Zod, so widening costs no migration.
 *
 * ⚠️ ONE constant for both surfaces — the recurring ledger and (Session B)
 * Founder offload's "verifiably handed off". Design §2.5: the shared evidence
 * SHAPE is what stops the two developing incompatible notions of proof.
 */
export const EVIDENCE_SOURCES = [
  'portal',
  'slack',
  'clickup',
  'vision',
  'ugc',
  'fireflies',
  'manual'
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const ATTRIBUTION_STATES = ['attributed', 'unattributed'] as const;
export type AttributionState = (typeof ATTRIBUTION_STATES)[number];

/**
 * ⚠️ `attribution` IS REQUIRED ON INSERT, and that is the point of dropping its
 * Postgres default. It was previously `.optional()` here because the column had
 * one; keeping that now would let a caller omit it, get a Zod pass, and fail at
 * the database — the loud failure in the wrong place. Required at both layers.
 */
export const insertCompletionEventSchema = createInsertSchema(completionEvent, {
  signal: (s) => s.min(1, 'signal is required'),
  attribution: z.enum(ATTRIBUTION_STATES),
  evidenceSource: z.enum(EVIDENCE_SOURCES).nullable().optional()
});

export const selectCompletionEventSchema = createSelectSchema(completionEvent, {
  attribution: z.enum(ATTRIBUTION_STATES),
  evidenceSource: z.enum(EVIDENCE_SOURCES).nullable()
});
