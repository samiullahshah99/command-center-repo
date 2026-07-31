/**
 * Worker registry.
 *
 * The ONLY place that maps a source to its parse handler. Workers are isolated
 * behind this so moving them to a separate Railway service later is a change to
 * the entrypoint, not to any handler.
 *
 * ⚠️ No parsing logic lives here or in any handler yet. `raw_event` is a landing
 * zone and parsing is a deliberately separate, later stage — these are stubs that
 * prove the pipeline end to end without inventing a domain model.
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
 * Placeholder handler shared by every source. No parsing — that is Day 5.
 *
 * ⚠️ `processed` means "a worker has handled this row", NOT "a parser extracted
 * meaning from it". Those were the same thing while the only real handler was
 * Fireflies; they are not the same now that stubs set the flag.
 *
 * The trade was made deliberately: leaving it false makes a working pipeline
 * indistinguishable from a broken one, because the flag is the only end-to-end
 * evidence that a job ran. The cost is that Day 5 must reset `processed = false`
 * for the sources it implements before the real parser can pick those rows up —
 * `scripts/backfill-queue.ts --force` re-queues regardless of the flag.
 *
 * Errors are NOT caught here. start-workers.ts wraps every handler call and
 * converts a throw into a failed job with the retry ladder applied, so throwing
 * is the correct way to signal failure and cannot take the process down.
 */
function makeStubHandler(source: RawEventSource): ParseHandler {
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

    await db.update(rawEvent).set({ processed: true }).where(eq(rawEvent.id, row.id));

    console.warn(
      `[queue:${source}] job=${ctx.jobId} attempt=${ctx.attempt} handled raw_event=${row.id} ` +
        `externalId=${row.externalId ?? 'null'} — stub, no parsing; processed=true`
    );
  };
}

/**
 * source -> handler. Replace a stub here when that source's parser is written;
 * nothing else changes.
 */
export const HANDLERS: Record<RawEventSource, ParseHandler> = {
  slack: makeStubHandler('slack'),
  clickup: makeStubHandler('clickup'),
  // The first REAL handler. Imported lazily so the registry does not pull the
  // Fireflies client (and its Zod schemas) into every module that imports this.
  fireflies: async (data, ctx) => {
    const { handleFirefliesJob } = await import('@/features/connectors/fireflies/worker');
    return handleFirefliesJob(data, ctx);
  },
  ugc: makeStubHandler('ugc'),
  vision: makeStubHandler('vision')
};
