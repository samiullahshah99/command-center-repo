/**
 * Summary generation, with the two-gate cache.
 *
 *   input_hash unchanged        -> serve cache, whatever its age
 *   hash changed, < TTL old     -> serve cache; the rate cap wins
 *   hash changed, >= TTL old    -> regenerate
 *   force (manual regenerate)   -> bypass both, but STILL write the hash, so the
 *                                  next automatic check behaves normally
 *
 * The TTL is what guarantees at most one LLM call per person per hour. The hash
 * is what stops a pointless call when the hour lapses and nothing has moved —
 * the common case on a small roster, and why this costs cents.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { aiSummary, SUMMARY_TTL_MS } from '@/db/schema';
import { complete } from '@/lib/ai/client';
import {
  buildSummaryPrompt,
  parseSummaryResponse,
  SUMMARY_SYSTEM_PROMPT,
  SummaryParseError,
  type SummaryPromptInput
} from './prompt';
import type { SummaryCard } from '../api/types';

/**
 * Fingerprint of everything the prompt is built from.
 *
 * Only the fields a summary could legitimately change on: an item's title,
 * status or due date, and which events exist. Deliberately NOT updated_at —
 * a touch that changes nothing observable must not burn a call.
 */
export function summaryInputHash(input: SummaryPromptInput): string {
  const canonical = JSON.stringify({
    items: input.openItems.map((i) => `${i.title}|${i.status}|${i.dueDate ?? ''}`).toSorted(),
    done: input.recentlyCompleted.map((c) => c.title).toSorted(),
    events: input.events.map((e) => `${e.source}|${e.eventType}|${e.occurredAt}`).toSorted()
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function toCard(row: typeof aiSummary.$inferSelect, cached: boolean): SummaryCard {
  return {
    summary: row.summary,
    itemCount: row.itemCount,
    eventCount: row.eventCount,
    generatedAt: row.generatedAt.toISOString(),
    model: row.model,
    cached
  };
}

export type SummaryOutcome =
  | { card: SummaryCard; unavailable: null }
  | { card: null; unavailable: 'no_data' | 'error' };

/**
 * Get (or make) the summary for one person.
 *
 * ⚠️ NEVER THROWS. A failure here must not take the profile down — the page has
 * to be fully useful with the card absent, so every failure path returns
 * `unavailable` and the caller renders without it.
 */
export async function getOrCreateSummary(
  personId: string,
  input: SummaryPromptInput,
  opts: { force?: boolean } = {}
): Promise<SummaryOutcome> {
  const itemCount = input.openItems.length + input.recentlyCompleted.length;
  const eventCount = input.events.length;

  // ⚠️ THE ZERO GUARD, in code as well as in the prompt.
  //
  // With nothing to summarise the model has nothing to be faithful to, and a
  // "write a summary" instruction against empty lists is an invitation to
  // invent one. Rule 3 tells it to be brief; this makes the call impossible.
  // Cheaper too, but correctness is the reason.
  if (itemCount + eventCount === 0) {
    return { card: null, unavailable: 'no_data' };
  }

  const hash = summaryInputHash(input);

  const [existing] = await db
    .select()
    .from(aiSummary)
    .where(eq(aiSummary.personId, personId))
    .limit(1);

  if (existing && !opts.force) {
    // Gate one: nothing has changed, so there is nothing new to say.
    if (existing.inputHash === hash) return { card: toCard(existing, true), unavailable: null };

    // Gate two: something changed, but we already spent this hour's call.
    const ageMs = Date.now() - existing.generatedAt.getTime();
    if (ageMs < SUMMARY_TTL_MS) return { card: toCard(existing, true), unavailable: null };
  }

  let parsed;
  let usage;
  let model: string;
  try {
    const response = await complete({
      tier: 'default',
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: buildSummaryPrompt(input),
      maxTokens: 512,
      label: `summary:${input.name}`
    });
    model = response.model;
    usage = response.usage;
    parsed = parseSummaryResponse(response.text);
  } catch (err) {
    if (err instanceof SummaryParseError) {
      console.error(
        `[summary] ${input.name} PARSE FAILED: ${err.message} ` +
          `(first 200 chars: ${JSON.stringify(err.raw.slice(0, 200))})`
      );
    } else {
      console.error(
        `[summary] ${input.name} generation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    // Fall back to a stale cached summary rather than nothing — an hour-old
    // summary labelled with its real timestamp beats an empty card.
    if (existing) return { card: toCard(existing, true), unavailable: null };
    return { card: null, unavailable: 'error' };
  }

  const values = {
    personId,
    summary: parsed.summary,
    // OUR counts, not the model's. `generated_from` is asked for so the model
    // has to look at the lists, but it is not trusted as a source of truth.
    itemCount,
    eventCount,
    inputHash: hash,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.estimatedCostUsd,
    generatedAt: new Date()
  };

  const [written] = await db
    .insert(aiSummary)
    .values(values)
    .onConflictDoUpdate({ target: aiSummary.personId, set: values })
    .returning();

  return { card: toCard(written, false), unavailable: null };
}
