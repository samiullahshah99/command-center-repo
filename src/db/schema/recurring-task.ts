import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';
import { RAW_EVENT_SOURCES } from './raw-event';

// A recurring obligation, e.g. "acknowledge returns awaiting review, daily".
// Completion is normally inferred from an inbound event signal rather than being
// ticked off by hand — see auto_complete_rule.
export const recurringTask = pgTable('recurring_task', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Required: a recurring task without an owner cannot be monitored.
  // onDelete: 'cascade' — if the person is removed, their recurring obligations
  // go with them.
  ownerPersonId: uuid('owner_person_id')
    .notNull()
    .references(() => person.id, { onDelete: 'cascade' }),

  // Allowed: daily | weekly | biweekly | monthly | quarterly.
  // text + Zod rather than a Postgres enum, for the same churn reason as
  // tracked_item.status.
  cadence: text('cadence').notNull(),

  /**
   * The event predicate that counts as completion. See `autoCompleteRuleSchema`.
   *
   * ⚠️ `{}` MEANS "NO RULE", and that is a real, supported configuration — not a
   * missing value. Two seeded tasks have no expressible rule at all (Diane: no
   * `portal` event source exists; Ronalyn: Fireflies is 0% attributed), so they
   * are manual-only by design. Never treat an empty rule as a bug to fill in.
   */
  autoCompleteRule: jsonb('auto_complete_rule').notNull().default({}),

  // When true, a human may mark this complete if no signal arrives.
  fallbackManual: boolean('fallback_manual').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export type RecurringTask = typeof recurringTask.$inferSelect;
export type NewRecurringTask = typeof recurringTask.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'] as const;

export type Cadence = (typeof CADENCES)[number];

/**
 * A placeholder standing in for a Slack channel id nobody has supplied yet.
 *
 * ⚠️ NOT A SENTINEL THE MATCHER TREATS SPECIALLY — the matcher compares it like
 * any other value, so a rule carrying it simply never matches. It exists so
 * `validateRule()` can say **"cannot fire — channel id missing"** instead of the
 * screen showing a healthy-looking rule that silently never completes. Design §0:
 * a green engine with a permanently empty ledger reads as "nobody did their work".
 */
export const PENDING_CHANNEL_ID = 'PENDING_CHANNEL_ID';

/**
 * THE TYPED COMPLETION RULE — replaces the loose `{source, event, within}` shape
 * (design §3.1).
 *
 * ⚠️ `within` IS GONE. It duplicated `cadence` and invited direct disagreement (a
 * `weekly` task carrying `within: '24h'`). The window comes from the cadence —
 * one source of truth, resolved by `windowStartFor()`.
 *
 * ⚠️ NO EXPRESSION LANGUAGE. `metadata` is equality-only. A rule DSL is a parser,
 * an evaluator, a security surface and a debugging problem; the five real cases
 * need none of it.
 *
 * ⚠️ MIGRATING THE OLD ROWS WAS A DATA TASK, NOT A CAST. Not one of the five
 * seeded rules named a `(source, event_type)` pair that exists in `unified_event`
 * — see design §0 and the rewritten rules in `src/db/seed.ts`.
 */
export const autoCompleteRuleSchema = z.object({
  /** Bumped only for a breaking shape change; the evaluator may then branch. */
  version: z.literal(1),

  /**
   * Stable id written to `completion_event.signal`.
   *
   * ⚠️ NEVER REGENERATE IT FOR AN EXISTING RULE. Historical ledger rows carry the
   * old value and would silently stop joining to their own rule.
   */
  signal: z.string().min(1),

  match: z.object({
    /**
     * ⚠️ Constrained to RAW_EVENT_SOURCES — the sources that can actually appear
     * on a `unified_event`. This is the constraint that makes the old
     * `source: 'portal'` and `source: 'brief_tracker'` rules a compile-time
     * impossibility rather than a runtime mystery.
     */
    source: z.enum(RAW_EVENT_SOURCES),
    /** Must be a real `unified_event.event_type`, e.g. `message`, `brief.submitted`. */
    eventType: z.string().min(1),
    /** Optional narrowing. Absent = any subject. */
    subject: z
      .object({
        idIn: z.array(z.string()).min(1).optional(),
        labelMatches: z.string().min(1).optional()
      })
      .optional(),
    /** Equality only, against `unified_event.metadata`. */
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
  }),

  /**
   * ⚠️ THE ATTRIBUTION TRAP (design §3.5). `must_be_owner` on a source whose
   * attribution rate is zero can NEVER complete — and looks identical to a person
   * not doing their work. `validateRule()` rejects that combination at
   * configuration time.
   */
  actor: z.enum(['must_be_owner', 'any']),

  /** Restated from the task so a rule is self-contained when logged. */
  window: z.object({ cadence: z.enum(CADENCES) }),

  /** How many matching events close the window. Default 1. */
  minCount: z.number().int().min(1).optional()
});

export type AutoCompleteRule = z.infer<typeof autoCompleteRuleSchema>;

/**
 * `{}` is a valid stored value meaning "no rule". Parse with this, not with
 * `autoCompleteRuleSchema` directly.
 *
 * ⚠️ Returns null rather than throwing on a malformed rule. This is read on the
 * ops screen; one bad row must render as "no rule" in one cell, not take the
 * operator's only view of what is configured down with it.
 */
export function parseAutoCompleteRule(value: unknown): AutoCompleteRule | null {
  const parsed = autoCompleteRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// autoCompleteRule has a Postgres default ({}), so it stays optional on INSERT.
// cadence has no default and is genuinely required.
export const insertRecurringTaskSchema = createInsertSchema(recurringTask, {
  cadence: z.enum(CADENCES),
  autoCompleteRule: autoCompleteRuleSchema.optional()
});

export const selectRecurringTaskSchema = createSelectSchema(recurringTask, {
  cadence: z.enum(CADENCES),
  autoCompleteRule: autoCompleteRuleSchema
});
