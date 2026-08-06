import { z } from 'zod';
import { db } from '@/db';
import {
  ATTRIBUTION_STATES,
  completionEvent,
  EVIDENCE_SOURCES,
  type AttributionState,
  type EvidenceSource
} from '@/db/schema/completion-event';

/**
 * THE EVIDENCE MODEL — one shape, designed once for two surfaces.
 *
 * Design §2. The audit's §2.8 warning is explicit: the recurring-completion ledger
 * and Founder offload's "verifiably handed off" must share ONE notion of proof, or
 * they develop two incompatible ones. They do not share a table (§2.5 — that would
 * cost the NOT NULL foreign keys and cascade correctness); they share THIS schema,
 * THIS writer, and the `EVIDENCE_SOURCES` constant.
 *
 * ⚠️ Session B adds the offload table and reuses `evidenceSchema` verbatim. If you
 * find yourself writing a second evidence shape, that is the failure this file
 * exists to prevent.
 */

export const evidenceSchema = z.object({
  /**
   * WHICH rule or criterion was satisfied — `AutoCompleteRule.signal`, or the
   * constant `manual_checkoff`.
   *
   * ⚠️ NEVER MODEL PROSE. Measured at temperature 0, descriptions are reworded on
   * every run and even quoted spans widen and narrow; that already broke
   * `content_hash`, which exact-matches a span the model does not reproduce. A
   * keyed field may only hold something we assigned.
   */
  signal: z.string().min(1),

  /** WHERE the proof lives. */
  evidenceSource: z.enum(EVIDENCE_SOURCES),

  /**
   * POINTER to the proof.
   *
   * ⚠️ ALWAYS AN ID — a `unified_event.id` for a signal completion, a `person.id`
   * for a manual check-off. Never a description, quote, summary or label. If the
   * ledger wants a human-readable line it is RENDERED AT READ TIME from the row
   * this points at, so it cannot drift from what it references.
   */
  evidenceRef: z.string().min(1),

  /**
   * WHEN it happened.
   *
   * ⚠️ THE EVENT'S OWN `occurred_at`, never `now()` (design §2.4). Signals arrive
   * late — webhook retries, queue backlogs, a `renormalise` replaying a fixed
   * parser — and the worker's clock would credit Monday's standup to Wednesday.
   * The day that happens is the day a backlog clears, which is exactly when nobody
   * is looking.
   */
  completedAt: z.date(),

  /**
   * ⚠️⚠️ REQUIRED. NO DEFAULT, AT ANY LAYER.
   *
   * The column dropped its Postgres default so a forgetful writer fails loudly
   * rather than silently recording an ATTRIBUTED completion — `attributed` being
   * the dishonest fallback, since it asserts we know who did the work when we do
   * not. Leaving a `?? 'attributed'` here would have re-opened exactly that hole
   * one layer up, in the layer a future caller actually touches: this is the ONLY
   * writer of `completion_event`, so its TypeScript signature is the real guard.
   *
   * Every caller already decides this explicitly — `resolveAttribution()` returns
   * it, and a manual check-off is attributed by construction.
   */
  attribution: z.enum(ATTRIBUTION_STATES)
});

export type Evidence = z.infer<typeof evidenceSchema>;

export type RecordEvidenceInput = Evidence & {
  recurringTaskId: string;
  /** The civil date from `windowStartFor()`. Half the idempotency key. */
  windowStart: string;
};

export type RecordEvidenceResult = {
  /** False when this window already had a completion — see the note below. */
  recorded: boolean;
  id: string | null;
};

/**
 * THE ONLY WRITER of `completion_event`. Append-only, idempotent.
 *
 * ⚠️⚠️ `ON CONFLICT DO NOTHING`, NEVER `DO UPDATE`. The FIRST qualifying signal is
 * the completion; a second standup message the same day is not better proof of the
 * first. `DO UPDATE` would let a later, weaker signal overwrite the evidence
 * pointer of an earlier, stronger one — and the row is append-only by contract, so
 * a correction is a new row, never an edit.
 *
 * ⚠️ There is NO UPDATE PATH ANYWHERE in the codebase for this table, deliberately.
 * If a completion turns out to be wrong, that is a fact about what we believed at
 * the time; the fix is a new row and a reader that prefers the latest.
 *
 * ⚠️ ONE STATEMENT, never select-then-insert. That is what makes this safe under
 * pg-boss's at-least-once delivery, under a `renormalise` replay, and under a
 * sweep running on two containers — the same reasoning that makes
 * `ingestRawEvent` safe against concurrent duplicate webhook deliveries. The
 * unique index `completion_event_task_window_key` is the actual guarantee; this
 * function is just the one place that relies on it.
 *
 * ⚠️ `recorded: false` IS NOT AN ERROR. It is the normal, expected answer for a
 * duplicate signal, and callers must not log it as a failure or retry it.
 */
export async function recordEvidence(input: RecordEvidenceInput): Promise<RecordEvidenceResult> {
  const evidence = evidenceSchema.parse({
    signal: input.signal,
    evidenceSource: input.evidenceSource,
    evidenceRef: input.evidenceRef,
    completedAt: input.completedAt,
    attribution: input.attribution
  });

  const [row] = await db
    .insert(completionEvent)
    .values({
      recurringTaskId: input.recurringTaskId,
      windowStart: input.windowStart,
      signal: evidence.signal,
      evidenceSource: evidence.evidenceSource,
      evidenceRef: evidence.evidenceRef,
      completedAt: evidence.completedAt,
      attribution: evidence.attribution
    })
    .onConflictDoNothing({
      target: [completionEvent.recurringTaskId, completionEvent.windowStart]
    })
    .returning({ id: completionEvent.id });

  return { recorded: Boolean(row), id: row?.id ?? null };
}

/**
 * A manual check-off (design §5.3).
 *
 * ⚠️ `evidenceRef` IS THE ACTING PERSON'S ID, and it is recorded even when that
 * person is the task's owner. "Diane closed her own window" and "Ardin closed
 * Diane's window" are different facts and the ledger must not flatten them.
 *
 * ⚠️ `evidence_source = 'manual'` IS THE HONEST-DEGRADATION MARKER. It makes "what
 * fraction of completions were self-declared?" one WHERE clause — the metric that
 * says whether the automation is actually working. Without it, "evidenced, never
 * self-declared" quietly becomes "self-declared with no marker".
 *
 * ⚠️ A manual check-off WINS THE WINDOW PERMANENTLY (§7 decision 6, decided). It is
 * a normal write through the same unique index, so a real signal arriving later
 * cannot supersede it. That is append-only working as intended, not a bug.
 *
 * ⚠️ AUTHORISATION IS THE CALLER'S JOB — owner + founder/ops_lead, per §5.2. This
 * function is not a Server Action and performs no role check; do not make it one.
 */
export async function recordManualCheckoff(input: {
  recurringTaskId: string;
  windowStart: string;
  actingPersonId: string;
  completedAt: Date;
}): Promise<RecordEvidenceResult> {
  return recordEvidence({
    recurringTaskId: input.recurringTaskId,
    windowStart: input.windowStart,
    signal: MANUAL_CHECKOFF_SIGNAL,
    evidenceSource: 'manual',
    evidenceRef: input.actingPersonId,
    completedAt: input.completedAt,
    // A human asserted it, so the actor is known by construction.
    attribution: 'attributed'
  });
}

/** The reserved `signal` value for a human check-off. */
export const MANUAL_CHECKOFF_SIGNAL = 'manual_checkoff';

export type { AttributionState, EvidenceSource };
