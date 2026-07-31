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

- **Test deliveries arrive UNSIGNED**, but REAL ones are signed with
  `x-hub-signature` — confirmed by a live delivery that passed verification. The
  unsigned test pings are therefore rejected with 401 like anything else
  unsigned; a temporary bypass that used to accept them has been removed and must
  not be reintroduced.
- **Real event value: `meeting.transcribed`** — lowercase, dot-separated.
  Captured live:
  ```json
  { "event": "meeting.transcribed", "timestamp": 1785514180451,
    "meeting_id": "01KYWE8F05YWD11GZV1HK35GS0" }
  ```
- **The test `meeting_id` is CONSTANT** (`test_00000000`), like UGC's `evt_test`
  and Vision's all-zero id. Both live pings carried it, differing only in
  `timestamp`. Deduplicating on it would make the second ping vanish.

## Webhook fixtures

| File | What it is |
| --- | --- |
| `webhook-test-event.json` | ✅ **Real captured shape.** Setup ping. |
| `webhook-test-event-repeat.json` | Second ping, same constant `meeting_id`, later `timestamp`. Proves repeats each land. |
| `webhook-transcription-completed.json` | ✅ **Real captured event value** — `meeting.transcribed`. |
| `webhook-retry-duplicate.json` | Same event+meeting_id as the above; a redelivery. |
| `webhook-second-event-same-meeting.json` | Different `event`, same `meeting_id` — the case `meeting_id`-only keying would swallow. ⚠️ `meeting.summarized` follows the observed naming convention but has NOT itself been seen. |
| `webhook-unknown-event.json` | Unknown `event` value — must be stored, not rejected. |
| `webhook-no-timestamp.json` | `timestamp` absent. It is undocumented, so it must not be required. |
| `webhook-v1-legacy-shape.json` | The **deprecated** shape, kept deliberately so a test can assert we no longer accept it. |
| `webhook-off-contract.json` | Neither shape. Stores with a null key rather than being discarded. |

> ⚠️ `webhook-test-event.json` and `webhook-transcription-completed.json` carry
> genuinely observed `event` values (`test`, `meeting.transcribed`).
> `meeting.summarized` is still inferred from the naming convention — replace it
> when a second event type is actually seen.

## GraphQL fixtures

Hand-written from the transcript query reference. **Not captured from a live
account** — no real meeting content, participant names, or email addresses. Every
id, name, and address is synthetic. This repo is public.
