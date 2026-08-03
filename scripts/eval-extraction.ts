/**
 * Extraction eval harness.
 *
 *   pnpm eval:extraction                 # score every case, real + synthetic
 *   pnpm eval:extraction --only synthetic
 *   pnpm eval:extraction --only real
 *   pnpm eval:extraction --review        # print all fixture content, no model call
 *   pnpm eval:extraction --verbose       # per-item detail
 *
 * Exits non-zero when a metric falls below its threshold (see THRESHOLDS in
 * src/features/extraction/eval/score.ts), so this can gate a change to the
 * prompt or the model slug.
 *
 * ⚠️ READ fixtures/extraction-eval/README.md BEFORE QUOTING A NUMBER FROM THIS.
 * The synthetic cases test the harness and catch regressions. They do NOT
 * measure real-world accuracy, and the runner refuses to print a combined
 * headline figure when the set is synthetic-only.
 */

import { extractFromTranscript } from '@/features/extraction/extract';
import { loadCases, type EvalCase } from '@/features/extraction/eval/load';
import {
  aggregate,
  checkThresholds,
  scoreCase,
  THRESHOLDS,
  type CaseScore,
  type Metrics
} from '@/features/extraction/eval/score';
import { aiSpendSoFar } from '@/lib/ai/client';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const valueOf = (f: string) => {
  const i = args.indexOf(f);
  return i === -1 ? undefined : args[i + 1];
};

const VERBOSE = has('--verbose');
const ONLY = valueOf('--only');

