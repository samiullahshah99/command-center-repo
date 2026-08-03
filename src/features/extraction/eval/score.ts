/**
 * Scoring extraction against hand-labelled ground truth.
 *
 * Pure functions, no I/O and no model. The runner (scripts/eval-extraction.ts)
 * does the calling; everything here can be unit-tested with literals, which
 * matters more than usual: a scorer that is subtly wrong reports confident
 * numbers about a pipeline nobody has actually measured, and nothing else in the
 * system will contradict it.
 *
 * ── The four metrics, and why they are not three ────────────────────────────
 *
 *   recall        found / true            did we find what was there?
 *   precision     matched / emitted       is what we found real?
 *   owner acc.    right owner / matched   on the items we DID find, right person?
 *   halluc. rate  ungrounded / emitted    did we make anything up?
 *
 * Precision and hallucination rate overlap but are NOT the same measurement, and
 * collapsing them would hide the failure that matters most:
 *
 *   - A false positive that quotes a real line — "we should probably look at
 *     pricing" — is a JUDGEMENT error. The text exists; the model misread
 *     discussion as commitment. Costs precision, not hallucination.
 *   - A false positive whose source_span appears NOWHERE in the transcript is a
 *     FABRICATION. The model invented the evidence.
 *
 * The first is a prompt-tuning problem. The second means the output cannot be
 * trusted at all, because the quote a reviewer would use to verify the item is
 * itself fictional. They deserve separate numbers, and hallucination can be
 * measured mechanically — no labels needed, just "is this quote in the file?".
 *
 * ── Owner accuracy denominator ──────────────────────────────────────────────
 * MATCHED items only. Scoring owners over all expected items would fold recall
 * failures into the owner number and both metrics would move for the same
 * reason, which makes a regression impossible to place.
 */

export type ExtractedItem = {
  description: string;
  owner_name: string;
  due_date: string | null;
  follow_ups: string[];
  confidence: number;
  source_span: string;
};

export type ExpectedItem = {
  label: string;
  difficulty?: string;
  description: string;
  owner_name: string;
  /** Owner spellings that all count as correct. Falls back to owner_name. */
  owner_acceptable?: string[];
  /**
   * Owner values that are WRONG even though they look plausible.
   *
   * The ambiguous-owner case needs this: "Chris" is right, "Chris Aldabra" is
   * wrong, and no similarity threshold can express that — the invented surname
   * is a near-perfect string match for the thing it must not be.
   */
  owner_must_not_be?: string[];
  due_date: string | null;
  /**
   * Additional due dates that also count as correct.
   *
   * For phrasing where more than one reading is defensible — "same week then",
   * said about work that depends on a delivery later that same week, is either
   * that Friday or an honest null. Encoding one answer as THE answer would make
   * the metric measure conformity to my guess rather than correctness.
   */
  due_date_acceptable?: (string | null)[];
  /** Verbatim substring of the transcript this item must be anchored to. */
  anchor?: string;
  why?: string;
  date_note?: string;
};

export type Trap = { label: string; anchor: string; why: string };

export type ExpectedFile = {
  case_id: string;
  origin: 'synthetic' | 'real';
  meeting_date: string | null;
  notes?: string;
  items: ExpectedItem[];
  must_not_extract?: Trap[];
};

// ── Text comparison ─────────────────────────────────────────────────────────

/** Casefold, strip punctuation, collapse whitespace. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalise(s).split(' ').filter(Boolean);
}

/** Bag-of-words overlap, 0–1, scaled by the SHORTER string. */
export function overlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);

  let shared = 0;
  for (const t of tb) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(t, n - 1);
    }
  }

  // Scaled by the shorter side so a one-line quote still matches a long
  // paraphrase that contains it.
  return shared / Math.min(ta.length, tb.length);
}

/**
 * How close an extracted item is to an expected one, 0–1.
 *
 * The ANCHOR dominates. source_span is required to be a verbatim transcript
 * quote, so it is the only field with a fixed ground truth — the description is
 * the model's own wording and legitimately varies between runs (a re-run of the
 * real extractor produced "Email the updated slide deck" for a commitment it had
 * previously called "Send the revised deck"). Matching primarily on description
 * would score paraphrase quality, not extraction.
 */
export function matchScore(extracted: ExtractedItem, expected: ExpectedItem): number {
  const byDescription = overlap(extracted.description, expected.description);
  if (!expected.anchor) return byDescription;

  const bySpan = Math.max(
    overlap(extracted.source_span, expected.anchor),
    // The model often quotes a wider window than the anchor phrase.
    normalise(extracted.source_span).includes(normalise(expected.anchor)) ? 1 : 0
  );

  return Math.max(bySpan, 0.5 * bySpan + 0.5 * byDescription, 0.6 * byDescription);
}

