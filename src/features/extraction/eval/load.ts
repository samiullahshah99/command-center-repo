/**
 * Loading eval cases off disk.
 *
 * Two roots, deliberately separate directories rather than a flag on each file:
 *
 *   fixtures/extraction-eval/real/       transcripts from actual meetings
 *   fixtures/extraction-eval/synthetic/  hand-written, planted cases
 *
 * ⚠️ The split is a directory because a mislabelled `origin` field is a
 * reporting error you cannot see. A synthetic score presented as a real one is
 * the specific outcome this harness must not enable, and a path is much harder
 * to get wrong by accident than a string inside a file.
 *
 * `real/` is EMPTY at the time of writing — see fixtures/extraction-eval/README.md
 * for why (the Fireflies paid-plan restriction plus the dedicated-test-account
 * rule leave no usable labelled transcripts). The loader treats that as normal
 * and reports it, rather than failing.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ExpectedFile } from './score';

export const EVAL_ROOT = 'fixtures/extraction-eval';

const sentenceSchema = z.object({
  speaker_name: z.string().nullish(),
  text: z.string().nullish()
});

export const evalTranscriptSchema = z.object({
  id: z.string().min(1),
  origin: z.enum(['synthetic', 'real']),
  title: z.string().nullable(),
  /** ISO yyyy-mm-dd. Relative dates in expected-items.json resolve against it. */
  meeting_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  speakers: z.array(z.object({ name: z.string() })).default([]),
  sentences: z.array(sentenceSchema).min(1)
});

const expectedItemSchema = z.object({
  label: z.string().min(1),
  difficulty: z.string().optional(),
  description: z.string().min(1),
  owner_name: z.string().min(1),
  owner_acceptable: z.array(z.string()).optional(),
  owner_must_not_be: z.array(z.string()).optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  due_date_acceptable: z
    .array(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
    )
    .optional(),
  anchor: z.string().optional(),
  why: z.string().optional(),
  date_note: z.string().optional(),
  identity_note: z.string().optional()
});

export const expectedFileSchema = z.object({
  case_id: z.string().min(1),
  origin: z.enum(['synthetic', 'real']),
  meeting_date: z.string().nullable(),
  notes: z.string().optional(),
  why_this_case_exists: z.string().optional(),
  items: z.array(expectedItemSchema),
  must_not_extract: z
    .array(z.object({ label: z.string(), anchor: z.string(), why: z.string() }))
    .default([])
});

export type EvalTranscript = z.infer<typeof evalTranscriptSchema>;

export type EvalCase = {
  dir: string;
  origin: 'synthetic' | 'real';
  transcript: EvalTranscript;
  expected: ExpectedFile;
  /** "Speaker: text" lines, the same shape the extractor sees. */
  lines: { speaker: string; text: string }[];
  /** The transcript as one blob, for grounding checks. */
  text: string;
};

function loadOne(dir: string, origin: 'synthetic' | 'real'): EvalCase {
  const tPath = join(dir, 'transcript.json');
  const ePath = join(dir, 'expected-items.json');

  for (const p of [tPath, ePath]) {
    if (!existsSync(p)) {
      throw new Error(
        `${dir} is not a complete case: ${p} is missing. Every case needs BOTH ` +
          `transcript.json and expected-items.json — a transcript with no labels ` +
          `cannot be scored, and scoring it as zero would be worse than skipping it.`
      );
    }
  }

  const transcript = evalTranscriptSchema.parse(JSON.parse(readFileSync(tPath, 'utf8')));
  const expected = expectedFileSchema.parse(
    JSON.parse(readFileSync(ePath, 'utf8'))
  ) as ExpectedFile;

  // ⚠️ Both files declare origin, and they must agree with the directory they
  // sit in. Three sources of the same fact is redundant on purpose: this is the
  // field that decides whether a number may be reported as real.
  for (const [what, value] of [
    ['transcript.json', transcript.origin],
    ['expected-items.json', expected.origin]
  ] as const) {
    if (value !== origin) {
      throw new Error(
        `${dir}/${what} declares origin='${value}' but sits under ${origin}/. ` +
          `Refusing to load: a synthetic case reported as real is the one mistake ` +
          `this harness exists to prevent.`
      );
    }
  }

  const lines = transcript.sentences
    .map((s) => ({ speaker: s.speaker_name?.trim() || 'Unknown', text: s.text?.trim() ?? '' }))
    .filter((l) => l.text.length > 0);

  return {
    dir,
    origin,
    transcript,
    expected,
    lines,
    text: lines.map((l) => `${l.speaker}: ${l.text}`).join('\n')
  };
}

export function loadCases(root = EVAL_ROOT): { real: EvalCase[]; synthetic: EvalCase[] } {
  const out: { real: EvalCase[]; synthetic: EvalCase[] } = { real: [], synthetic: [] };

  for (const origin of ['real', 'synthetic'] as const) {
    const originDir = join(root, origin);
    if (!existsSync(originDir)) continue;

    const dirs = readdirSync(originDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(originDir, d.name))
      .toSorted();

    for (const dir of dirs) out[origin].push(loadOne(dir, origin));
  }

  return out;
}
