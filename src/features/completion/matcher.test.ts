import { describe, expect, it } from 'vitest';
import type { AutoCompleteRule } from '@/db/schema/recurring-task';
import { matchesRule, resolveAttribution, type EvaluableEvent } from './evaluate';

const OWNER = 'person-owner';
const OTHER = 'person-other';

function event(overrides: Partial<EvaluableEvent> = {}): EvaluableEvent {
  return {
    id: 'evt-1',
    source: 'slack',
    eventType: 'message',
    occurredAt: new Date('2026-08-12T09:00:00Z'),
    personId: OWNER,
    subjectId: null,
    subjectLabel: null,
    metadata: {},
    ...overrides
  };
}

function rule(overrides: Partial<AutoCompleteRule> = {}): AutoCompleteRule {
  return {
    version: 1,
    signal: 'standup_posted',
    match: { source: 'slack', eventType: 'message' },
    actor: 'must_be_owner',
    window: { cadence: 'daily' },
    ...overrides
  };
}

describe('matchesRule — source and event type', () => {
  it('matches on the exact pair', () => {
    expect(matchesRule(event(), rule())).toBe(true);
  });

  it('rejects a different source', () => {
    expect(matchesRule(event({ source: 'vision' }), rule())).toBe(false);
  });

  it('rejects a different event type', () => {
    expect(matchesRule(event({ eventType: 'reaction_added' }), rule())).toBe(false);
  });
});

describe('matchesRule — metadata equality', () => {
  const channelRule = rule({
    match: { source: 'slack', eventType: 'message', metadata: { channel: 'C123' } }
  });

  it('matches when the value is equal', () => {
    expect(matchesRule(event({ metadata: { channel: 'C123' } }), channelRule)).toBe(true);
  });

  it('ignores extra keys on the event', () => {
    expect(matchesRule(event({ metadata: { channel: 'C123', ts: '1' } }), channelRule)).toBe(true);
  });

  /**
   * ⚠️ A MISSING KEY IS A NON-MATCH, NOT A WILDCARD. `metadata` is untyped jsonb
   * written by five different normalisers; treating absent as "anything" would
   * make a channel-scoped rule fire on every message from a source that happens
   * not to record channels.
   */
  it('rejects when the key is absent from the event', () => {
    expect(matchesRule(event({ metadata: {} }), channelRule)).toBe(false);
    expect(matchesRule(event({ metadata: null }), channelRule)).toBe(false);
  });

  it('rejects a different value', () => {
    expect(matchesRule(event({ metadata: { channel: 'C999' } }), channelRule)).toBe(false);
  });

  /**
   * ⚠️ The unfilled placeholder gets NO special treatment in the matcher — it is
   * compared like any other string, so the rule simply never matches. Making it
   * VISIBLE is `validateRule()`'s job, not this one's.
   */
  it('never matches a rule still carrying PENDING_CHANNEL_ID', () => {
    const pending = rule({
      match: { source: 'slack', eventType: 'message', metadata: { channel: 'PENDING_CHANNEL_ID' } }
    });
    expect(matchesRule(event({ metadata: { channel: 'C123' } }), pending)).toBe(false);
  });
});

describe('matchesRule — subject filters', () => {
  it('idIn matches one of the listed ids', () => {
    const r = rule({
      match: { source: 'slack', eventType: 'message', subject: { idIn: ['a', 'b'] } }
    });
    expect(matchesRule(event({ subjectId: 'b' }), r)).toBe(true);
    expect(matchesRule(event({ subjectId: 'c' }), r)).toBe(false);
    expect(matchesRule(event({ subjectId: null }), r)).toBe(false);
  });

  it('labelMatches is a case-insensitive substring, not a regex', () => {
    const r = rule({
      match: { source: 'slack', eventType: 'message', subject: { labelMatches: 'Standup' } }
    });
    expect(matchesRule(event({ subjectLabel: 'Daily standup notes' }), r)).toBe(true);
    expect(matchesRule(event({ subjectLabel: 'Retro' }), r)).toBe(false);
    // A regex metacharacter is matched literally — no ReDoS surface in stored config.
    const dotty = rule({
      match: { source: 'slack', eventType: 'message', subject: { labelMatches: 'a.c' } }
    });
    expect(matchesRule(event({ subjectLabel: 'abc' }), dotty)).toBe(false);
    expect(matchesRule(event({ subjectLabel: 'xa.cx' }), dotty)).toBe(true);
  });
});

describe('resolveAttribution — the D4 trap (design §3.5)', () => {
  it('must_be_owner: the owner’s own event is eligible and attributed', () => {
    expect(resolveAttribution(event(), rule(), OWNER)).toEqual({
      eligible: true,
      attribution: 'attributed'
    });
  });

  it('must_be_owner: somebody else’s event is not eligible', () => {
    expect(resolveAttribution(event({ personId: OTHER }), rule(), OWNER).eligible).toBe(false);
  });

  /**
   * ⚠️⚠️ THE RULE THAT MUST NEVER BE RELAXED. An unattributed event cannot satisfy
   * an owner-scoped rule, and the engine must NOT fall back to assuming the owner.
   * Writing the owner's id in would fabricate the single fact the ledger exists to
   * record — the same principle that makes name-matching never an auto-link at any
   * confidence tier.
   */
  it('must_be_owner: an unattributed event is NEVER credited to the owner', () => {
    const result = resolveAttribution(event({ personId: null }), rule(), OWNER);
    expect(result.eligible).toBe(false);
    expect(result.attribution).toBe('unattributed');
  });

  it('any: an attributed event completes and records who', () => {
    expect(resolveAttribution(event({ personId: OTHER }), rule({ actor: 'any' }), OWNER)).toEqual({
      eligible: true,
      attribution: 'attributed'
    });
  });

  /**
   * ⚠️ A REAL WEAKENING, KEPT VISIBLE. `actor: 'any'` on a zero-attribution source
   * completes for anyone — so the row is stamped `unattributed` and the UI must
   * say "completed by an unattributed signal", never a name.
   */
  it('any: an unattributed event completes but is marked unattributed', () => {
    expect(resolveAttribution(event({ personId: null }), rule({ actor: 'any' }), OWNER)).toEqual({
      eligible: true,
      attribution: 'unattributed'
    });
  });
});