export const MATCH_THRESHOLD = 0.6;

// ── Grounding ───────────────────────────────────────────────────────────────

/**
 * Is this item's quote actually IN the transcript?
 *
 * ⚠️ Deliberately lenient — it answers "did the model invent its evidence?", not
 * "did it transcribe perfectly". Models normalise filler words, fix punctuation
 * and drop stutters when quoting, and none of that is fabrication. The threshold
 * catches a span assembled from nothing, which is the thing worth alarming on.
 *
 * A false NEGATIVE here (calling a real quote a hallucination) would be the
 * worst outcome: it would send someone hunting a fabrication bug that does not
 * exist. Hence 0.75 on the shorter side rather than exact matching.
 */
export const GROUNDING_THRESHOLD = 0.75;

export function isGrounded(span: string, transcriptText: string): boolean {
  const n = normalise(span);
  if (!n) return false;
  if (normalise(transcriptText).includes(n)) return true;

  // Fall back to a sliding comparison against the transcript's own lines, so a
  // quote spanning two sentences still counts.
  return transcriptText.split('\n').some((line) => overlap(span, line) >= GROUNDING_THRESHOLD);
}

// ── Owner comparison ────────────────────────────────────────────────────────

export function ownerIsCorrect(actual: string, expected: ExpectedItem): boolean {
  const got = normalise(actual);

  // Checked FIRST. A forbidden value can out-score the acceptable one on any
  // similarity measure — "chris aldabra" contains "chris" outright — so an
  // ordering mistake here would silently pass the case this fixture exists for.
  for (const bad of expected.owner_must_not_be ?? []) {
    if (got === normalise(bad)) return false;
  }

  const acceptable = expected.owner_acceptable?.length
    ? expected.owner_acceptable
    : [expected.owner_name];

  return acceptable.some((name) => {
    const want = normalise(name);
    if (got === want) return true;
    // "Elena" for "Elena Vasquez" is correct; the transcript may only ever say
    // the first name. Guarded by owner_must_not_be for the ambiguous case.
    const gotParts = got.split(' ');
    const wantParts = want.split(' ');
    return gotParts[0] === wantParts[0] && (gotParts.length === 1 || wantParts.length === 1);
  });
}

export function dueDateIsCorrect(actual: string | null, expected: ExpectedItem): boolean {
  const accepted = expected.due_date_acceptable ?? [expected.due_date ?? null];
  return accepted.some((d) => (d ?? null) === actual);
}

// ── Scoring one case ────────────────────────────────────────────────────────

export type MatchedPair = {
  expected: ExpectedItem;
  extracted: ExtractedItem;
  score: number;
  ownerCorrect: boolean;
  dueDateCorrect: boolean;
};

export type FalsePositive = {
  extracted: ExtractedItem;
  grounded: boolean;
  /** The labelled trap it tripped, when it tripped a known one. */
  trap?: Trap;
};

export type CaseScore = {
  caseId: string;
  origin: 'synthetic' | 'real';
  matched: MatchedPair[];
  missed: ExpectedItem[];
  falsePositives: FalsePositive[];
  trapsTripped: Trap[];
  trapsAvoided: Trap[];
  counts: {
    expected: number;
    emitted: number;
    matched: number;
    ungrounded: number;
    ownerCorrect: number;
    dueDateCorrect: number;
  };
};

/**
 * Greedy best-first matching between emitted and expected items.
 *
 * Every candidate pair is scored, sorted, and consumed highest-first so each
 * side is used at most once. Not optimal assignment (Hungarian would be), but at
 * these sizes the difference does not arise, and greedy is auditable — you can
 * read the pair list and see why something matched.
 *
 * ⚠️ One-to-one matters: without it, a model that emits the same commitment
 * twice would score two true positives off one expected item and its precision
 * would go UP for duplicating work.
 */
