/**
 * Action-item extraction: transcript → LLM → candidate_action_item rows.
 *
 * Flow: load transcript → build prompt → call LLM → strip fences → Zod-validate
 * → resolve owners → persist (upsert on content_hash).
 *
 * ⚠️ Nothing here writes to a real task system. Every row lands with
 * review_status='pending' and waits for a human. The model's output is a
 * proposal, and the schema is shaped so it cannot be mistaken for a fact.
 */

import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidateActionItem, transcript, unifiedEvent } from '@/db/schema';
import { complete } from '@/lib/ai/client';
import { resolveOwner } from './owner';
import {
  buildExtractionPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  ExtractionParseError,
  parseExtractionResponse,
  type TranscriptLine
} from './prompt';
import { contentHashInput, type ExtractionResult } from './schemas/action-item';

/**
 * Refuse rather than truncate above this.
 *
 * Measured: a real 57-minute meeting is ~8,200 tokens (32,962 chars of speaker
 * lines), against Sonnet 5's 200k context. Even a four-hour meeting fits
 * comfortably, so CHUNKING IS NOT IMPLEMENTED — it would be dead code guarding
 * a case that does not occur, and dead code rots.
 *
 * This guard exists so that if the assumption ever breaks, it breaks LOUDLY.
 * Silently truncating a transcript would drop action items from the end of a
 * meeting with no indication anything was lost, which is far worse than a job
 * that fails and says why.
 */
export const MAX_TRANSCRIPT_CHARS = 400_000; // ≈100k tokens, half the context

export class TranscriptTooLargeError extends Error {
  constructor(chars: number) {
    super(
      `transcript is ${chars.toLocaleString()} chars (≈${Math.round(chars / 4).toLocaleString()} tokens), ` +
        `over the ${MAX_TRANSCRIPT_CHARS.toLocaleString()} char guard. Extraction was NOT attempted — ` +
        `truncating would silently drop action items from the end of the meeting. ` +
        `Implement chunking (see the note in extract.ts) or raise the guard deliberately.`
    );
    this.name = 'TranscriptTooLargeError';
  }
}

export function contentHash(item: { owner_name: string; source_span: string }): string {
  return createHash('sha256').update(contentHashInput(item)).digest('hex');
}

export type TranscriptInput = {
  title: string | null;
  /** ISO yyyy-mm-dd. Null means relative dates cannot be resolved. */
  meetingDate: string | null;
  speakers: string[];
  lines: TranscriptLine[];
};

export type RawExtraction = {
  items: ExtractionResult['items'];
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};

/**
 * Transcript in, validated items out. No database, no persistence.
 *
 * ⚠️ THIS IS THE SEAM THE EVAL HARNESS USES, and that is the whole reason it is
 * a separate function. An eval that builds its own prompt, or calls the model
 * with its own options, measures a pipeline that does not exist — it would go on
 * reporting a good score after a regression in the real one. Both callers go
 * through here, so a change to the prompt, the model tier, or the parse is
 * scored by the next eval run whether or not anyone remembers to update it.
 *
 * Callers supply persistence and owner resolution; scripts/eval-extraction.ts
 * deliberately supplies neither.
 */
export async function extractFromTranscript(
  input: TranscriptInput,
  label: string
): Promise<RawExtraction> {
  const totalChars = input.lines.reduce((a, l) => a + l.speaker.length + l.text.length + 2, 0);
  if (totalChars > MAX_TRANSCRIPT_CHARS) throw new TranscriptTooLargeError(totalChars);

  const prompt = buildExtractionPrompt(input);

  // ⚠️ No `json: true`. OpenRouter's JSON-mode support varies by model and
  // provider route; the prompt asks for bare JSON and parseExtractionResponse
  // strips fences defensively. See prompt.ts.
  const response = await complete({
    tier: 'default',
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt,
    maxTokens: 4096,
    label: `extract:${label}`
  });

  // ⚠️ Throws on a malformed response rather than returning zero items. An empty
  // array is a real answer ("this meeting had none"); garbage is a broken
  // extractor, and conflating them would mark the job done and lose the meeting.
  let parsed;
  try {
    parsed = parseExtractionResponse(response.text);
  } catch (err) {
    if (err instanceof ExtractionParseError) {
      console.error(
        `[extract] ${label} PARSE FAILED: ${err.message} ` +
          `(first 200 chars of response: ${JSON.stringify(err.raw.slice(0, 200))})`
      );
    }
    throw err;
  }

  return {
    items: parsed.items,
    usage: {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      estimatedCostUsd: response.usage.estimatedCostUsd
    }
  };
}

export type ExtractionRunResult = {
  unifiedEventId: string;
  transcriptId: string | null;
  itemsExtracted: number;
  itemsWritten: number;
  itemsUpdated: number;
  ownerBreakdown: Record<string, number>;
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
  skippedReason?: string;
};

type Sentence = { speaker_name?: string | null; text?: string | null };

/**
 * Extract from one unified_event.
 *
 * Keyed on unified_event rather than transcript because that is what the queue
 * carries everywhere else, and because it is the row candidate_action_item
 * references.
 */
