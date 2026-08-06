import type { RawEventSource } from '@/db/schema/raw-event';
import { PENDING_CHANNEL_ID, type AutoCompleteRule } from '@/db/schema/recurring-task';

/**
 * RULE VALIDATION AND THE COMPUTED STATE VOCABULARY.
 *
 * ⚠️ CLIENT-SAFE — pure functions and constants, no `@/db`. The Automations screen
 * renders these states, so this must be importable from a client component.
 * `@/db/schema/*` is explicitly allowed there (a query builder, no driver).
 *
 * Design §3.5 and §5.1.
 */

/**
 * The computed state of a recurring task's rule (design §5.1).
 *
 * ⚠️ FOUR STATES, and conflating any two is how honest degradation gets lost:
 *
 * - `no_rule`             configured with `{}` — Diane has no expressible source.
 *                         Falls back IMMEDIATELY; never wait for a signal that has
 *                         no sender.
 * - `cannot_fire`         a rule EXISTS but is structurally incapable of matching —
 *                         attribution-blocked, or missing a channel id. The state
 *                         this codebase most needed: previously indistinguishable
 *                         from `awaiting_signal`, i.e. from a person not doing
 *                         their work.
 * - `awaiting_signal`     rule works, window open, nothing yet. Not a problem.
 * - `window_closed_unmet` window ended with no match. Falls back at the boundary.
 */
export const RULE_STATES = [
  'no_rule',
  'cannot_fire',
  'awaiting_signal',
  'window_closed_unmet'
] as const;
export type RuleState = (typeof RULE_STATES)[number];

/** Why a rule cannot fire. Rendered verbatim on the Automations screen. */
export type RuleProblem = {
  code: 'attribution_blocked' | 'channel_id_missing' | 'malformed';
  /** One sentence, written for an operator, naming the audit reference. */
  message: string;
};

export type RuleValidation = {
  ok: boolean;
  problems: RuleProblem[];
};

/**
 * Attribution rate per source, as a fraction 0..1.
 *
 * ⚠️ MEASURED AND PASSED IN, never hardcoded. The rates move as identities are
 * linked — UGC went from 0/128 to 11/146 after a manual linking session — and a
 * constant baked in here would reject a rule that has since become viable, or
 * accept one that has not. The caller queries `unified_event` and supplies this.
 */
export type AttributionRates = Partial<Record<RawEventSource, number>>;

/**
 * Does this rule carry an unfilled placeholder?
 *
 * ⚠️ The matcher gives `PENDING_CHANNEL_ID` no special treatment — it compares it
 * like any other value, so such a rule simply never matches. This function is what
 * turns that silence into a visible "cannot fire", per design §0's warning that a
 * green engine with an empty ledger reads as "nobody did their work".
 */
export function hasPendingPlaceholder(rule: AutoCompleteRule): boolean {
  const metadata = rule.match.metadata;
  if (!metadata) return false;
  return Object.values(metadata).some((v) => v === PENDING_CHANNEL_ID);
}

/**
 * Validate a rule against measured reality.
 *
 * ⚠️ A CONFIG-TIME ERROR, NOT A RUNTIME WARNING. Design §3.5.1 is explicit: this
 * must surface where the rule is configured, not in a log nobody reads. A rule
 * with `actor: 'must_be_owner'` on a zero-attribution source can NEVER complete —
 * not "has not yet", but *cannot*, forever — and on the screen it is
 * indistinguishable from a person who is not doing their work.
 */
export function validateRule(rule: AutoCompleteRule, rates: AttributionRates): RuleValidation {
  const problems: RuleProblem[] = [];

  if (rule.actor === 'must_be_owner') {
    const rate = rates[rule.match.source];
    /**
     * ⚠️ `=== 0`, NOT falsy. An ABSENT rate means "not measured" and must not be
     * treated as zero — that would reject every rule the moment the caller forgot
     * to supply a source's figure, which is a gate that fails on working config
     * and therefore a gate that gets switched off.
     */
    if (rate === 0) {
      problems.push({
        code: 'attribution_blocked',
        message:
          `Cannot fire: no ${rule.match.source} event has ever been attributed to a person ` +
          `(audit D4), and this rule requires the actor to be the task owner. ` +
          `Either link identities for ${rule.match.source}, or set actor to 'any' ` +
          `— which completes on anyone's matching event and is recorded as unattributed.`
      });
    }
  }

  if (hasPendingPlaceholder(rule)) {
    problems.push({
      code: 'channel_id_missing',
      message:
        'Cannot fire — channel id missing. The rule is shaped correctly but carries a ' +
        'placeholder, so no event can match it. Supply the real Slack channel id.'
    });
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The state of an UNCOMPLETED window.
 *
 * ⚠️ TAKES NO `completed` FLAG, DELIBERATELY. The §5.1 vocabulary has no
 * "completed" member — completion is a row in the ledger, not a state of the rule
 * — so a completed task has no answer here and the caller must check the ledger
 * FIRST and only reach this for windows with no completion row.
 *
 * The first version of this function accepted `completedThisWindow` and returned
 * `awaiting_signal` for it, which reads as "still waiting" for work that is
 * already done. A function that returns a plausible wrong answer is worse than one
 * that cannot be called wrongly.
 *
 * ⚠️ `windowClosed` COMES FROM THE SWEEP'S NOTION OF TIME (`isWindowClosed()`),
 * not from the caller guessing with its own clock.
 */
export function ruleStateFor(input: {
  rule: AutoCompleteRule | null;
  validation: RuleValidation | null;
  windowClosed: boolean;
}): RuleState {
  // An empty or malformed rule is `no_rule` — a real, supported configuration.
  if (!input.rule) return 'no_rule';

  // Structural impossibility outranks everything: a rule that cannot fire is not
  // "awaiting" anything, and saying so is the entire point of this state.
  if (input.validation && !input.validation.ok) return 'cannot_fire';

  return input.windowClosed ? 'window_closed_unmet' : 'awaiting_signal';
}

export { PENDING_CHANNEL_ID };
