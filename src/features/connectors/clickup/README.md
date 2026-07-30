# ClickUp connector

**Not built yet.** This file records what the implementation must get right.

ClickUp is the **system of record for tasks**. This connector reads task state and
writes task updates; it does not mirror task data into our schema. `tracked_item`
holds a `clickup_task_id` reference plus our own intelligence state — never a
copy of the title, assignee, status, or comments.

## Auth — different from every other connector here

```
Authorization: <token>               ← CLICKUP_API_TOKEN, RAW
```

**No `Bearer ` prefix.** ClickUp v2 takes the token as the bare header value.
Adding `Bearer ` returns `OAUTH_025`, and omitting the header entirely returns
`OAUTH_017` — neither message says "you added a prefix", so this is worth getting
right once, here, and never hand-writing at a call site.

Personal tokens start `pk_`. `authHeaders()` must throw when the variable is
unset rather than sending `Authorization: undefined`.

`CLICKUP_TEAM_ID` is the workspace id, needed on most endpoints. Obtain it from
`GET /api/v2/team`.

## Webhook signature

```
sig    = HMAC_SHA256(<webhook secret>, rawBody)
header = X-Signature
```

- The secret is the one **returned when the webhook is created**, not
  `CLICKUP_API_TOKEN`. They are different values and mixing them up produces a
  silent verification failure.
- Raw body again — verify before parsing.
- Timing-safe comparison.

Because the secret only exists after creation, it must be captured at
registration time and stored. Decide where before building this.

## Registration

ClickUp validates that the URL is reachable when the webhook is created, so the
handler must be deployed first. Webhooks are created via the API
(`POST /api/v2/team/{team_id}/webhook`), not a dashboard toggle.

## Idempotency

The delivery envelope carries a `webhook_id` plus an event-specific id; confirm
which field is unique per delivery against the current docs before wiring
`externalIdOf()`. Do not assume `task_id` is unique — the same task generates many
events.

## Rate limit

100 requests/minute per token on the free tier. Higher on paid plans. Plan for
`429` with `Retry-After`.