// ── Formatting ──────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v === null ? '   n/a' : `${(v * 100).toFixed(1).padStart(5)}%`);
const bar = (v: number | null, width = 20) => {
  if (v === null) return '·'.repeat(width);
  const filled = Math.round(v * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

function rule(char = '─', width = 78) {
  console.log(char.repeat(width));
}

// ── Review mode: print retained content in full ─────────────────────────────

/**
 * Print every fixture's content verbatim.
 *
 * ⚠️ This prints WHAT WAS KEPT, not a count of what was replaced. A scrub report
 * saying "redacted 3 names, 2 emails" tells you nothing about the sentence that
 * survived it — a previous transcript fixture in this repo retained a person's
 * home city, which passed every mechanical rule because it contained no name and
 * no email address. Only a human reading the retained text catches that, and
 * they can only read it if it is printed.
 */
function review(cases: EvalCase[]): void {
  if (cases.length === 0) {
    console.log('No fixtures to review.\n');
    return;
  }

  for (const c of cases) {
    rule('═');
    console.log(`${c.dir}`);
    console.log(`origin: ${c.origin.toUpperCase()}   meeting_date: ${c.transcript.meeting_date}`);
    console.log(`title:  ${c.transcript.title ?? '(untitled)'}`);
    console.log(`speakers: ${c.transcript.speakers.map((s) => s.name).join(', ') || '(none)'}`);
    rule();

    if (c.origin === 'real') {
      console.log(
        'REAL TRANSCRIPT — read every line below before this is committed.\n' +
          'Names, employers, locations, health, family, money and anything else a\n' +
          'person would not want in a public repo. This repo IS public.\n'
      );
    }

    for (const l of c.lines) console.log(`  ${l.speaker}: ${l.text}`);

    console.log(`\n  --- labelled items (${c.expected.items.length}) ---`);
    for (const i of c.expected.items) {
      console.log(`  [${i.label}] ${i.description}`);
      console.log(`      owner=${i.owner_name}  due=${i.due_date ?? 'null'}`);
      if (i.anchor) console.log(`      anchor: "${i.anchor}"`);
    }

    const traps = c.expected.must_not_extract ?? [];
    console.log(`\n  --- traps, must NOT be extracted (${traps.length}) ---`);
    for (const t of traps) console.log(`  [${t.label}] "${t.anchor}"`);
    console.log();
  }
}

// ── Scorecard ───────────────────────────────────────────────────────────────

function printCase(score: CaseScore, c: EvalCase): void {
  const k = score.counts;
  const flag = score.origin === 'real' ? 'REAL' : 'SYN ';

  console.log(
    `\n[${flag}] ${score.caseId}` +
      `\n       expected ${k.expected}  emitted ${k.emitted}  matched ${k.matched}` +
      `  missed ${score.missed.length}  false+ ${score.falsePositives.length}` +
      (k.ungrounded > 0 ? `  ⚠ UNGROUNDED ${k.ungrounded}` : '')
  );

  if (score.trapsTripped.length > 0) {
    console.log(`       traps: ${score.trapsAvoided.length} avoided, ${score.trapsTripped.length} TRIPPED`);
  } else {
    const total = (c.expected.must_not_extract ?? []).length;
    if (total > 0) console.log(`       traps: all ${total} avoided`);
  }

  if (!VERBOSE) return;

  for (const m of score.matched) {
    // ⚠️ The value actually returned is printed even when it PASSES. A bare
    // "owner ok" hides which of several acceptable answers the model gave, and
    // on the ambiguous-owner case that is the entire finding.
    const owner = `owner ${m.ownerCorrect ? 'ok' : 'WRONG'}="${m.extracted.owner_name}"` +
      (m.ownerCorrect ? '' : ` want "${m.expected.owner_name}"`);
    const date = `date ${m.dueDateCorrect ? 'ok' : 'WRONG'}=${m.extracted.due_date ?? 'null'}` +
      (m.dueDateCorrect ? '' : ` want ${m.expected.due_date ?? 'null'}`);
    console.log(`         ✓ ${m.expected.label.padEnd(34)} ${owner}  ${date}`);
  }
  for (const miss of score.missed) {
    console.log(`         ✗ MISSED  ${miss.label} [${miss.difficulty ?? '?'}] — ${miss.description}`);
  }
  for (const fp of score.falsePositives) {
    const tag = !fp.grounded ? 'HALLUCINATED' : fp.trap ? `trap:${fp.trap.label}` : 'false positive';
    console.log(`         ✗ ${tag}  "${fp.extracted.description}"`);
    console.log(`             span: "${fp.extracted.source_span.slice(0, 90)}"`);
  }
}

function printMetrics(title: string, m: Metrics, caution?: string): void {
  console.log(`\n${title}`);
  rule();
  const rows: [string, number | null, string][] = [
    ['owner accuracy', m.ownerAccuracy, 'right person, on items we found'],
    ['item recall', m.recall, 'true items found'],
    ['precision', m.precision, 'found items that are real'],
    ['hallucination rate', m.hallucinationRate, 'quotes not in the transcript']
  ];
  for (const [label, value, note] of rows) {
    console.log(`  ${label.padEnd(20)} ${pct(value)}  ${bar(value)}  ${note}`);
  }
  console.log(`  ${'due-date accuracy'.padEnd(20)} ${pct(m.dueDateAccuracy)}  ${bar(m.dueDateAccuracy)}  (secondary)`);
  if (caution) console.log(`\n  ${caution}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { real, synthetic } = loadCases();

  const selected =
    ONLY === 'real' ? real : ONLY === 'synthetic' ? synthetic : [...real, ...synthetic];

  if (has('--review')) {
    review(selected);
    return;
  }

  console.log(`\nExtraction eval — ${real.length} real case(s), ${synthetic.length} synthetic`);
  if (real.length === 0) {
    console.log(
      'fixtures/extraction-eval/real/ is EMPTY. See that directory\'s README:\n' +
        '  Fireflies returns a paid-plan error for transcripts the token holder does\n' +
        '  not own, and the dedicated test account required by the security rule has\n' +
        '  no meeting history. Real accuracy is therefore UNMEASURED.'
    );
  }

  if (selected.length === 0) {
    console.log('\nNothing to score.');
    return;
  }

  console.log(`\nRunning ${selected.length} case(s) through the real extractor. This spends credit.`);

  const scores: CaseScore[] = [];
  for (const c of selected) {
    const { items } = await extractFromTranscript(
      {
        title: c.transcript.title,
        meetingDate: c.transcript.meeting_date,
        speakers: c.transcript.speakers.map((s) => s.name),
        lines: c.lines
      },
      `eval:${c.expected.case_id}`
    );

    const score = scoreCase(c.expected, items, c.text);
    scores.push(score);
    printCase(score, c);
  }

  const realScores = scores.filter((s) => s.origin === 'real');
  const synScores = scores.filter((s) => s.origin === 'synthetic');

  console.log();
  rule('═');
  console.log('SCORECARD');

  if (realScores.length > 0) {
    printMetrics(`REAL — ${realScores.length} case(s)`, aggregate(realScores));
  }

  if (synScores.length > 0) {
    printMetrics(
      `SYNTHETIC — ${synScores.length} case(s)`,
      aggregate(synScores),
      '⚠️ HARNESS + REGRESSION SIGNAL ONLY. These transcripts were written to\n' +
        '  contain known answers. They prove the pipeline runs and catch a prompt\n' +
        '  regression; they do NOT estimate accuracy on real meetings, because the\n' +
        '  cases were authored by the same process being tested. Do not report this\n' +
        '  as a real-world figure.'
    );
  }

  // ⚠️ The gate runs on REAL cases when any exist. Synthetic cases cannot be
  // allowed to certify a change on their own — a prompt overfitted to three
  // hand-written meetings would sail through while real accuracy fell.
  const gateOn = realScores.length > 0 ? realScores : synScores;
  const gateLabel = realScores.length > 0 ? 'real' : 'synthetic (no real cases available)';
  const metrics = aggregate(gateOn);
  const results = checkThresholds(metrics);

  console.log();
  rule('═');
  console.log(`THRESHOLD GATE — on ${gateLabel} cases\n`);
  for (const r of results) {
    const status = r.skipped ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
    const cmp = r.metric === 'hallucinationRate' ? '<=' : '>=';
    console.log(
      `  ${status}  ${r.metric.padEnd(20)} ${pct(r.value)} ${cmp} ${pct(r.threshold)}` +
        (r.skipped ? '   (nothing measured)' : '')
    );
  }

  const spend = aiSpendSoFar();
  console.log(
    `\n${spend.calls} model call(s), ${spend.promptTokens} in / ${spend.completionTokens} out, ` +
      `$${spend.usd.toFixed(5)}`
  );

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(`\nFAILED: ${failed.map((f) => f.metric).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll thresholds met.');
  }

  if (realScores.length === 0) {
    console.log(
      '\nReminder: the gate above ran on SYNTHETIC cases because no real ones exist.\n' +
        'A pass here means "no regression against known answers", not "accurate".'
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
