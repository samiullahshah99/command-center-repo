# Fireflies fixtures — provenance

## ⚠️ The public docs are WRONG. Do not build against them.

`https://docs.fireflies.ai/graphql-api/webhooks` documents the **deprecated v1**
webhook (Developer Settings). Fireflies has since moved webhooks to the
**Integrations page**, and the v2 payload differs on *every* field.

| v1 — docs, deprecated | v2 — actual |
| --- | --- |
| `meetingId` | `meeting_id` — **snake_case** |
| `eventType` | `event` |
| `clientReferenceId` | *does not exist* |
| *not mentioned* | `timestamp` — epoch **milliseconds** |

Confirmed from two live deliveries, `User-Agent: Fireflies-Webhook/2.0`, stored
verbatim in `raw_event`:

```json
{ "event": "test", "timestamp": 1785510895435, "meeting_id": "test_00000000" }
```

Everything the v1 fixtures asserted was therefore testing the wrong contract.

## Two other things the docs do not tell you

- **Test deliveries arrive UNSIGNED.** No `x-hub-signature` at all, among ~20
  headers. They carry `x-webhook-delivery-id: test-…`. Whether *real* events are
  signed is still unconfirmed — see the temporary exception in
  `src/features/connectors/fireflies/index.ts`.
- **The test `meeting_id` is CONSTANT** (`test_00000000`), like UGC's `evt_test`
  and Vision's all-zero id. Both live pings carried it, differing only in
  `timestamp`. Deduplicating on it would make the second ping vanish.

## Webhook fixtures

| File | What it is |
| --- | --- |
| `webhook-test-event.json` | ✅ **Real captured shape.** Setup ping. |
| `webhook-test-event-repeat.json` | Second ping, same constant `meeting_id`, later `timestamp`. Proves repeats each land. |
| `webhook-transcription-completed.json` | A real-looking meeting event. ⚠️ The `event` VALUE is a guess — we have only ever seen `"test"`. |
| `webhook-retry-duplicate.json` | Same event+meeting_id as the above; a redelivery. |
| `webhook-second-event-same-meeting.json` | Different `event`, same `meeting_id`. The case `meeting_id`-only keying would swallow. |
| `webhook-unknown-event.json` | Unknown `event` value — must be stored, not rejected. |
| `webhook-no-timestamp.json` | `timestamp` absent. It is undocumented, so it must not be required. |
| `webhook-v1-legacy-shape.json` | The **deprecated** shape, kept deliberately so a test can assert we no longer accept it. |
| `webhook-off-contract.json` | Neither shape. Stores with a null key rather than being discarded. |

> ⚠️ Only `webhook-test-event.json` is a genuine capture. The `event` values on
> the meeting fixtures (`Meeting Transcribed`, `Meeting Summarized`) are
> **placeholders** — no real meeting event has been observed yet. Replace them
> once one arrives; the diagnostic logging on the webhook route will show the
> real value.

## GraphQL fixtures

Hand-written from the transcript query reference. **Not captured from a live
account** — no real meeting content, participant names, or email addresses. Every
id, name, and address is synthetic. This repo is public.
