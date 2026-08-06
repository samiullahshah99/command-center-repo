import { describe, expect, it } from 'vitest';
import { PENDING_CHANNEL_ID, type AutoCompleteRule } from '@/db/schema/recurring-task';
import {
  hasPendingPlaceholder,
  ruleStateFor,
  validateRule,
  type AttributionRates
} from './completion-rule';

const workingRule: AutoCompleteRule = {
  version: 1,
  signal: 'briefs_submitted',
  match: { source: 'vision', eventType: 'brief.submitted' },
  actor: 'must_be_owner',
  window: { cadence: 'weekly' }
};

/** The measured rates from audit D4. */
const RATES: AttributionRates = {
  slack: 0.909,
  clickup: 0.5,
  vision: 0.434,
  ugc: 0,
  fireflies: 0
};

describe('validateRule — attribution (design §3.5.1)', () => {
  it('accepts must_be_owner on a source that attributes', () => {
    expect(validateRule(workingRule, RATES).ok).toBe(true);
  });

  /**
   * ⚠️ THE HEADLINE CASE. A `must_be_owner` rule on Fireflies (0% attributed) can
   * NEVER complete — not "has not yet", but cannot, forever — and on screen it is
   * indistinguishable from a person not doing their work. Design §3.5.1 requires
   * this to be a CONFIG-TIME error, not a log line.
   */
  it.each(['fireflies', 'ugc'] as const)(
    'rejects must_be_owner on %s, which has never attributed an event',
    (source) => {
      const rule: AutoCompleteRule = { ...workingRule, match: { source, eventType: 'anything' } };
      const result = validateRule(rule, RATES);

      expect(result.ok).toBe(false);
      expect(result.problems[0].code).toBe('attribution_blocked');
      // The message must name the audit reference and the way out.
      expect(result.problems[0].message).toMatch(/audit D4/);
      expect(result.problems[0].message).toMatch(/actor to 'any'/);
    }
  );

  it('allows actor:any on a zero-attribution source (§7 decision 5: allow with marker)', () => {
    const rule: AutoCompleteRule = {
      ...workingRule,
      match: { source: 'fireflies', eventType: 'meeting.transcribed' },
      actor: 'any'
    };
    expect(validateRule(rule, RATES).ok).toBe(true);
  });

  /**
   * ⚠️ `=== 0`, NOT FALSY. An absent rate means "not measured", and treating it as
   * zero would reject working config the moment a caller forgot a source — a gate
   * that fails on working code is a gate that gets switched off.
   */
  it('does NOT reject when a source has no measured rate at all', () => {
    const rule: AutoCompleteRule = {
      ...workingRule,
      match: { source: 'clickup', eventType: 'taskUpdated' }
    };
    expect(validateRule(rule, {}).ok).toBe(true);
  });

  it('treats a genuinely-zero rate differently from an absent one', () => {
    const rule: AutoCompleteRule = {
      ...workingRule,
      match: { source: 'ugc', eventType: 'creator.approved' }
    };
    expect(validateRule(rule, {}).ok).toBe(true);
    expect(validateRule(rule, { ugc: 0 }).ok).toBe(false);
  });
});

describe('validateRule — the unfilled placeholder', () => {
  const pending: AutoCompleteRule = {
    version: 1,
    signal: 'standup_posted',
    match: {
      source: 'slack',
      eventType: 'message',
      metadata: { channel: PENDING_CHANNEL_ID }
    },
    actor: 'must_be_owner',
    window: { cadence: 'daily' }
  };

  it('detects the placeholder', () => {
    expect(hasPendingPlaceholder(pending)).toBe(true);
    expect(hasPendingPlaceholder(workingRule)).toBe(false);
  });

  /**
   * ⚠️ The matcher gives the placeholder no special treatment — such a rule simply
   * never matches. Without this validation it would sit on the Automations screen
   * looking healthy while silently never completing, which design §0 names as the
   * failure that reads like "nobody did their work".
   */
  it('reports "cannot fire — channel id missing"', () => {
    const result = validateRule(pending, RATES);
    expect(result.ok).toBe(false);
    expect(result.problems[0].code).toBe('channel_id_missing');
    expect(result.problems[0].message).toMatch(/Cannot fire/);
  });

  it('reports BOTH problems when a rule is attribution-blocked and unfilled', () => {
    const doubly: AutoCompleteRule = {
      ...pending,
      match: { source: 'ugc', eventType: 'creator.approved', metadata: { c: PENDING_CHANNEL_ID } }
    };
    const codes = validateRule(doubly, RATES).problems.map((p) => p.code);
    expect(codes).toEqual(['attribution_blocked', 'channel_id_missing']);
  });
});

describe('ruleStateFor — the §5.1 vocabulary', () => {
  it('an absent rule is no_rule, which is a supported configuration', () => {
    expect(ruleStateFor({ rule: null, validation: null, windowClosed: false })).toBe('no_rule');
  });

  /**
   * ⚠️ `cannot_fire` OUTRANKS everything. A rule that is structurally incapable of
   * matching is not "awaiting" anything, and separating the two is the entire
   * reason this state exists.
   */
  it('an invalid rule is cannot_fire, even mid-window', () => {
    expect(
      ruleStateFor({
        rule: workingRule,
        validation: { ok: false, problems: [{ code: 'channel_id_missing', message: 'x' }] },
        windowClosed: false
      })
    ).toBe('cannot_fire');
  });

  it('a working rule mid-window is awaiting_signal', () => {
    expect(
      ruleStateFor({
        rule: workingRule,
        validation: { ok: true, problems: [] },
        windowClosed: false
      })
    ).toBe('awaiting_signal');
  });

  it('a working rule whose window closed unmet falls back', () => {
    expect(
      ruleStateFor({
        rule: workingRule,
        validation: { ok: true, problems: [] },
        windowClosed: true
      })
    ).toBe('window_closed_unmet');
  });
});
