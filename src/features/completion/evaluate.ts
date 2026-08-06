import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { recurringTask, unifiedEvent } from '@/db/schema';
import { parseAutoCompleteRule, type AutoCompleteRule } from '@/db/schema/recurring-task';
import { windowStartFor } from '@/lib/completion-window';
import { recordEvidence } from '@/lib/evidence';
import type { AttributionState, EvidenceSource } from '@/db/schema/completion-event';

/**
 * THE COMPLETION EVALUATOR — "did this event satisfy anybody's recurring rule?"
 *
 * Reacts to one `unified_event`. Design §1: a reaction answers "did this get
 * done?"; only the sweep can answer "did this NOT get done", because absence emits
 * nothing.
 *
 * ⚠️ NOT `'use server'`. This is a worker module called from the queue, never from
 * a browser. Publishing it as a Server Action would give anyone an endpoint that
 * writes completion rows.
 */

/** The event fields the matcher needs. Nothing else is read. */
export type EvaluableEvent = {
  id: string;
  source: string;
  eventType: string;
  occurredAt: Date;
  personId: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  metadata: unknown;
};

export type EvaluationOutcome = {
  recurringTaskId: string;
  signal: string;
  windowStart: string;
  attribution: AttributionState;
  /** False when the window already had a completion — normal, not an error. */
  recorded: boolean;
};

/**
 * Does the event satisfy the rule's MATCH clause? Attribution is decided
 * separately by `resolveAttribution` — a match is about the event's shape.
 */
export function matchesRule(event: EvaluableEvent, rule: AutoCompleteRule): boolean {
  if (event.source !== rule.match.source) return false;
  if (event.eventType !== rule.match.eventType) return false;

  const subject = rule.match.subject;
  if (subject?.idIn && (!event.subjectId || !subject.idIn.includes(event.subjectId))) {
    return false;
  }
  if (subject?.labelMatches) {
    // ⚠️ Case-insensitive SUBSTRING, not a regex. A regex in stored config is a
    // ReDoS surface and a debugging problem, and no real case needs one.
    const label = event.subjectLabel?.toLowerCase() ?? '';
    if (!label.includes(subject.labelMatches.toLowerCase())) return false;
  }

  const wanted = rule.match.metadata;
  if (wanted) {
    /**
     * ⚠️ EQUALITY ONLY, and a missing key is a NON-MATCH rather than a wildcard.
     * `metadata` is untyped jsonb written by five different normalisers; treating
     * absent as "anything" would make a rule with a channel filter fire on every
     * message from a source that happens not to record channels.
     */
    if (typeof event.metadata !== 'object' || event.metadata === null) return false;
    const actual = event.metadata as Record<string, unknown>;
    for (const [key, value] of Object.entries(wanted)) {
      if (actual[key] !== value) return false;
    }
  }

  return true;
}

/**
 * Decide whether this event may complete the task, and how it is attributed.
 *
 * ⚠️⚠️ NEVER INFERS THE OWNER. If the event carries `person_id = null`, the
 * completion is `unattributed` — full stop. Writing the task owner's id in would
 * fabricate the single fact this ledger exists to record, and it is the same rule
 * that makes name-matching never an auto-link at any confidence tier.
 *
 * ⚠️ `actor: 'must_be_owner'` ON A ZERO-ATTRIBUTION SOURCE NEVER MATCHES HERE, and
 * that is correct but insufficient on its own — it is silent. `validateRule()`
 * exists to make that visible at configuration time (design §3.5.1); this function
 * is only the runtime half.
 */
export function resolveAttribution(
  event: EvaluableEvent,
  rule: AutoCompleteRule,
  ownerPersonId: string
): { eligible: boolean; attribution: AttributionState } {
  if (rule.actor === 'must_be_owner') {
    // Unattributed events can never satisfy an owner-scoped rule.
    if (!event.personId) return { eligible: false, attribution: 'unattributed' };
    if (event.personId !== ownerPersonId) return { eligible: false, attribution: 'attributed' };
    return { eligible: true, attribution: 'attributed' };
  }

  /**
   * `actor: 'any'` — anyone's matching event closes the window.
   *
   * ⚠️ A REAL WEAKENING, AND IT MUST STAY VISIBLE. The row is stamped
   * `unattributed` when nobody is on the event, and the UI must say "completed by
   * an unattributed signal" rather than showing a name. (§7 decision 5 is still
   * open on whether `any` should be permitted at all on zero-attribution sources;
   * if it lands as "forbidden", this branch is deleted and the validator grows one
   * more rejection — no structural change.)
   */
  return { eligible: true, attribution: event.personId ? 'attributed' : 'unattributed' };
}

/**
 * Evaluate one event against every active rule.
 *
 * ⚠️ RULES ARE LOADED PER CALL, not cached across jobs. The obvious optimisation —
 * an in-process index keyed by `(source, eventType)` — is deliberately NOT done
 * yet: there are five rules and a handful of events a minute, and a stale cache
 * would silently apply a rule an operator has just deleted. Add the index when
 * rule count justifies it, with an invalidation story.
 */
export async function evaluateEvent(unifiedEventId: string): Promise<EvaluationOutcome[]> {
  const [event] = await db
    .select({
      id: unifiedEvent.id,
      source: unifiedEvent.source,
      eventType: unifiedEvent.eventType,
      occurredAt: unifiedEvent.occurredAt,
      personId: unifiedEvent.personId,
      subjectId: unifiedEvent.subjectId,
      subjectLabel: unifiedEvent.subjectLabel,
      metadata: unifiedEvent.metadata
    })
    .from(unifiedEvent)
    .where(eq(unifiedEvent.id, unifiedEventId))
    .limit(1);

  // Not retryable — a missing row will still be missing next attempt. The caller
  // logs and moves on rather than burning the retry ladder.
  if (!event) return [];

  const tasks = await db
    .select({
      id: recurringTask.id,
      ownerPersonId: recurringTask.ownerPersonId,
      cadence: recurringTask.cadence,
      rule: recurringTask.autoCompleteRule,
      createdAt: recurringTask.createdAt
    })
    .from(recurringTask);

  const outcomes: EvaluationOutcome[] = [];

  for (const task of tasks) {
    const rule = parseAutoCompleteRule(task.rule);
    // `{}` means "no rule" — a real, supported configuration, not a bug.
    if (!rule) continue;
    if (!matchesRule(event, rule)) continue;

    const { eligible, attribution } = resolveAttribution(event, rule, task.ownerPersonId);
    if (!eligible) continue;

    /**
     * ⚠️ THE WINDOW COMES FROM THE EVENT'S OWN TIME, never the worker's clock
     * (design §2.4). A queue backlog or a `renormalise` replay would otherwise
     * credit an old signal to today.
     */
    const windowStart = windowStartFor(
      rule.window.cadence,
      event.occurredAt,
      task.createdAt ?? undefined
    );

    const result = await recordEvidence({
      recurringTaskId: task.id,
      windowStart,
      signal: rule.signal,
      // The event's source is where the proof lives. Both vocabularies are TEXT;
      // EVIDENCE_SOURCES is a superset of RAW_EVENT_SOURCES, so this is total.
      evidenceSource: event.source as EvidenceSource,
      // ⚠️ AN ID. Never the subject label, never a summary — see §2.3.
      evidenceRef: event.id,
      completedAt: event.occurredAt,
      attribution
    });

    outcomes.push({
      recurringTaskId: task.id,
      signal: rule.signal,
      windowStart,
      attribution,
      recorded: result.recorded
    });
  }

  return outcomes;
}
