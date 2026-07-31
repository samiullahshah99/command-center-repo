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
 * Placeholder handler shared by every source.
 *
 * Deliberately does NOT set `processed = true`: that flag means "a parser has
 * extracted meaning from this", and nothing has. Flipping it now would make the
 * backlog look drained when it is not.
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

    console.warn(
      `[queue:${source}] job=${ctx.jobId} attempt=${ctx.attempt} loaded raw_event=${row.id} externalId=${row.externalId ?? 'null'} — no parser yet, leaving processed=false`
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
  fireflies: makeStubHandler('fireflies'),
  ugc: makeStubHandler('ugc'),
  vision: makeStubHandler('vision')
};
