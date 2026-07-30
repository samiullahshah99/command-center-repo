# Slack connector

**Not built yet.** This file records what the implementation must get right.

## Auth

```
Authorization: Bearer xoxb-...        ← SLACK_BOT_TOKEN
```

Bot tokens start `xoxb-`. Build the header in `authHeaders()` in this folder and
nowhere else — a missing `Bearer ` prefix returns `invalid_auth`, which is
indistinguishable from a revoked token.

`authHeaders()` must **throw** when `SLACK_BOT_TOKEN` is unset rather than sending
`Bearer undefined`, which produces the same ambiguous error.

## Webhook signature — the part that is easy to get wrong

```
base   = `v0:${X-Slack-Request-Timestamp}:${rawBody}`
sig    = 'v0=' + HMAC_SHA256(SLACK_SIGNING_SECRET, base)
header = X-Slack-Signature
```

- **`rawBody` must be the raw request text.** Reading the body as JSON and
  re-serialising changes whitespace and key order, so the HMAC will not match.
  In a route handler: `await req.text()`, then parse *after* verifying.
- Use a **timing-safe** comparison (`crypto.timingSafeEqual`), not `===`.
- **Reject stale timestamps** — Slack sends one so replays are detectable. More
  than ~5 minutes old should fail.
- Verify with `SLACK_SIGNING_SECRET`, *not* the bot token. Different secret.

## Registration handshake

Slack posts `{ type: 'url_verification', challenge: '...' }` the moment the
Request URL is saved, and requires the raw `challenge` value echoed back **within
3 seconds**. Handle this *before* signature verification runs its full path, and
answer with `text/plain`.

Registering the URL before the handler is deployed fails with
*"Your request URL didn't respond with the correct challenge value."* Deploy
first — see [docs/urls.md](../../../../docs/urls.md).

## Idempotency

Slack's per-event id is `event_id` on the envelope (not `event.ts`, which is a
message timestamp and is not unique across event types). Return it from
`externalIdOf()` so `ingestRawEvent` can deduplicate.

Slack retries on any non-2xx **and** on a slow response, so duplicates are
routine rather than exceptional.

## Writes

Always answer `200` quickly, even for a payload we cannot parse — a non-2xx
triggers Slack's retry ladder and eventually disables the subscription. Persist
via `ingestRawEvent` and do the parsing out of band.
