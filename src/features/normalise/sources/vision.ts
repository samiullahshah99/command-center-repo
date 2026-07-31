/**
 * Vision → unified_event.
 *
 * Real stored payload:
 *   {
 *     "id": "ea416f04-…", "event": "moodboard.created",
 *     "occurred_at": "2026-07-31T15:01:1…Z",
 *     "actor":   { "user_id": "user_3F…", "name": "…", "role": "admin",
 *                  "email": null, "editor_name": null },
 *     "subject": { "id": "dd4424c3-…", "type": "moodboard", "label": "Week 4" },
 *     "metadata": {…}, "source": "vision", "environment": "production",
 *     "schema_version": …
 *   }
 *
 * ⚠️ `actor.email` is null on EVERY real event so far, so most Vision identities
 * land unresolved. That is expected, not a fault — see resolvePerson().
 *
 * ⚠️ `editor_name` is captured for display and NEVER used to match.
 *
 * ⚠️ `environment` can be production | preview | development and is stored, not
 * filtered. Filtering at ingest would throw away events we cannot get back; a
 * wrong filter downstream is one WHERE clause from being fixed.
 */

import { fromIso, occurredAtOr } from '../time';
import { asRecord, asString, type NormalisedEvent, type Normaliser } from '../types';

export const visionNormaliser: Normaliser = {
  source: 'vision',

  normalise(payload, ctx): NormalisedEvent[] {
    const p = asRecord(payload);
    if (!p) return [];

    const eventType = asString(p.event);
    // No event type means we cannot say what happened; leave it unprocessed and
    // visible rather than inventing a label.
    if (!eventType) return [];

    const actor = asRecord(p.actor);
    const subject = asRecord(p.subject);
    const externalId = asString(actor?.user_id);

    const { occurredAt, occurredAtSource } = occurredAtOr(fromIso(p.occurred_at), ctx.receivedAt);

    return [
      {
        sourceSeq: 0,
        eventType,
        occurredAt,
        occurredAtSource,
        identity: externalId
          ? {
              source: 'vision',
              externalId,
              email: asString(actor?.email),
              displayName: asString(actor?.name),
              editorName: asString(actor?.editor_name)
            }
          : null,
        subjectType: asString(subject?.type),
        subjectId: asString(subject?.id),
        subjectLabel: asString(subject?.label),
        metadata: {
          visionEventId: asString(p.id),
          environment: asString(p.environment),
          actorRole: asString(actor?.role),
          schemaVersion: p.schema_version ?? null,
          ...asRecord(p.metadata)
        }
      }
    ];
  }
};
