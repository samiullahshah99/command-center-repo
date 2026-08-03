/**
 * Tests for the scorer.
 *
 * ⚠️ This file matters more than its size suggests. A scorer that is subtly
 * wrong produces confident numbers about a pipeline nobody has measured, and
 * nothing downstream contradicts it — the eval would keep printing 100% through
 * a real regression. Every metric definition here is asserted against a case
 * constructed to break it.
 *
 * No model, no database, no fixtures on disk: literals only.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregate,
  checkThresholds,
  isGrounded,
  matchScore,
  ownerIsCorrect,
  overlap,
  scoreCase,
  THRESHOLDS,
  type ExpectedFile,
  type ExtractedItem
} from './score';

const TRANSCRIPT = [
  'Dana Okonkwo: I will send Marcus the June campaign numbers on August 7th.',
  'Priya Raman: We should probably look at what the competitors are doing.',
  'Chris Aldabra: I will take that one.'
].join('\n');

function item(over: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    description: 'Send Marcus the June campaign numbers',
    owner_name: 'Dana Okonkwo',
    due_date: '2026-08-07',
    follow_ups: [],
    confidence: 0.9,
    source_span: 'I will send Marcus the June campaign numbers on August 7th.',
    ...over
  };
}

const EXPECTED: ExpectedFile = {
  case_id: 'unit',
  origin: 'synthetic',
  meeting_date: '2026-08-03',
  items: [
    {
      label: 'explicit',
      description: 'Send Marcus the June campaign numbers',
      owner_name: 'Dana Okonkwo',
      owner_acceptable: ['Dana Okonkwo', 'Dana'],
      due_date: '2026-08-07',
      anchor: 'I will send Marcus the June campaign numbers on August 7th'
    }
  ],
  must_not_extract: [
    {
      label: 'trap-suggestion',
      anchor: 'We should probably look at what the competitors are doing',
      why: 'suggestion'
    }
  ]
};

describe('overlap', () => {
  it('is 1 for identical text and 0 for disjoint', () => {
    expect(overlap('send the deck', 'send the deck')).toBe(1);
    expect(overlap('send the deck', 'xylophone')).toBe(0);
  });

  it('ignores case and punctuation', () => {
    expect(overlap('Send the deck!', 'send the DECK')).toBe(1);
  });

  it('scales by the shorter side, so a quote matches a longer paraphrase', () => {
    expect(overlap('send the deck', 'I said I would send the deck by Friday')).toBe(1);
  });

  it('does not double-count a repeated word', () => {
    // Without consuming matches, "the the the" would score 1.0 against "the".
    expect(overlap('the the the', 'the')).toBe(1);
    expect(overlap('the', 'the the the')).toBe(1);
    expect(overlap('the the the', 'the deck')).toBeLessThan(1);
  });
});

describe('matchScore', () => {
  it('matches on the anchor even when the model rewords the description', () => {
    // A real re-run produced "Email the updated slide deck" for a commitment it
    // had previously called "Send the revised deck". Matching on description
    // alone would have scored that as a miss AND a false positive.
    const reworded = item({ description: 'Email June figures across to Marcus' });
    expect(matchScore(reworded, EXPECTED.items[0])).toBeGreaterThanOrEqual(0.6);
  });

  it('does not match an unrelated item', () => {
    const unrelated = item({
      description: 'Book the offsite venue',
      source_span: 'Let me book the venue for the offsite'
    });
    expect(matchScore(unrelated, EXPECTED.items[0])).toBeLessThan(0.6);
  });
});

describe('ownerIsCorrect', () => {
  const exp = EXPECTED.items[0];

  it('accepts the full name and the bare first name', () => {
    expect(ownerIsCorrect('Dana Okonkwo', exp)).toBe(true);
    expect(ownerIsCorrect('Dana', exp)).toBe(true);
  });

  it('rejects a different person', () => {
    expect(ownerIsCorrect('Marcus Ellery', exp)).toBe(false);
  });

  it('⚠️ owner_must_not_be beats an otherwise-acceptable first-name match', () => {
    // THE AMBIGUOUS-OWNER CASE. "Chris" is correct; "Chris Aldabra" is an
    // invented surname and must fail — but it shares a first name, so a
    // first-name rule alone would pass it. The forbidden check has to run first.
    const ambiguous = {
      label: 'ambiguous',
      description: 'Write the pricing page copy',
      owner_name: 'Chris',
      owner_acceptable: ['Chris', 'unspecified'],
      owner_must_not_be: ['Chris Aldabra', 'Chris Vandermolen'],
      due_date: null
    };
    expect(ownerIsCorrect('Chris', ambiguous)).toBe(true);
    expect(ownerIsCorrect('Chris Aldabra', ambiguous)).toBe(false);
    expect(ownerIsCorrect('Chris Vandermolen', ambiguous)).toBe(false);
  });
});

describe('isGrounded', () => {
  it('accepts a verbatim quote', () => {
    expect(isGrounded('I will take that one', TRANSCRIPT)).toBe(true);
  });

  it('accepts a quote with tidied punctuation and casing', () => {
    // Models normalise when quoting. That is not fabrication.
    expect(
      isGrounded("I'll send Marcus the June campaign numbers on August 7th!", TRANSCRIPT)
    ).toBe(true);
  });

  it('⚠️ rejects a span that appears nowhere in the transcript', () => {
    expect(isGrounded('I will migrate the database to Postgres 18 by Tuesday', TRANSCRIPT)).toBe(
      false
    );
  });

  it('rejects an empty span', () => {
    expect(isGrounded('   ', TRANSCRIPT)).toBe(false);
  });
});

describe('scoreCase', () => {
  it('scores a clean hit', () => {
    const s = scoreCase(EXPECTED, [item()], TRANSCRIPT);
    expect(s.counts).toMatchObject({ expected: 1, emitted: 1, matched: 1, ungrounded: 0 });
    expect(s.matched[0].ownerCorrect).toBe(true);
    expect(s.matched[0].dueDateCorrect).toBe(true);
    expect(s.trapsTripped).toHaveLength(0);
    expect(s.trapsAvoided).toHaveLength(1);
  });

  it('counts a missed item', () => {
    const s = scoreCase(EXPECTED, [], TRANSCRIPT);
    expect(s.missed).toHaveLength(1);
    expect(s.counts.matched).toBe(0);
  });

  it('identifies WHICH labelled trap a false positive tripped', () => {
    const fp = item({
      description: 'Research competitor activity',
      owner_name: 'Priya Raman',
      due_date: null,
      source_span: 'We should probably look at what the competitors are doing'
    });
    const s = scoreCase(EXPECTED, [item(), fp], TRANSCRIPT);
    expect(s.falsePositives).toHaveLength(1);
    expect(s.trapsTripped.map((t) => t.label)).toEqual(['trap-suggestion']);
    // Grounded: the line IS in the transcript. Bad judgement, not fabrication.
    expect(s.falsePositives[0].grounded).toBe(true);
    expect(s.counts.ungrounded).toBe(0);
  });

  it('⚠️ separates a fabricated item from a merely wrong one', () => {
    // The distinction the two metrics exist for. Both are false positives; only
    // one means the evidence itself was invented.
    const fabricated = item({
      description: 'Migrate the database',
      source_span: 'I will migrate the database to Postgres 18 by Tuesday'
    });
    const s = scoreCase(EXPECTED, [fabricated], TRANSCRIPT);
    expect(s.counts.ungrounded).toBe(1);
    expect(s.falsePositives[0].grounded).toBe(false);
  });

  it('⚠️ one-to-one matching: a duplicated item does not score twice', () => {
    // Without one-to-one, emitting the same commitment twice would produce two
    // true positives from one expected item and precision would RISE for
    // duplicating work.
    const s = scoreCase(EXPECTED, [item(), item()], TRANSCRIPT);
    expect(s.counts.matched).toBe(1);
    expect(s.falsePositives).toHaveLength(1);
    expect(aggregate([s]).precision).toBe(0.5);
  });

  it('flags a wrong owner and a wrong date on an otherwise matched item', () => {
    const s = scoreCase(
      EXPECTED,
      [item({ owner_name: 'Marcus Ellery', due_date: '2026-09-01' })],
      TRANSCRIPT
    );
    expect(s.counts.matched).toBe(1);
    expect(s.counts.ownerCorrect).toBe(0);
    expect(s.counts.dueDateCorrect).toBe(0);
  });

  it('treats null and missing due dates as equal', () => {
    const noDate: ExpectedFile = {
      ...EXPECTED,
      items: [{ ...EXPECTED.items[0], due_date: null }]
    };
    const s = scoreCase(noDate, [item({ due_date: null })], TRANSCRIPT);
    expect(s.counts.dueDateCorrect).toBe(1);
  });
});

describe('aggregate', () => {
  const clean = scoreCase(EXPECTED, [item()], TRANSCRIPT);

  it('computes the four metrics', () => {
    const m = aggregate([clean]);
    expect(m.recall).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.ownerAccuracy).toBe(1);
    expect(m.hallucinationRate).toBe(0);
  });

  it('⚠️ recall is NULL, not zero, for a meeting with no true items', () => {
    // The zero-item fixture. 0/0 is undefined; reporting it as 0% would drag the
    // average down for a case the extractor handled perfectly.
    const zeroCase: ExpectedFile = { ...EXPECTED, items: [], must_not_extract: [] };
    const s = scoreCase(zeroCase, [], TRANSCRIPT);
    const m = aggregate([s]);
    expect(m.recall).toBeNull();
    expect(m.precision).toBeNull();
    expect(m.ownerAccuracy).toBeNull();
  });

  it('⚠️ owner accuracy is denominated on MATCHED items, not expected ones', () => {
    // Otherwise a recall failure would also depress owner accuracy and the two
    // metrics would move together, making a regression impossible to place.
    const twoExpected: ExpectedFile = {
      ...EXPECTED,
      items: [
        EXPECTED.items[0],
        {
          label: 'never-found',
          description: 'Something the model missed entirely',
          owner_name: 'Nobody At All',
          due_date: null,
          anchor: 'a line that was never emitted'
        }
      ]
    };
    const s = scoreCase(twoExpected, [item()], TRANSCRIPT);
    const m = aggregate([s]);
    expect(m.recall).toBe(0.5); // one of two found
    expect(m.ownerAccuracy).toBe(1); // the one we found had the right owner
  });

  it('pools across cases rather than averaging per-case rates', () => {
    // Averaging rates would weight a one-item meeting the same as a ten-item one.
    const a = scoreCase(EXPECTED, [item()], TRANSCRIPT);
    const b = scoreCase(EXPECTED, [], TRANSCRIPT);
    expect(aggregate([a, b]).recall).toBe(0.5);
  });
});

describe('checkThresholds', () => {
  it('fails recall below the floor', () => {
    const r = checkThresholds({
      recall: 0.5,
      precision: 1,
      ownerAccuracy: 1,
      hallucinationRate: 0,
      dueDateAccuracy: 1
    });
    expect(r.find((x) => x.metric === 'recall')?.passed).toBe(false);
  });

  it('⚠️ hallucination is inverted — any fabrication fails', () => {
    const r = checkThresholds({
      recall: 1,
      precision: 1,
      ownerAccuracy: 1,
      hallucinationRate: 0.01,
      dueDateAccuracy: 1
    });
    expect(r.find((x) => x.metric === 'hallucinationRate')?.passed).toBe(false);
    expect(THRESHOLDS.hallucinationRate).toBe(0);
  });

  it('a null metric SKIPS rather than fails', () => {
    // Nothing measured is not the same as measured badly. A zero-item-only run
    // must not report a false failure.
    const r = checkThresholds({
      recall: null,
      precision: null,
      ownerAccuracy: null,
      hallucinationRate: null,
      dueDateAccuracy: null
    });
    expect(r.every((x) => x.skipped && x.passed)).toBe(true);
  });
});
