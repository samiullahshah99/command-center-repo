# Inbound Webhook Schemes

> **This document is a REFERENCE for what we receive.** It replaced an earlier
> version that specified a contract of our own design (`X-CC-Signature`,
> `v0:{ts}:{body}`). **That spec was never adopted** — the backend engineer's
> UGC and Vision implementations were already built and stable, so their
> contracts win and ours was dropped. Nothing sends `X-CC-*` headers.

Four inbound webhook sources, four different signature schemes. There is no
shared middleware, deliberately: the schemes differ in ways that would make one
parameterised path harder to read than four explicit ones.

Verification lives in `src/features/connectors/verify-hmac.ts`, which exposes
**two** functions rather than one with an optional timestamp — so the absence of
replay protection is visible at each call site.

---

## The four schemes

| Source | Signature header | Prefix | Basestring | Replay window |
| --- | --- | --- | --- | --- |
| **Slack** | `X-Slack-Signature` | `v0=` | `v0:{timestamp}:{rawBody}` | ✅ ±300s |
| **UGC** | `X-LuckyFours-Signature` | `sha256=` | `{timestamp}.{rawBody}` | ✅ ±300s |
| **Vision** | `X-Vision-Signature` | `sha256=` | `{rawBody}` | ❌ **none** |
| **ClickUp** | `X-Signature` | *(none)* | `{rawBody}` | ❌ **none** |

All four are HMAC-SHA256, lowercase hex, compared with `timingSafeEqual` behind
a length guard.

> ⚠️ **UGC's separator is a literal DOT, not a colon.** `{ts}.{body}`, not
> `v0:{ts}:{body}`. Copying the Slack verifier produces a valid-looking hex
> signature that never matches, which reads exactly like a wrong secret. There
> is a test pinning this.

### Additional headers

| Source | Other headers |
| --- | --- |
| Slack | `X-Slack-Request-Timestamp` |
| UGC | `X-LuckyFours-Timestamp`, `X-LuckyFours-Event-Id`, `X-LuckyFours-Event` |
| Vision | `X-Vision-Delivery`, `X-Vision-Event` |
| ClickUp | — |

### Secrets

| Source | Env var |
| --- | --- |
| Slack | `SLACK_SIGNING_SECRET` |
| UGC | `UGC_WEBHOOK_SECRET` |
| Vision | `VISION_WEBHOOK_SECRET` |
| ClickUp | `CLICKUP_WEBHOOK_SECRET` — **not** `CLICKUP_API_TOKEN` |

---

## ⚠️ Vision and ClickUp have no replay protection

Neither sender transmits a timestamp, so there is nothing to bound replay with.
A captured request stays valid **forever** and can be replayed verbatim by
anyone who obtains it.

**Idempotency on the provider's event id is the only defence for those two.**

Practical consequence: do not add side effects to those paths that are unsafe to
repeat. Storing to `raw_event` is idempotent and therefore safe; anything that
sends a message, charges something, or mutates external state is not.

This is a property of their contracts, not a gap in our implementation. If it
matters later, the fix is to ask those senders to add a timestamp header — a
change on their side.

---

## Endpoints

| Source | Path |
| --- | --- |
| Slack | `/api/webhooks/slack` |
| ClickUp | `/api/webhooks/clickup` |
| UGC | `/api/webhooks/ugc` |
| Vision | `/api/webhooks/vision` |

Base: `https://command-center-repo-production.up.railway.app`

`GET` on any of them returns `{"ok":true,...}` for reachability checks.

---

## Payload envelopes — they are NOT the same shape

Taken from the handover docs. The differences matter.

|                | UGC (`ugc-management`) | Vision (`vision`) |
| -------------- | ---------------------- | ----------------- |
| event type key | **`type`**             | **`event`**       |
| actor id key   | `actor.id`             | `actor.user_id`   |
| subject key    | `entity` (`{type,id}` or null) | `subject` (`{type,id,label}` or null) |
| schema version | absent                 | `schema_version: 1` |
| environment    | absent                 | `production` \| `preview` \| `development` |
| extras         | `summary` (display-safe one-liner) | `actor.editor_name`, `actor.role` |
| idempotency    | `id`                   | `id` (== `X-Vision-Delivery`) |

