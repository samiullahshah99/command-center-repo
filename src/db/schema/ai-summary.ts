import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { person } from './person';

/**
 * The cached AI summary for one person.
 *
 * ── Why a table and not columns on `person` ─────────────────────────────────
 * `person` is roster data, edited by a human through an admin form whose
 * validation is DERIVED from the table via createInsertSchema. Hanging six
 * generated columns off it would put fields in that form's schema that nobody
 * edits, and would make it possible for an ordinary admin save to clobber a
 * summary. The two also have opposite lifecycles: one is human-authored and
 * rarely changes, the other is machine-written and disposable.
 *
 * ── The two-gate staleness rule (implemented in ai/summarise.ts) ────────────
 *
 *   input_hash unchanged            -> serve cache, whatever its age
 *   hash changed, < 1h old          -> serve cache; the rate cap wins
 *   hash changed, >= 1h old         -> regenerate
 *   manual regenerate               -> bypass both, but still write the hash
 *
 * The TTL is what guarantees at most one LLM call per person per hour. The hash
 * is what stops a pointless call when the hour lapses and nothing has actually
 * moved — the common case on a seven-person roster, and the reason this costs
 * cents rather than dollars.
 */
export const aiSummary = pgTable(
  'ai_summary',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * onDelete: 'cascade', unlike most FKs here which use 'set null'.
     * A summary describes one person; orphaned from them it is not a record of
     * anything, it is a paragraph about nobody.
     */
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),

    summary: text('summary').notNull(),

    /** What the summary was built from. Rendered in the card's footer. */
    itemCount: integer('item_count').notNull(),
    eventCount: integer('event_count').notNull(),

    /**
     * sha256 over the exact inputs — item ids, statuses, due dates, event ids.
     * Gate one of the staleness rule; see the header.
     */
    inputHash: text('input_hash').notNull(),

    /** Provenance and spend, so cost is attributable per person, not just per run. */
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costUsd: real('cost_usd').notNull(),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    /**
     * ONE ROW PER PERSON. Regeneration upserts; there is deliberately NO HISTORY.
     *
     * ⚠️ IF YOU ARE HERE TO ADD SUMMARY HISTORY, READ THIS FIRST.
     *
     * The obvious next thought is "we should keep old summaries to see how
     * someone's work changed over time." Don't build it here. Week 3's
     * `monitor_report` is the designed time-series surface for exactly that
     * question, and a second time series over the same underlying facts would
     * duplicate it badly — two tables answering "what changed", disagreeing
     * whenever one is backfilled and the other is not, and no obvious winner
     * when they do.
     *
     * This table is a CACHE. Dropping this unique index to append rows turns it
     * into a log, and the cache lookup silently becomes "newest row wins" with
     * unbounded growth behind it.
     */
    uniqueIndex('ai_summary_person_key').on(table.personId),

    check('ai_summary_counts_ck', sql`${table.itemCount} >= 0 AND ${table.eventCount} >= 0`)
  ]
);

export type AiSummary = typeof aiSummary.$inferSelect;
export type NewAiSummary = typeof aiSummary.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// No column overrides needed: nothing here is a union, and `generatedAt` keeps
// its Postgres default without being forced required on insert.

export const insertAiSummarySchema = createInsertSchema(aiSummary, {
  summary: (s) => s.min(1, 'A summary cannot be empty'),
  inputHash: (s) => s.min(1)
});

export const selectAiSummarySchema = createSelectSchema(aiSummary);

/** Gate two of the staleness rule. One hour, per the requirement. */
export const SUMMARY_TTL_MS = 60 * 60 * 1000;
