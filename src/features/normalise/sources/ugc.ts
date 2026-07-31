/**
 * UGC → unified_event.
 *
 * Real stored payload:
 *   {
 *     "id": "evt_test_35e0…", "type": "creator.approved",
 *     "occurred_at": "2026-07-31T13:06:10.892563Z",
 *     "actor":  { "id": "system", "name": null, "email": null },
 *     "entity": { "type": "creator", "id": "…" } | null,
 *     "summary": "…", "metadata": {…}, "source": "ugc-management"
 *   }
 *
 * ⚠️ UGC names things differently from Vision at every turn: the event type is
 * `type` (Vision: `event`), the actor id is `actor.id` (Vision: `actor.user_id`),
 * and the subject is `entity` (Vision: `subject`). Copying the Vision normaliser
 * would produce a handler that parses nothing and reports no error.
 *
 * ⚠️ `entity` has no label — UGC sends `summary` instead, a display-safe
 * one-liner about the whole event rather than the subject. It goes to metadata,
 * not subject_label, because it is not the subject's name.
 */

import { fromIso, occurredAtOr } from '../time';
import { asRecord, asString, type NormalisedEvent, type Normaliser } from '../types';

/**
 * UGC attributes automated events to a literal actor id of "system".
 *
 * Recording that as an identity would create a person_identity row that can
 * never belong to anyone and would sit in the manual-linking queue forever.
 */
const NON_HUMAN_ACTOR_IDS = new Set(['system', 'unknown', '']);

export const ugcNormaliser: Normaliser = {
  source: 'ugc',

  normalise(payload, ctx): NormalisedEvent[] {
    const p = asRecord(payload);
    if (!p) return [];

    const eventType = asString(p.type);
    if (!eventType) return [];

    const actor = asRecord(p.actor);
    const entity = asRecord(p.entity);
    const actorId = asString(actor?.id);
    const isHuman = actorId !== null && !NON_HUMAN_ACTOR_IDS.has(actorId.toLowerCase());

    const { occurredAt, occurredAtSource } = occurredAtOr(fromIso(p.occurred_at), ctx.receivedAt);

    return [
      {
        sourceSeq: 0,
        eventType,
        occurredAt,
        occurredAtSource,
        identity: isHuman
          ? {
              source: 'ugc',
              externalId: actorId,
              email: asString(actor?.email),
              displayName: asString(actor?.name)
            }
          : null,
        subjectType: asString(entity?.type),
        subjectId: asString(entity?.id),
        // UGC sends no per-entity label.
        subjectLabel: null,
        metadata: {
          ugcEventId: asString(p.id),
          summary: asString(p.summary),
          actorId,
          ...asRecord(p.metadata)
        }
      }
    ];
  }
};
