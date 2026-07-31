/**
 * Fireflies parse worker: fetch the transcript the webhook announced.
 *
 * This is the first handler that PULLS additional data rather than just reading
 * what arrived, so the failure modes are different from the other connectors.
 *
 * ⚠️ The retryable case is the normal one. Fireflies can fire the webhook before
 * the transcript is actually queryable, so a fetch legitimately fails and must
 * be retried later. That path must reach pg-boss's backoff — hence the rethrow.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { transcript } from '@/db/schema';
import type { ParseContext } from '@/lib/queue/registry';
import { loadRawEvent } from '@/lib/queue/registry';
import type { ParseJobData } from '@/lib/queue/types';
import { getTranscript, FirefliesGraphQLError } from './client';
import { firefliesWebhookSchema, type FirefliesTranscript } from './schemas';

/** Fireflies sends epoch millis on `date`, or an ISO string. Neither is guaranteed. */
function toDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export async function handleFirefliesJob(data: ParseJobData, ctx: ParseContext): Promise<void> {
  const row = await loadRawEvent(data.rawEventId);

  if (!row) {
    // Not retryable — a missing row will still be missing next attempt. Return
    // rather than throw, so it does not burn the retry budget for nothing.
    console.warn(
      `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} raw_event ${data.rawEventId} not found — skipping`
    );
    return;
  }

  const envelope = firefliesWebhookSchema.safeParse(row.payload);
  if (!envelope.success) {
    // Off-contract payload. Also not retryable.
    console.warn(
      `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} raw_event ${row.id} is not a Fireflies webhook envelope — skipping`
    );
    return;
  }

  const { meetingId } = envelope.data;

  let fetched: FirefliesTranscript;
  try {
    fetched = await getTranscript(meetingId);
  } catch (err) {
    if (err instanceof FirefliesGraphQLError && err.isNotReady) {
      // EXPECTED, not exceptional: the webhook outran the transcript. Rethrow so
      // pg-boss applies the backoff (60s → ~2m → ~4m) and tries again.
      console.warn(
        `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} transcript ${meetingId} not ready yet — retrying with backoff`
      );
      throw err;
    }
    // Anything else is also rethrown: a rate limit or a transient network error
    // is worth another attempt, and a genuine bug should reach the dead-letter
    // queue rather than being silently swallowed.
    console.error(
      `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} fetch failed for ${meetingId}: ${err instanceof Error ? err.message : err}`
    );
    throw err;
  }

  // Upsert on fireflies_id, which is UNIQUE. This is what makes the fetch
  // idempotent: a retry that succeeds after an earlier partial run, or a
  // backfill re-encountering the meeting, updates rather than duplicating.
  const values = {
    rawEventId: row.id,
    firefliesId: fetched.id,
    title: fetched.title ?? null,
    meetingDate: toDate(fetched.date) ?? toDate(fetched.dateString),
    durationSeconds: typeof fetched.duration === 'number' ? Math.round(fetched.duration) : null,
    payload: fetched,
    fetchedAt: new Date()
  };

  await db
    .insert(transcript)
    .values(values)
    .onConflictDoUpdate({ target: transcript.firefliesId, set: values });

  console.warn(
    `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} stored transcript ${fetched.id} ` +
      `(${fetched.sentences?.length ?? 0} sentences, ${fetched.speakers?.length ?? 0} speakers)`
  );

  // raw_event.processed marks "a parser extracted meaning from this". Fetching
  // the transcript IS that step for Fireflies, so it is set here — unlike the
  // stub handlers, which deliberately leave it false.
  const { rawEvent } = await import('@/db/schema');
  await db.update(rawEvent).set({ processed: true }).where(eq(rawEvent.id, row.id));
}
