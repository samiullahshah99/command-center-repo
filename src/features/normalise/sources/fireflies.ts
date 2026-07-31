/**
 * Fireflies → unified_event.
 *
 * Real stored payload (v2, `Fireflies-Webhook/2.0`):
 *   { "event": "meeting.transcribed",
 *     "timestamp": 1785514180451,
 *     "meeting_id": "01KYWE8F05YWD11GZV1HK35GS0" }
 *
 * ⚠️ THE WEBHOOK CARRIES NO ACTOR. There is no user id, name or email anywhere
 * in the envelope — only which meeting was transcribed. So `identity` is always
 * null and every Fireflies event is unattributed by construction, not by a
 * failure to resolve. Attribution, if it ever comes, has to be derived from the
 * fetched transcript's participants, which is Week 2 extraction work.
 *
 * ⚠️ snake_case `meeting_id`, not the `meetingId` the public GraphQL docs show —
 * those document the DEPRECATED v1 webhook. See fixtures/fireflies/PROVENANCE.md.
 *
 * ⚠️ `timestamp` is epoch MILLIS as a number, unlike ClickUp's millis-as-string.
 */

import { fromEpochMillis, occurredAtOr } from '../time';
import { asRecord, asString, type NormalisedEvent, type Normaliser } from '../types';

export const firefliesNormaliser: Normaliser = {
  source: 'fireflies',

  normalise(payload, ctx): NormalisedEvent[] {
    const p = asRecord(payload);
    if (!p) return [];

    const eventType = asString(p.event);
    const meetingId = asString(p.meeting_id);
    // Requiring both rejects the v1 shape ({meetingId, eventType}) rather than
    // half-mapping it — a half-mapped row looks healthy and is not.
    if (!eventType || !meetingId) return [];

    const { occurredAt, occurredAtSource } = occurredAtOr(
      fromEpochMillis(p.timestamp),
      ctx.receivedAt
    );

    return [
      {
        sourceSeq: 0,
        eventType,
        occurredAt,
        occurredAtSource,
        // No actor in the envelope. Not a resolution failure — there is nobody
        // to resolve.
        identity: null,
        subjectType: 'meeting',
        subjectId: meetingId,
        subjectLabel: null,
        metadata: {
          meetingId,
          // Test pings use the constant id test_00000000; flagging them here
          // means downstream filtering never has to know that magic string.
          isTestDelivery: eventType === 'test' || meetingId.startsWith('test_')
        }
      }
    ];
  }
};
