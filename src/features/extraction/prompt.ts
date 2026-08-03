/**
 * The extraction prompt, and the defensive parse of what comes back.
 *
 * ⚠️ NO `response_format` / JSON MODE. OpenRouter passes structured-output
 * support through inconsistently across models and providers — a flag that
 * works on one slug is silently ignored on another, and the failure is a
 * markdown-fenced reply that a strict parser rejects. So the prompt asks for
 * bare JSON explicitly, the response is de-fenced defensively, and Zod is the
 * actual guarantee. Relying on the flag would make the pipeline's correctness
 * depend on a provider routing decision we do not control.
 */

import { extractionResultSchema, type ExtractionResult } from './schemas/action-item';

export type TranscriptLine = { speaker: string; text: string };

export type PromptInput = {
  title: string | null;
  /** Anchors relative dates. ISO date, or null when the meeting date is unknown. */
  meetingDate: string | null;
  speakers: string[];
  lines: TranscriptLine[];
};

export const EXTRACTION_SYSTEM_PROMPT = `You extract action items from meeting transcripts.

An ACTION ITEM is a specific commitment a named person made to do a specific thing.

Extract:
  "I'll send the deck by Friday"            -> commitment, owner, deadline
  "Ardin is going to write the proposal"    -> commitment assigned to a named person
  "I'll follow up with the client Monday"   -> commitment with a deadline

Do NOT extract:
  "We should probably look at X"            -> a suggestion, nobody committed
  "It might be worth redesigning the flow"  -> an idea
  "Someone needs to fix the build"          -> no named owner
  "We talked about hiring"                  -> a topic, not a commitment
  "How's the deck going?"                   -> a question
  "Yeah that makes sense"                   -> agreement, no commitment

The distinction is whether a specific person took on a specific piece of work.
Discussion, opinions, questions and topics are not action items however
important they sound.

RULES

1. RETURN AN EMPTY ARRAY WHEN THERE ARE NO ACTION ITEMS.
   Many meetings contain none. An empty array is a correct, useful answer.
   Inventing plausible-sounding items to appear thorough is the single worst
   thing you can do here: every item is reviewed by a human, and fabricated
   ones destroy their trust in all of them.

2. source_span must QUOTE THE TRANSCRIPT VERBATIM.
   Copy the exact words the commitment was made in — not a summary, not a
   paraphrase. A reviewer uses this to verify the item against the recording.
   Include enough surrounding words to make it checkable (roughly one sentence).
   If you cannot quote it, you did not find it: leave it out.

3. owner_name is THE NAME AS SPOKEN IN THE TRANSCRIPT.
   Use the speaker label or the name said aloud. Do NOT guess an email, an
   employee id, or a full legal name. If someone says "I'll do it", the owner is
   the speaker of that line.

4. due_date is YYYY-MM-DD, resolved against the meeting date, or null.
   "by Friday" -> the next Friday on or after the meeting date.
   "next week" -> ambiguous. Return null.
   "end of month" -> the last day of the meeting's month.
   "soon", "later", "when I get a chance" -> null.
   When you are not confident, RETURN NULL. A wrong date is worse than none.

5. confidence is your own 0-1 estimate that this is a real commitment.
   Be honest. Low confidence is useful signal; false confidence is not.

6. follow_ups: dependent items mentioned alongside, as short strings. Usually [].

OUTPUT FORMAT

Return a BARE JSON OBJECT and nothing else. No markdown fences, no \`\`\`json,
no commentary before or after. The very first character must be {.

{
  "items": [
    {
      "description": "string - what they committed to do",
      "owner_name": "string - name as spoken",
      "due_date": "YYYY-MM-DD or null",
      "follow_ups": ["string"],
      "confidence": 0.0,
      "source_span": "string - verbatim quote from the transcript"
    }
  ]
}`;

export function buildExtractionPrompt(input: PromptInput): string {
  const header = [
    `Meeting: ${input.title ?? '(untitled)'}`,
    input.meetingDate
      ? `Meeting date: ${input.meetingDate} (resolve relative dates against this)`
      : 'Meeting date: UNKNOWN — return null for any relative date, do not guess',
    input.speakers.length > 0 ? `Speakers: ${input.speakers.join(', ')}` : null
  ]
    .filter(Boolean)
    .join('\n');

  const body = input.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');

  return `${header}\n\n--- TRANSCRIPT ---\n${body}\n--- END TRANSCRIPT ---\n\nExtract the action items as JSON.`;
}

export class ExtractionParseError extends Error {
  constructor(
    message: string,
    readonly raw: string
  ) {
    // The raw response is carried on the error but NOT put in the message: it
    // can be thousands of characters and would swamp a log line. A caller that
    // wants it can reach for .raw deliberately.
    super(message);
    this.name = 'ExtractionParseError';
  }
}

/**
 * Strip markdown fences a model added despite being told not to.
 *
 * Handles ```json … ```, bare ``` … ```, and leading prose before the first {.
 * Defensive rather than trusting: models comply with "no fences" most of the
 * time, and the failure is total when they do not.
 */
export function stripFences(raw: string): string {
  let out = raw.trim();

  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(out);
  if (fenced) out = fenced[1].trim();

  // Some models prepend "Here is the JSON:". Take from the first brace to the
  // last, which is the JSON object even with prose either side.
  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  if (first > 0 || (last !== -1 && last < out.length - 1)) {
    if (first !== -1 && last > first) out = out.slice(first, last + 1);
  }

  return out.trim();
}

/**
 * Parse and validate a model response.
 *
 * ⚠️ THROWS on anything unparseable. It must never return `{items: []}` for a
 * malformed response: an empty array is a meaningful answer ("this meeting had
 * no action items") and conflating it with "the model returned garbage" would
 * make a broken extractor indistinguishable from a quiet meeting — and the job
 * would be marked done.
 */
export function parseExtractionResponse(raw: string): ExtractionResult {
  const cleaned = stripFences(raw);

  if (!cleaned) {
    throw new ExtractionParseError('model returned an empty response', raw);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new ExtractionParseError(
      `model response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      raw
    );
  }

  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ExtractionParseError(
      `model response failed validation at ${issue?.path.join('.') || '(root)'}: ${issue?.message}`,
      raw
    );
  }

  return result.data;
}
