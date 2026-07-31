# URLs & Endpoints

Production base: `https://command-center-repo-production.up.railway.app`

## Slack app

```
SLACK_CHANNEL_ID (test channel): C0BLLT9PT18
Slack app: Command Center | scopes: channels/groups read+history, chat:write, users:read, app_mentions:read
```

---

## Webhook endpoints

| Source | Endpoint | Status |
| --- | --- | --- |
| **Slack** | `/api/webhooks/slack` | ✅ **LIVE** — verified end-to-end |
| **ClickUp** | `/api/webhooks/clickup` | ✅ **LIVE** — verified end-to-end |
| Fireflies | `/api/webhooks/fireflies` | ⏳ contract pending — day 4 |
| Portal | `/api/webhooks/portal` | ⏳ contract pending — internal portal activity signals (PRD §5.2) |
| Studio | `/api/webhooks/studio` | ⏳ contract pending — studio stats, awaiting Usama |

Full URLs:

```
https://command-center-repo-production.up.railway.app/api/webhooks/slack
https://command-center-repo-production.up.railway.app/api/webhooks/clickup
```

"Contract pending" means the payload shape and signature scheme are not yet
known. Do not create the route until the provider's contract is confirmed —
a live endpoint that 200s without verifying anything is worse than a 404.

### Delivery confirmed

Not just deployed — real events have reached `raw_event`:

```
slack     2 events   latest 2026-07-30
clickup   1 event    latest 2026-07-31
```

The endpoints answer `200` to a `GET`, which is also how ClickUp checks
reachability at registration.

---

## ClickUp webhook registration

Recorded so it can be found without querying the API:

```
webhook id : b2322908-49a8-4388-8796-8cac3c128ae1
endpoint   : https://command-center-repo-production.up.railway.app/api/webhooks/clickup
scope      : team-wide (team 90182930145)
events     : taskCreated, taskUpdated, taskStatusUpdated, taskDeleted
health     : active
```

Manage with `pnpm clickup:list` / `pnpm clickup:register` / `pnpm clickup:delete <id>`.

> **The signing secret is shown ONCE at creation and is never retrievable.**
> `pnpm clickup:list` does not return it. If `CLICKUP_WEBHOOK_SECRET` is lost,
> the only recovery is to delete this webhook and register a new one, which
> produces a new secret that must be set in both `.env.local` and Railway.

> ClickUp does **not** deduplicate registrations. Two webhooks on the same
> endpoint both deliver, so every event arrives twice. `pnpm clickup:register`
> refuses to create a duplicate unless `--force` is passed.

---

## Registration order matters

Both Slack and ClickUp **validate the endpoint when the URL is saved**, so the
handler must be deployed first.

- **Slack** posts a `url_verification` event whose `challenge` must be echoed
  back within 3 seconds. Against an undeployed route it gets a 404 and refuses
  to save: *"Your request URL didn't respond with the correct challenge value."*
- **ClickUp** rejects a URL it cannot reach at creation time.

Order: build → deploy → confirm the path responds → register.

---

## Signature verification differs per provider

There is no shared middleware, deliberately — see CLAUDE.md.

- **Slack** — HMAC-SHA256 over `v0:{timestamp}:{rawBody}` with
  `SLACK_SIGNING_SECRET`, compared to `X-Slack-Signature`. Includes a timestamp,
  so replays outside ±5 minutes are rejected.
- **ClickUp** — HMAC-SHA256 of the raw body alone with `CLICKUP_WEBHOOK_SECRET`
  (**not** the API token), compared to `X-Signature`. **No timestamp**, so there
  is no replay window — idempotency is the only protection.
- **Fireflies** — `FIREFLIES_WEBHOOK_SECRET` exists; mechanism to confirm on day 4.

---

## Notion is not here on purpose

Notion has **no webhook API for internal integrations** — it is pull-only and
does not fit this pattern. See the Notion section in [CLAUDE.md](../CLAUDE.md).