export async function extractActionItems(unifiedEventId: string): Promise<ExtractionRunResult> {
  const empty = {
    unifiedEventId,
    transcriptId: null,
    itemsExtracted: 0,
    itemsWritten: 0,
    itemsUpdated: 0,
    ownerBreakdown: {},
    usage: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 }
  };

  const [event] = await db
    .select({
      id: unifiedEvent.id,
      source: unifiedEvent.source,
      eventType: unifiedEvent.eventType,
      subjectId: unifiedEvent.subjectId,
      rawEventId: unifiedEvent.rawEventId
    })
    .from(unifiedEvent)
    .where(eq(unifiedEvent.id, unifiedEventId))
    .limit(1);

  if (!event) return { ...empty, skippedReason: 'unified_event not found' };

  // ⚠️ Joined on subject_id (the fireflies_id), NOT raw_event_id.
  // transcript.raw_event_id is ON DELETE SET NULL, so that link can break;
  // subject_id carries the meeting id and is the stable route.
  const [row] = await db
    .select({
      id: transcript.id,
      title: transcript.title,
      meetingDate: transcript.meetingDate,
      payload: transcript.payload
    })
    .from(transcript)
    .where(eq(transcript.firefliesId, event.subjectId ?? ''))
    .limit(1);

  if (!row) {
    return { ...empty, skippedReason: `no transcript stored for meeting ${event.subjectId}` };
  }

  const payload = row.payload as {
    sentences?: Sentence[];
    speakers?: { name?: string | null }[];
    participants?: string[] | null;
    host_email?: string | null;
  };

  const lines: TranscriptLine[] = (payload.sentences ?? [])
    .map((s) => ({ speaker: s.speaker_name?.trim() || 'Unknown', text: s.text?.trim() ?? '' }))
    .filter((l) => l.text.length > 0);

  if (lines.length === 0) {
    return { ...empty, transcriptId: row.id, skippedReason: 'transcript has no sentences' };
  }

  const meetingDate = row.meetingDate ? row.meetingDate.toISOString().slice(0, 10) : null;
  const speakers = [
    ...new Set((payload.speakers ?? []).map((s) => s.name?.trim()).filter((n): n is string => !!n))
  ];

  const { items: extracted, usage } = await extractFromTranscript(
    { title: row.title, meetingDate, speakers, lines },
    event.subjectId ?? unifiedEventId
  );
  const parsed = { items: extracted };

  const ownerBreakdown: Record<string, number> = {};
  let itemsWritten = 0;
  let itemsUpdated = 0;

  const meetingEmails = [...(payload.participants ?? []), payload.host_email ?? '']
    .filter((e): e is string => Boolean(e))
    .map((e) => e.toLowerCase());

  for (const item of parsed.items) {
    const owner = await resolveOwner({ ownerName: item.owner_name, meetingEmails });
    ownerBreakdown[owner.ownerConfidence] = (ownerBreakdown[owner.ownerConfidence] ?? 0) + 1;

    const hash = contentHash(item);

    const values = {
      unifiedEventId: event.id,
      description: item.description,
      ownerName: item.owner_name,
      ownerPersonId: owner.ownerPersonId,
      ownerConfidence: owner.ownerConfidence,
      dueDate: item.due_date,
      followUps: item.follow_ups,
      confidence: item.confidence,
      sourceSpan: item.source_span,
      contentHash: hash
    };

    // ⚠️ UPSERT on content_hash — re-running must update, never duplicate.
    // review_status / reviewed_by / reviewed_at / edited_fields are NOT in the
    // update set: a re-run must not undo a human's decision. external_task_id
    // is likewise preserved so Day 2's sync is not re-triggered.
    const result = await db
      .insert(candidateActionItem)
      .values(values)
      .onConflictDoUpdate({
        target: candidateActionItem.contentHash,
        set: {
          unifiedEventId: values.unifiedEventId,
          description: values.description,
          ownerName: values.ownerName,
          ownerPersonId: values.ownerPersonId,
          ownerConfidence: values.ownerConfidence,
          dueDate: values.dueDate,
          followUps: values.followUps,
          confidence: values.confidence,
          sourceSpan: values.sourceSpan,
          updatedAt: new Date()
        }
      })
      .returning({
        id: candidateActionItem.id,
        createdAt: candidateActionItem.createdAt,
        updatedAt: candidateActionItem.updatedAt
      });

    const written = result[0];
    if (written && written.createdAt.getTime() === written.updatedAt.getTime()) itemsWritten += 1;
    else itemsUpdated += 1;
  }

  console.warn(
    `[extract] ${event.subjectId} — ${parsed.items.length} item(s): ` +
      `${itemsWritten} new, ${itemsUpdated} updated · owners ` +
      `${
        Object.entries(ownerBreakdown)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ') || 'none'
      } · ` +
      `${usage.promptTokens}in/${usage.completionTokens}out $${usage.estimatedCostUsd.toFixed(5)}`
  );

  return {
    unifiedEventId,
    transcriptId: row.id,
    itemsExtracted: parsed.items.length,
    itemsWritten,
    itemsUpdated,
    ownerBreakdown,
    usage
  };
}

/** Meetings with a stored transcript that have not been extracted from yet. */
export async function findExtractableEvents(limit = 50): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select ue.id
    from unified_event ue
    join transcript t on t.fireflies_id = ue.subject_id
    where ue.source = 'fireflies'
      and ue.event_type <> 'test'
      and not exists (select 1 from candidate_action_item c where c.unified_event_id = ue.id)
    order by ue.occurred_at desc
    limit ${limit}
  `);
  return rows.rows.map((r) => r.id);
}
