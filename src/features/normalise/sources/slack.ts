/**
 * Slack → unified_event.
 *
 * Real stored payload:
 *   {
 *     "type": "event_callback", "event_id": "Ev…", "event_time": 1785508463,
 *     "team_id": "T080T4XAK6Y", "api_app_id": "A…",
 *     "event": { "type": "message", "user": "U0BKAB9DRGD", "channel": "C0BLL…",
 *                "ts": "1785508463.300799", "event_ts": "…", "text": "…",
 *                "channel_type": "group", "blocks": [...] }
 *   }
 *
 * ⚠️ The event type is the INNER `event.type` ("message", "app_mention"). The
 * outer `type` is always "event_callback" — using it would give every Slack row
 * the same meaningless event_type.
 *
 * ⚠️ Slack fires app_mention AND message for the same underlying message. We
 * have real pairs sharing event_ts 1785502172.380599. They arrive as two
 * separate raw_events with different event_ids, so they become two unified rows.
 * That is correct — they are different event types — but any "messages sent"
 * count that does not filter on event_type will double-count mentions.
 *
 * ⚠️ NO EMAIL. Slack envelopes carry a user id and nothing else, so every Slack
 * identity is unresolved until the users:read.email scope is granted or a human
 * links it. See src/features/connectors/slack/client.ts.
 *
 * The message TEXT is deliberately not copied into metadata: it is already in
 * raw_event verbatim, and duplicating message bodies into a second table doubles
 * the surface holding potentially sensitive content.
 */

import { fromEpochSecondsFloat, occurredAtOr } from '../time';
import { asRecord, asString, type NormalisedEvent, type Normaliser } from '../types';

export const slackNormaliser: Normaliser = {
  source: 'slack',

  normalise(payload, ctx): NormalisedEvent[] {
    const p = asRecord(payload);
    if (!p) return [];

    const event = asRecord(p.event);
    // A url_verification handshake never reaches raw_event, but anything else
    // without an inner event block carries nothing to map.
    if (!event) return [];

    const eventType = asString(event.type);
    if (!eventType) return [];

    // `ts` keeps microseconds; `event_time` is whole seconds and would silently
    // round every event. Fall back to event_ts, then the outer event_time.
    const parsed =
      fromEpochSecondsFloat(event.ts) ??
      fromEpochSecondsFloat(event.event_ts) ??
      fromEpochSecondsFloat(p.event_time);
    const { occurredAt, occurredAtSource } = occurredAtOr(parsed, ctx.receivedAt);

    const userId = asString(event.user);

    return [
      {
        sourceSeq: 0,
        eventType,
        occurredAt,
        occurredAtSource,
        identity: userId
          ? {
              source: 'slack',
              externalId: userId,
              // Slack sends neither on the event envelope.
              email: null,
              displayName: null
            }
          : null,
        // The channel is what the event is "about" — there is no finer subject
        // on a message event.
        subjectType: 'channel',
        subjectId: asString(event.channel),
        subjectLabel: null,
        metadata: {
          slackEventId: asString(p.event_id),
          teamId: asString(p.team_id) ?? asString(event.team),
          channelType: asString(event.channel_type),
          ts: asString(event.ts),
          threadTs: asString(event.thread_ts),
          subtype: asString(event.subtype)
        }
      }
    ];
  }
};
