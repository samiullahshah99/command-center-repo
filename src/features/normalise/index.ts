/**
 * raw_event → unified_event.
 *
 * The boundary Week 2's extraction pipeline builds on. Three properties matter
 * more than the mapping code itself:
 *
 *   RE-RUNNABLE  raw_event is the truth; this can be replayed at any time.
 *   IDEMPOTENT   replaying UPSERTS on (raw_event_id, source_seq) — it never
 *                duplicates, and it never changes a unified_event.id, because
 *                the extraction pipeline will reference those ids.
 *   VERSIONED    NORMALISER_VERSION marks which mapping logic produced a row, so
 *                a change can be rolled out over history selectively.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { rawEvent, unifiedEvent, type RawEventSource } from '@/db/schema';
import { resolvePerson } from '@/features/identity/resolve';
import { clickupNormaliser } from './sources/clickup';
import { firefliesNormaliser } from './sources/fireflies';
import { slackNormaliser } from './sources/slack';
import { ugcNormaliser } from './sources/ugc';
import { visionNormaliser } from './sources/vision';
import type { Normaliser } from './types';

/**
 * ⚠️ BUMP THIS whenever a normaliser's OUTPUT changes — a new metadata key, a
 * different subject mapping, a corrected timestamp field.
 *
 * It is what makes a mapping change rollable: after bumping, re-normalise
 * `WHERE normaliser_version < n` to rebuild only the stale rows, and the column
 * shows at a glance which logic produced any given row.
 *
 * v1 — initial mapping for all five sources.
 */
export const NORMALISER_VERSION = 1;

export const NORMALISERS: Record<RawEventSource, Normaliser> = {
  slack: slackNormaliser,
  clickup: clickupNormaliser,
  vision: visionNormaliser,
  ugc: ugcNormaliser,
  fireflies: firefliesNormaliser
};

export type NormaliseResult = {
  /** unified_event rows written or refreshed. */
  written: number;
  /** How many of those got a person_id. */
  attributed: number;
  /** True when the payload carried nothing mappable; the row stays unprocessed. */
  unmappable: boolean;
};

/**
 * Normalise one raw_event and mark it processed.
 *
 * `processed` is set only when at least one unified row was written. An
 * unmappable payload stays false so it remains visible in
 * `WHERE processed = false` rather than being quietly consumed — the same
 * reasoning as storing events verbatim in the first place.
 */
export async function normaliseRawEvent(rawEventId: string): Promise<NormaliseResult> {
  const [row] = await db
    .select({
      id: rawEvent.id,
      source: rawEvent.source,
      payload: rawEvent.payload,
      receivedAt: rawEvent.receivedAt
    })
    .from(rawEvent)
    .where(eq(rawEvent.id, rawEventId))
    .limit(1);

  if (!row) return { written: 0, attributed: 0, unmappable: true };

  const normaliser = NORMALISERS[row.source as RawEventSource];
  if (!normaliser) return { written: 0, attributed: 0, unmappable: true };

  const events = normaliser.normalise(row.payload, { receivedAt: row.receivedAt });
  if (events.length === 0) return { written: 0, attributed: 0, unmappable: true };

  let attributed = 0;

  for (const event of events) {
    // Resolve BEFORE writing, so the row lands with its attribution already set
    // rather than being written null and patched. resolvePerson records the
    // identity either way, so an unresolved actor still reaches the admin queue.
    let personId: string | null = null;
    let personIdentityId: string | null = null;

    if (event.identity) {
      const resolution = await resolvePerson(event.identity);
      personIdentityId = resolution.identityId;
      if (resolution.status === 'resolved') {
        personId = resolution.personId;
        attributed += 1;
      }
    }

    await db
      .insert(unifiedEvent)
      .values({
        rawEventId: row.id,
        sourceSeq: event.sourceSeq,
        source: row.source,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        occurredAtSource: event.occurredAtSource,
        personId,
        personIdentityId,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        subjectLabel: event.subjectLabel,
        metadata: event.metadata,
        normaliserVersion: NORMALISER_VERSION
      })
      .onConflictDoUpdate({
        target: [unifiedEvent.rawEventId, unifiedEvent.sourceSeq],
        set: {
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          occurredAtSource: event.occurredAtSource,
          personId,
          personIdentityId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          subjectLabel: event.subjectLabel,
          metadata: event.metadata,
          normaliserVersion: NORMALISER_VERSION,
          updatedAt: new Date()
        }
        // createdAt is deliberately NOT in the set: it records when the row was
        // FIRST derived, so a re-normalise does not rewrite history.
      });
  }

  await db.update(rawEvent).set({ processed: true }).where(eq(rawEvent.id, row.id));

  return { written: events.length, attributed, unmappable: false };
}

/**
 * Re-attribute events after an identity is linked by hand.
 *
 * The payoff of storing person_identity_id: this is one UPDATE, not a
 * re-normalisation of everything that account ever did.
 */
export async function attributeEventsForIdentity(
  personIdentityId: string,
  personId: string
): Promise<number> {
  const updated = await db
    .update(unifiedEvent)
    .set({ personId, updatedAt: new Date() })
    .where(
      and(
        eq(unifiedEvent.personIdentityId, personIdentityId),
        sql`${unifiedEvent.personId} IS NULL`
      )
    )
    .returning({ id: unifiedEvent.id });

  return updated.length;
}

export { NORMALISERS as normalisers };
export type { NormalisedEvent, Normaliser } from './types';