> ⚠️ **The event-type key differs.** UGC sends `type`, Vision sends `event`.
> Both also send it as a header, which is what our handler prefers — no payload
> shape assumption needed.

Both docs state the same defensive rules, and our handlers follow them:
event types are **additive** (tolerate unknown values), `metadata` may gain keys
without notice, and almost everything except the guaranteed fields is nullable.

### Ordering is not guaranteed

Both senders deliver best-effort, and a retried older event can arrive after a
newer one. **Order by `occurred_at`, never by arrival.** That is a parsing-stage
concern; ingest stores whatever arrives.

### Retry schedules

| Source | Attempts | Backoff |
| --- | --- | --- |
| UGC | 6, then parked as `failed` for manual replay | ~15s sweep |
| Vision | 6, then marked failed, admin can re-queue | 1, 2, 4, 8, 16, 32 min |

## Idempotency keys

| Source | Key |
| --- | --- |
| Slack | `event_id` on the envelope |
| UGC | `payload.id` |
| Vision | `payload.id` |
| ClickUp | `history_items[0].id` — **never** `webhook_id`, which is identical on every delivery |

Deduplication uses the `(source, external_id)` partial unique index with
`ON CONFLICT DO NOTHING`, so concurrent retries cannot both land.

### Setup test events are exempt

Both internal platforms send a **constant-id** test event during setup:

| Source | Event | Id |
| --- | --- | --- |
| UGC | `test.ping` | `evt_test` |
| Vision | `control_center.test` | all zeros |

Deduplicating on a constant id means the **second** test ping is silently
suppressed — during setup that is indistinguishable from a broken handler, at
exactly the moment someone is trying to confirm the wiring works.

Both are therefore stored with a **null** `external_id`, so every ping lands as
its own row. They are logged as `TEST EVENT received — stored without
deduplication`, greppable in Railway logs. Real events are unaffected.

---

## Handler rules

Every handler follows the same shape (see CLAUDE.md for the rationale):

1. `await req.text()` once — never `req.json()` first
2. Verify the signature against those exact bytes
3. Persist to `raw_event` **before** responding
4. `200` on success, `401` on bad signature, `400` on malformed JSON,
   `500` on write failure so the sender retries
5. No parsing. The complete envelope is stored verbatim.

### Timeout budgets

| Source | Budget |
| --- | --- |
| Slack | 3s |
| UGC | 10s |
| Vision | 15s |
| ClickUp | not documented |

We persist synchronously; the insert measures ~295ms over the public proxy and
less over Railway's private network, so all budgets have ample headroom.

### Unknown event types are tolerated

Both internal contracts state that event types are **additive**. The handlers
never inspect the event type except to recognise setup test events, so an
unrecognised type is stored like any other. Tests pin this.

### Vision's `environment` field

Vision sends `environment: 'production' | 'preview' | 'development'`. The handler
does **not** filter on it — everything is stored, consistent with the
persist-first rule. Production-only filtering belongs at the parsing stage.

---

## Backfill — requested, manual on their side

Both platforms record every event to their own ledger **regardless of whether a
webhook is configured**, so history exists from before our endpoint went live.
Neither auto-replays it:

- **UGC** — events created while no webhook was configured are marked `skipped`
  and are *not* back-delivered.
- **Vision** — no automatic replay of pre-configuration events.

Both offer a **manual** backfill on request. Already asked for; no rush until
live delivery is verified.

There is no `GET /events?since=` pull endpoint on either platform. Worth asking
for eventually — without one, an outage longer than their retry ladder (6
attempts, ~1 hour for Vision) is permanent data loss rather than a recoverable
gap. Their per-event `failed` state plus manual re-queue partly covers this.

## Volume expectations

Vision: "tens to low hundreds of events per active day, bursty around work
sessions." Human actions, not machine events. UGC is comparable. Neither
warrants queueing infrastructure at this stage.
