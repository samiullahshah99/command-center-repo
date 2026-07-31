/**
 * Worker registry.
 *
 * The ONLY place that maps a source to its parse handler. Workers are isolated
 * behind this so moving them to a separate Railway service later is a change to
 * the entrypoint, not to any handler.
 *
 * Every handler now normalises: raw_event -> unified_event via
 * src/features/normalise. `raw_event` remains the landing zone and the source of
 * truth; unified_event is derived and can be rebuilt at any time.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { rawEvent, type RawEventSource } from '@/db/schema';
import type { ParseJobData } from './types';

export type ParseContext = {
  jobId: string;
  /** 0 on the first run, 1 on the first retry, and so on. */
  attempt: number;
  source: RawEventSource;
};

export type ParseHandler = (data: ParseJobData, ctx: ParseContext) => Promise<void>;

/**
 * Loads the raw_event row a job refers to.
 *
 * The job carries only an id, so this is where the payload enters the worker —
 * always the CURRENT row, never a snapshot taken when the job was queued.
 */
export async function loadRawEvent(rawEventId: string) {
  const [row] = await db
    .select({
      id: rawEvent.id,
      source: rawEvent.source,
      payload: rawEvent.payload,
      externalId: rawEvent.externalId,
      processed: rawEvent.processed,
      receivedAt: rawEvent.receivedAt
    })
    .from(rawEvent)
    .where(eq(rawEvent.id, rawEventId))
    .limit(1);

  return row ?? null;
}

/**
 * The real handler for every source that has no extra work beyond normalising.
 *
 * Replaces the Day-4 stubs. `processed` now means what it always should have:
 * this row has been mapped into unified_event. normaliseRawEvent sets it, and
 * only when at least one unified row was actually written — an unmappable
 * payload stays false so it remains visible rather than being quietly consumed.
 *
 * Errors are NOT caught here. start-workers.ts wraps every handler call and
 * turns a throw into a failed job with the retry ladder applied, so throwing is
 * the correct way to signal failure and cannot take the process down.
 */
function makeNormaliseHandler(source: RawEventSource): ParseHandler {
  return async (data, ctx) => {
    const row = await loadRawEvent(data.rawEventId);

    if (!row) {
      // Not retryable — a missing row will still be missing next attempt.
      // Throwing would burn all retries and dead-letter it for no reason.
      console.warn(
        `[queue:${source}] job=${ctx.jobId} attempt=${ctx.attempt} raw_event ${data.rawEventId} not found — skipping`
      );
      return;
    }

    const { normaliseRawEvent } = await import('@/features/normalise');
    const result = await normaliseRawEvent(row.id);

    if (result.unmappable) {
      // Left processed=false on purpose: it shows up in the unprocessed queue
      // and can be replayed after the mapping is fixed. Not an error — a payload
      // we do not yet understand is a normal thing to encounter.
      console.warn(
        `[queue:${source}] job=${ctx.jobId} attempt=${ctx.attempt} raw_event=${row.id} carried nothing mappable ` +
          `— left unprocessed for re-normalisation`
      );
      return;
    }

    console.warn(
      `[queue:${source}] job=${ctx.jobId} attempt=${ctx.attempt} normalised raw_event=${row.id} ` +
        `-> ${result.written} unified_event row(s), ${result.attributed} attributed`
    );
  };
}

/**
 * source -> handler. Four normalise straight through; Fireflies additionally
 * pulls the transcript over GraphQL, so it has its own.
 */
export const HANDLERS: Record<RawEventSource, ParseHandler> = {
  slack: makeNormaliseHandler('slack'),
  clickup: makeNormaliseHandler('clickup'),
  // The first REAL handler. Imported lazily so the registry does not pull the
  // Fireflies client (and its Zod schemas) into every module that imports this.
  fireflies: async (data, ctx) => {
    const { handleFirefliesJob } = await import('@/features/connectors/fireflies/worker');
    return handleFirefliesJob(data, ctx);
  },
  ugc: makeNormaliseHandler('ugc'),
  vision: makeNormaliseHandler('vision')
};