export function scoreCase(
  expectedFile: ExpectedFile,
  emitted: ExtractedItem[],
  transcriptText: string
): CaseScore {
  const pairs: { e: number; x: number; score: number }[] = [];
  expectedFile.items.forEach((exp, e) => {
    emitted.forEach((got, x) => {
      const score = matchScore(got, exp);
      if (score >= MATCH_THRESHOLD) pairs.push({ e, x, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const usedExpected = new Set<number>();
  const usedEmitted = new Set<number>();
  const matched: MatchedPair[] = [];

  for (const p of pairs) {
    if (usedExpected.has(p.e) || usedEmitted.has(p.x)) continue;
    usedExpected.add(p.e);
    usedEmitted.add(p.x);

    const expected = expectedFile.items[p.e];
    const extracted = emitted[p.x];
    matched.push({
      expected,
      extracted,
      score: p.score,
      ownerCorrect: ownerIsCorrect(extracted.owner_name, expected),
      dueDateCorrect: dueDateIsCorrect(extracted.due_date ?? null, expected)
    });
  }

  const missed = expectedFile.items.filter((_, e) => !usedExpected.has(e));

  const traps = expectedFile.must_not_extract ?? [];
  const trapsTripped: Trap[] = [];

  const falsePositives: FalsePositive[] = emitted
    .map((extracted, x) => ({ extracted, x }))
    .filter(({ x }) => !usedEmitted.has(x))
    .map(({ extracted }) => {
      const trap = traps.find(
        (t) =>
          overlap(extracted.source_span, t.anchor) >= MATCH_THRESHOLD ||
          normalise(extracted.source_span).includes(normalise(t.anchor))
      );
      if (trap && !trapsTripped.includes(trap)) trapsTripped.push(trap);
      return { extracted, grounded: isGrounded(extracted.source_span, transcriptText), trap };
    });

  return {
    caseId: expectedFile.case_id,
    origin: expectedFile.origin,
    matched,
    missed,
    falsePositives,
    trapsTripped,
    trapsAvoided: traps.filter((t) => !trapsTripped.includes(t)),
    counts: {
      expected: expectedFile.items.length,
      emitted: emitted.length,
      matched: matched.length,
      ungrounded: falsePositives.filter((f) => !f.grounded).length,
      ownerCorrect: matched.filter((m) => m.ownerCorrect).length,
      dueDateCorrect: matched.filter((m) => m.dueDateCorrect).length
    }
  };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export type Metrics = {
  recall: number | null;
  precision: number | null;
  ownerAccuracy: number | null;
  hallucinationRate: number | null;
  dueDateAccuracy: number | null;
};

/**
 * ⚠️ Every metric is NULLABLE, and null is not zero.
 *
 * A meeting with no true items has no recall — 0/0 is undefined, not 0%. Scoring
 * it as zero would drag the average down for a case the extractor handled
 * perfectly, and the zero-item fixture (case 03) is exactly that case. Reporting
 * "n/a" is the honest answer; a fabricated 0 would make the harness lie in the
 * direction of pessimism, which is no better than lying optimistically.
 */
export function aggregate(cases: CaseScore[]): Metrics {
  const sum = (f: (c: CaseScore) => number) => cases.reduce((a, c) => a + f(c), 0);

  const expected = sum((c) => c.counts.expected);
  const emitted = sum((c) => c.counts.emitted);
  const matched = sum((c) => c.counts.matched);

  return {
    recall: expected === 0 ? null : matched / expected,
    precision: emitted === 0 ? null : matched / emitted,
    ownerAccuracy: matched === 0 ? null : sum((c) => c.counts.ownerCorrect) / matched,
    hallucinationRate: emitted === 0 ? null : sum((c) => c.counts.ungrounded) / emitted,
    dueDateAccuracy: matched === 0 ? null : sum((c) => c.counts.dueDateCorrect) / matched
  };
}

/** Defaults chosen to fail loudly on a real regression, not to flatter a run. */
export const THRESHOLDS = {
  recall: 0.8,
  precision: 0.8,
  ownerAccuracy: 0.9,
  /** Any fabricated evidence at all is a failure. */
  hallucinationRate: 0.0
} as const;

export type ThresholdResult = {
  metric: keyof typeof THRESHOLDS;
  value: number | null;
  threshold: number;
  /** Null metrics do NOT fail — nothing was measured. */
  passed: boolean;
  skipped: boolean;
};

export function checkThresholds(
  m: Metrics,
  thresholds: typeof THRESHOLDS = THRESHOLDS
): ThresholdResult[] {
  return (Object.keys(thresholds) as (keyof typeof THRESHOLDS)[]).map((metric) => {
    const value = m[metric];
    const threshold = thresholds[metric];
    if (value === null) return { metric, value, threshold, passed: true, skipped: true };
    // Hallucination is the only metric where lower is better.
    const passed = metric === 'hallucinationRate' ? value <= threshold : value >= threshold;
    return { metric, value, threshold, passed, skipped: false };
  });
}
