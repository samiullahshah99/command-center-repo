/**
 * ClickUp → unified_event.
 *
 * Real stored payload:
 *   {
 *     "event": "taskUpdated", "task_id": "86eyf1rk1",
 *     "team_id": "90182930145", "webhook_id": "b232…",
 *     "history_items": [
 *       { "id": "5195800349454056527", "date": "1785489973755", "field": "status",
 *         "user": { "id": 228140872, "email": "…", "username": "…" },
 *         "before": {...}, "after": {...} }
 *     ]
 *   }
 *
 * ⚠️ ClickUp is the ONLY source that carries the actor email inline
 * (`history_items[].user.email`), so its identities resolve automatically from
 * events alone — no backfill call needed.
 *
 * ⚠️ `history_items` is an ARRAY and ClickUp may batch several changes into one
 * webhook. Every payload we have holds exactly one, but this emits one event per
 * item with source_seq set accordingly, so a batched delivery does not collapse
 * into a single row that loses the other changes.
 *
 * ⚠️ `user.id` is a JSON NUMBER; external ids are text everywhere else. asString
 * stringifies it. Comparing a number id to a stored string id silently matches
 * nothing.
 *
 * ⚠️ `date` is epoch millis AS A STRING. `new Date("1785489973755")` is Invalid
 * Date — see time.ts.
 */

import { fromEpochMillis, occurredAtOr } from '../time';
import { asRecord, asString, type NormalisedEvent, type Normaliser } from '../types';

/** ClickUp's automation/bot actor. Not a person, so not an identity. */
const NON_HUMAN_USER_IDS = new Set(['-1', '0']);

export const clickupNormaliser: Normaliser = {
  source: 'clickup',

  normalise(payload, ctx): NormalisedEvent[] {
    const p = asRecord(payload);
    if (!p) return [];

    const eventType = asString(p.event);
    if (!eventType) return [];

    const taskId = asString(p.task_id);
    const items = Array.isArray(p.history_items) ? p.history_items : [];

    const base = {
      eventType,
      subjectType: 'task' as const,
      subjectId: taskId,
      // ClickUp webhooks carry no task name — only the id. Reading it would mean
      // an API call per event, and CLAUDE.md forbids mirroring ClickUp content
      // anyway: ClickUp is the system of record, so the title is read from there.
      subjectLabel: null
    };

    // taskDeleted arrives with no history_items at all. Still a real event.
    if (items.length === 0) {
      const { occurredAt, occurredAtSource } = occurredAtOr(null, ctx.receivedAt);
      return [
        {
          ...base,
          sourceSeq: 0,
          occurredAt,
          occurredAtSource,
          identity: null,
          metadata: {
            teamId: asString(p.team_id),
            webhookId: asString(p.webhook_id),
            historyItemCount: 0
          }
        }
      ];
    }

    return items.map((raw, index): NormalisedEvent => {
      const item = asRecord(raw);
      const user = asRecord(item?.user);
      const userId = asString(user?.id);
      const isHuman = userId !== null && !NON_HUMAN_USER_IDS.has(userId);

      const { occurredAt, occurredAtSource } = occurredAtOr(
        fromEpochMillis(item?.date),
        ctx.receivedAt
      );

      return {
        ...base,
        sourceSeq: index,
        occurredAt,
        occurredAtSource,
        identity: isHuman
          ? {
              source: 'clickup',
              externalId: userId,
              email: asString(user?.email),
              displayName: asString(user?.username)
            }
          : null,
        metadata: {
          teamId: asString(p.team_id),
          webhookId: asString(p.webhook_id),
          historyItemId: asString(item?.id),
          field: asString(item?.field),
          before: item?.before ?? null,
          after: item?.after ?? null,
          historyItemCount: items.length
        }
      };
    });
  }
};
