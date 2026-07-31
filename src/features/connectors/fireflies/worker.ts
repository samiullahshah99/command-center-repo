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
import { classifyTranscriptFetchError, getTranscript } from './client';
import { PermanentJobError } from '@/lib/queue/types';
import { firefliesWebhookSchema, isFirefliesTestEvent, type FirefliesTranscript } from './schemas';

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

  // ⚠️ v2 envelope: { event, meeting_id, timestamp }. The v1 shape the public
  // docs describe ({ meetingId, eventType, clientReferenceId }) will NOT parse
  // here, by design — we have never received one, and silently accepting both
  // would hide a regression if Fireflies changed the shape again.
  const envelope = firefliesWebhookSchema.safeParse(row.payload);
  if (!envelope.success) {
    // Off-contract payload. Also not retryable.
    console.warn(
      `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} raw_event ${row.id} is not a Fireflies v2 webhook envelope — skipping`
    );
    return;
  }

  const { event, meeting_id: meetingId } = envelope.data;

  // ⚠️ NORMALISE FIRST, FETCH SECOND.
  //
  // The transcript fetch currently fails for every real meeting — the account is
  // on a free plan and transcript(id:) needs Pro — and it throws
  // PermanentJobError. If normalisation ran after it, the event would never
  // reach unified_event at all and the Fireflies feed would look empty rather
  // than "transcribed, transcript unavailable". The two are independent: the
  // webhook told us a meeting happened, which is worth recording whether or not
  // we can also retrieve its contents.
  //
  // normaliseRawEvent sets raw_event.processed itself.
  const { normaliseRawEvent } = await import('@/features/normalise');
  const normalised = await normaliseRawEvent(row.id);
  console.warn(
    `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} normalised raw_event=${row.id} ` +
      `-> ${normalised.written} unified_event row(s)`
  );

  // Setup test deliveries carry meeting_id "test_00000000", which is not a real
  // meeting. Fetching it would fail and be retried 3× against an API capped at
  // 500 requests per DAY, then dead-letter — spending quota and raising a false
  // alarm. The event is already normalised above; stop here.
  if (isFirefliesTestEvent(envelope.data)) {
    console.warn(
      `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} raw_event ${row.id} is a TEST delivery ` +
        `(event=${event} meeting_id=${meetingId}) — no transcript to fetch`
    );
    await markProcessed(row.id);
    return;
  }

  let fetched: FirefliesTranscript;
  try {
    fetched = await getTranscript(meetingId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // ⚠️ Not every failure is worth another API call. The budget is 500 requests
    // per DAY, and the retry ladder spends four of them per meeting. Classify
    // first: elapsed time since the WEBHOOK arrived is what separates "the
    // transcript is still being produced" from "this id will never resolve".
    const verdict = classifyTranscriptFetchError(err, row.receivedAt);

    if (verdict.class === 'permanent') {
      // PermanentJobError is what the worker loop turns into pg-boss's
      // 'deadletter' status, which skips the remaining retries entirely.
      console.error(
        `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} PERMANENT failure for ${meetingId} ` +
          `(${verdict.reason}) — dead-lettering without retry: ${message}`
      );
      throw new PermanentJobError(
        `Fireflies fetch for ${meetingId} cannot succeed (${verdict.reason}): ${message}`,
        { cause: err }
      );
    }

    // TRANSIENT: rethrow unchanged so pg-boss applies the backoff
    // (60s → ~2m → ~4m) and dead-letters on its own once retries run out.
    console.warn(
      `[fireflies:worker] job=${ctx.jobId} attempt=${ctx.attempt} transient failure for ${meetingId} ` +
        `(${verdict.reason}) — retrying with backoff: ${message}`
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
  // the transcript IS that step for Fireflies.
  await markProcessed(row.id);
}

async function markProcessed(rawEventId: string): Promise<void> {
  const { rawEvent } = await import('@/db/schema');
  await db.update(rawEvent).set({ processed: true }).where(eq(rawEvent.id, rawEventId));
}
