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
import type { IngestRawEventInput, IngestResult } from './types';

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
  const { source, payload, receivedAt, externalId } = input;

  const values = {
    source,
    payload,
    externalId: externalId ?? null,
    ...(receivedAt ? { receivedAt } : {})
  };

  // No externalId -> nothing to deduplicate against, so a plain insert.
  if (!values.externalId) {
    const [row] = await db.insert(rawEvent).values(values).returning({ id: rawEvent.id });
    return { inserted: true, id: row.id, duplicate: false };
  }

  const inserted = await db
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
