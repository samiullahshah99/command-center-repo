/**
 * The pipeline contract between webhook ingest and the parsing workers.
 *
 * One queue per connector source. The webhook handler writes the raw event, then
 * enqueues a job naming ONLY that row's id.
 */

import { RAW_EVENT_SOURCES, type RawEventSource } from '@/db/schema';

/**
 * Queue names. One per source, so a poison payload from one platform cannot
 * stall another, and concurrency can be tuned per source later.
 */
export const QUEUE_PREFIX = 'parse';

/**
 * ⚠️ Separator is a DOT, not a colon. pg-boss v12 validates queue names and
 * rejects `:` — "Name can only contain alphanumeric characters, underscores,
 * hyphens, periods, or forward slashes."
 */
export function queueNameFor(source: RawEventSource): string {
  return `${QUEUE_PREFIX}.${source}`;
}

export const ALL_QUEUE_NAMES = RAW_EVENT_SOURCES.map(queueNameFor);

/**
 * Dead-letter queue. pg-boss moves a job here after `retryLimit` is exhausted;
 * nothing consumes it, so entries sit until inspected.
 */
export const DEAD_LETTER_QUEUE = `${QUEUE_PREFIX}.dead-letter`;

/**
 * The ONLY thing a job carries.
 *
 * ⚠️ The raw_event id, never the payload itself. Two reasons:
 *
 *   1. A large payload would then exist in both raw_event and pgboss.job,
 *      doubling storage and creating two versions that can disagree.
 *   2. The worker re-reads at execution time, so a job retried an hour later
 *      sees the current row rather than a stale snapshot.
 */
export type ParseJobData = {
  rawEventId: string;
};

/**
 * Thrown by a handler to mean "this will NEVER succeed — do not retry me".
 *
 * The worker loop turns it into pg-boss's `status: 'deadletter'`, which per the
 * v12 docs "fails the job terminally and routes it straight to the queue's
 * configured dead letter queue, bypassing any remaining retries". That is the
 * supported mechanism; there is no separate no-retry API.
 *
 * ⚠️ Detected by a PROPERTY, not `instanceof`. A handler is loaded through a
 * dynamic import and could in principle come from a second copy of this module,
 * in which case `instanceof` silently returns false and the job would quietly go
 * back to being retried six times — the exact bug this class exists to prevent.
 */
export class PermanentJobError extends Error {
  readonly permanent = true as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export function isPermanentJobError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { permanent?: unknown }).permanent === true
  );
}

export function isParseJobData(v: unknown): v is ParseJobData {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { rawEventId?: unknown }).rawEventId === 'string' &&
    (v as { rawEventId: string }).rawEventId.length > 0
  );
}

export type { RawEventSource };
