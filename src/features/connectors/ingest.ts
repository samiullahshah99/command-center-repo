/**
 * The ONLY write path into raw_event.
 *
 * Every connector calls ingestRawEvent. No connector inserts into the table
 * directly — that is what keeps the idempotency guarantee, the verbatim-payload
 * rule, and any future auditing in one place instead of duplicated four times.
 *
 * ⚠️ This file is deliberately NOT marked 'use server'.
 *
 * Marking it so would publish these functions as Server Actions, giving any
 * browser a callable endpoint that injects rows into raw_event. Callers are
 * route handlers and server-side jobs, which are already server-only and need no
 * such marker.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { rawEvent } from '@/db/schema';
import type { ParseJobOptions } from '@/lib/queue';
import type { IngestRawEventInput, IngestResult } from './types';

/**
 * Either the pooled client or an open transaction. Derived from Drizzle's own
 * transaction callback rather than hand-written, so it cannot drift from the
 * driver's actual type.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/**
 * Insert one inbound event.
 *
 * Idempotent on (source, externalId) when externalId is supplied, enforced by
 * the partial unique index `raw_event_source_external_id_idx`. The dedup is a
 * single `ON CONFLICT DO NOTHING` statement rather than a select-then-insert, so
 * two concurrent deliveries of the same event cannot both land — which matters,
 * because providers retry on any non-2xx and duplicate delivery is routine.
 *
 * When externalId is null or omitted, every call inserts. Postgres treats NULLs
 * as distinct in a unique index, so there is nothing to conflict on.
 */
export async function ingestRawEvent(input: IngestRawEventInput): Promise<IngestResult> {
  return insertRawEvent(db, input);
}

/** The insert itself, against any executor. Shared by ingestRawEvent and ingestAndEnqueue. */
async function insertRawEvent(
  executor: Executor,
  input: IngestRawEventInput
): Promise<IngestResult> {
  const { source, payload, receivedAt, externalId } = input;

  const values = {
    source,
    payload,
    externalId: externalId ?? null,
    ...(receivedAt ? { receivedAt } : {})
  };

  // No externalId -> nothing to deduplicate against, so a plain insert.
  if (!values.externalId) {
    const [row] = await executor.insert(rawEvent).values(values).returning({ id: rawEvent.id });
    return { inserted: true, id: row.id, duplicate: false };
  }

  const inserted = await executor
    .insert(rawEvent)
    .values(values)
    .onConflictDoNothing({
      target: [rawEvent.source, rawEvent.externalId],
      // The index is partial, so the conflict target must carry the same
      // predicate or Postgres cannot match it. In Drizzle's onConflictDoNothing,
      // `where` IS the index predicate (there is no `targetWhere`).
      where: sql`${rawEvent.externalId} IS NOT NULL`
    })
    .returning({ id: rawEvent.id });

  if (inserted.length > 0) {
    return { inserted: true, id: inserted[0].id, duplicate: false };
  }

  // DO NOTHING returns no rows on conflict. Reaching here means the event was
  // already stored, which is a successful no-op, not an error — the caller
  // should still answer the provider with 2xx so it stops retrying.
  return { inserted: false, id: null, duplicate: true };
}

/** What ingestAndEnqueue reports back, on top of the plain ingest result. */
export interface IngestAndEnqueueResult extends IngestResult {
  /** false when the row was a duplicate, so no second job was queued. */
  enqueued: boolean;
}

/**
 * Persist an inbound event AND queue its parse job, atomically.
 *
 * ── Why one transaction ─────────────────────────────────────────────────────
 * The job carries only the raw_event id and the worker re-reads that row, so the
 * job must never be visible before the row. Doing the two as separate statements
 * leaves a window in both directions: enqueue-then-insert lets a worker pick up
 * an id that does not resolve, and insert-then-enqueue loses the job entirely if
 * the process dies in between, leaving a row that is never processed.
 *
 * pg-boss v12 closes the window properly: `send({ db })` accepts an external
 * database, and `fromDrizzle(tx, sql)` adapts an open Drizzle transaction. The
 * job INSERT then joins our transaction. Verified against the live database — a
 * rollback discards row and job together, a commit persists both.
 *
 * ⚠️ The enqueue is gated on `inserted`, NOT on the call succeeding. A duplicate
 * delivery means the row and its job already exist; queuing again would do the
 * work twice for every provider retry, and providers retry routinely.
 *
 * ⚠️ A queue failure therefore ROLLS BACK the insert and throws, so the caller
 * returns 500 and the provider redelivers. That is the right trade for Slack,
 * ClickUp, UGC and Vision, which all retry on a non-2xx. It is the wrong trade
 * for Fireflies, whose retry behaviour is undocumented — that handler keeps its
 * store-then-best-effort-enqueue shape on purpose and does not call this.
 */
export async function ingestAndEnqueue(
  input: IngestRawEventInput & { jobOptions?: ParseJobOptions }
): Promise<IngestAndEnqueueResult> {
  const { jobOptions, ...ingest } = input;

  return db.transaction(async (tx) => {
    const result = await insertRawEvent(tx, ingest);

    if (!result.inserted || !result.id) {
      return { ...result, enqueued: false };
    }

    // Imported lazily so route modules do not pull pg-boss in at module load —
    // `next build` imports every route to collect page data, and the queue must
    // not demand a connection string at build time.
    const [{ sendParseJob }, { fromDrizzle }] = await Promise.all([
      import('@/lib/queue'),
      import('pg-boss')
    ]);

    await sendParseJob(
      ingest.source,
      { rawEventId: result.id },
      { ...jobOptions, db: fromDrizzle(tx, sql) }
    );

    return { ...result, enqueued: true };
  });
}

/**
 * Look up an already-ingested event by its provider id.
 *
 * Not needed for dedup (the insert handles that). Useful for diagnostics: "did
 * we ever receive event X?" is the first question when a provider claims it
 * delivered something.
 */
export async function findRawEventByExternalId(
  source: IngestRawEventInput['source'],
  externalId: string
) {
  const [row] = await db
    .select({
      id: rawEvent.id,
      receivedAt: rawEvent.receivedAt,
      processed: rawEvent.processed
    })
    .from(rawEvent)
    .where(and(eq(rawEvent.source, source), eq(rawEvent.externalId, externalId)))
    .limit(1);

  return row ?? null;
}
