/**
 * The summary prompt, and the defensive parse of what comes back.
 *
 * ⚠️ NO `response_format` / JSON MODE — same reasoning as extraction. OpenRouter
 * passes structured-output support through inconsistently across models and
 * upstream providers, so the prompt asks for bare JSON, fences are stripped
 * defensively, and Zod is the actual guarantee. See CLAUDE.md.
 */

import { z } from 'zod';

export type PromptItem = {
  title: string;
  project: string;
  status: string;
  dueDate: string | null;
  overdueDays: number | null;
};

export type PromptEvent = {
  source: string;
  eventType: string;
  occurredAt: string;
};

export type SummaryPromptInput = {
  name: string;
  role: string;
  today: string;
  openItems: PromptItem[];
  recentlyCompleted: { title: string; when: string }[];
  events: PromptEvent[];
};

export const SUMMARY_SYSTEM_PROMPT = `You write short status summaries for an internal operations dashboard.

Your reader is a team lead who wants to know how someone's work is going
WITHOUT having to message them. Answer exactly three things, in this order:

  1. What they are carrying right now.
  2. What is at risk or slipping.
  3. What has moved recently.

RULES

1. 2-4 sentences. No preamble, no bullet points, no headings.
2. USE ONLY THE DATA GIVEN. Every claim must trace to a listed item or event.
   Do not infer mood, effort, performance, or intent. Do not speculate about
   causes. Do not compare this person to anyone else.
3. If a section has nothing to report, say so briefly or omit it. Do NOT pad.
   "Three items open, none overdue, no recent activity recorded" is a good
   summary when that is the truth.
4. NEVER invent an item, a date, or an event. If the lists are short, the
   summary is short.
5. Neutral and factual. This is read by the person's colleagues and may be read
   by the person. Describe work, never the worker.
6. Never recommend actions, assign blame, or suggest what the person should do
   next. Describe, don't advise.

OUTPUT FORMAT

Return a BARE JSON OBJECT and nothing else. No markdown fences, no \`\`\`json,
no commentary. The first character must be {.

{ "summary": "string",
  "generated_from": { "item_count": 0, "event_count": 0 } }`;

/**
 * ⚠️ Rules 5 and 6 are the same failure mode twice, and both are load-bearing.
 *
 * A summary that editorialises about the PERSON rather than their WORK — or
 * that starts advising what they should do next — is performance commentary
 * wearing a helpful face. This page is shared, and the person it describes may
 * well read it. The first summary that says someone "seems overloaded" or
 * "should prioritise X" is the one that gets the whole feature switched off.
 */

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const lines: string[] = [`Person: ${input.name} — ${input.role}`, `Today: ${input.today}`, ''];

  lines.push(`OPEN AND IN-PROGRESS ITEMS (${input.openItems.length}):`);
  if (input.openItems.length === 0) lines.push('- none');
  for (const i of input.openItems) {
    const due = i.dueDate ? `due: ${i.dueDate}` : 'due: no date';
    const over = i.overdueDays !== null ? ` | OVERDUE by ${i.overdueDays} days` : '';
    lines.push(`- ${i.title} | project: ${i.project} | status: ${i.status} | ${due}${over}`);
  }

  lines.push('', `RECENTLY COMPLETED (${input.recentlyCompleted.length}):`);
  if (input.recentlyCompleted.length === 0) lines.push('- none');
  for (const c of input.recentlyCompleted) {
    lines.push(`- ${c.title} | completed around ${c.when}`);
  }

  lines.push('', `RECENT OBSERVED ACTIVITY (${input.events.length}):`);
  if (input.events.length === 0) lines.push('- none');
  for (const e of input.events) {
    lines.push(`- ${e.source} | ${e.eventType} | ${e.occurredAt}`);
  }

  lines.push('', 'Write the summary.');
  return lines.join('\n');
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export const summaryResponseSchema = z.object({
  // Required, not defaulted. A missing key must be a loud parse failure, not a
  // silent empty summary — same lesson as extraction's `items`.
  summary: z.string().min(1, 'summary must not be empty'),
  generated_from: z.object({
    item_count: z.number().int().min(0),
    event_count: z.number().int().min(0)
  })
});

export type SummaryResponse = z.infer<typeof summaryResponseSchema>;

export class SummaryParseError extends Error {
  constructor(
    message: string,
    readonly raw: string
  ) {
    // Raw carried on the error, kept OUT of the message — a model response in a
    // log line swamps everything around it.
    super(message);
    this.name = 'SummaryParseError';
  }
}

/** Strip markdown fences a model added despite being told not to. */
export function stripFences(raw: string): string {
  let out = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(out);
  if (fenced) out = fenced[1].trim();

  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  if (first > 0 || (last !== -1 && last < out.length - 1)) {
    if (first !== -1 && last > first) out = out.slice(first, last + 1);
  }
  return out.trim();
}

/**
 * ⚠️ THROWS on anything unparseable. The caller catches and renders the page
 * WITHOUT the card — the profile has to be fully useful with the AI absent.
 * Returning a placeholder string here would put model garbage on screen as if
 * it were a summary.
 */
export function parseSummaryResponse(raw: string): SummaryResponse {
  const cleaned = stripFences(raw);
  if (!cleaned) throw new SummaryParseError('model returned an empty response', raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new SummaryParseError(
      `model response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      raw
    );
  }

  const result = summaryResponseSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new SummaryParseError(
      `model response failed validation at ${issue?.path.join('.') || '(root)'}: ${issue?.message}`,
      raw
    );
  }
  return result.data;
}
