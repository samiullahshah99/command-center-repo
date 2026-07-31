# UGC / Vision fixtures — provenance

Built from the backend engineer's handover docs:
`control-center-webhook.md` (UGC) and `control-center-activity-webhook.md` (Vision).
Envelope shapes and field names are taken directly from those documents.

## ⚠️ PII scrubbed

The source documents contain real staff names and real `@`-company email
addresses in their example payloads. **None appear here.** Every actor id, name,
email, handle, and entity id below is synthetic. This repo is public.

## Envelope differences worth remembering

|                | UGC                  | Vision                 |
| -------------- | -------------------- | ---------------------- |
| event type key | `type`               | `event`                |
| actor id key   | `actor.id`           | `actor.user_id`        |
| subject key    | `entity`             | `subject`              |
| schema version | absent               | `schema_version: 1`    |
| environment    | absent               | present                |
| idempotency    | `id`                 | `id`                   |

The differing event-type key is the one most likely to cause a silent bug.
