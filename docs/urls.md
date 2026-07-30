# URLs & Endpoints

## Slack app

```
SLACK_CHANNEL_ID (test channel): C0BLLT9PT18
Slack app: Command Center | scopes: channels/groups read+history, chat:write, users:read, app_mentions:read
```

---

## Webhook endpoints (planned)

Base URL (production): `https://command-center-repo-production.up.railway.app`

| Source | Endpoint | Status |
| --- | --- | --- |
| Slack | `/api/webhooks/slack` | ⬜ **pending** — register in the Slack dashboard **only after** the handler is deployed |
| ClickUp | `/api/webhooks/clickup` | ⬜ **pending** — same ordering constraint |
| Fireflies | `/api/webhooks/fireflies` | ⬜ **day 4** — handler not built |

> [!IMPORTANT]
> **Deploy the handler before registering the URL.**
>
> Slack and ClickUp both **validate the endpoint at registration time** — they
> send a request the moment you save the URL and reject it if the response is
> wrong. Registering first therefore fails, and the failure is confusing:
>
> - **Slack** posts a `url_verification` event containing a `challenge` string and
>   requires the raw challenge value echoed back within **3 seconds**. Against a
>   route that does not exist yet it gets a 404 and refuses to save, reporting
>   "Your request URL didn't respond with the correct challenge value."
> - **ClickUp** rejects a URL it cannot reach when the webhook is created.
>
> Correct order for each: build the handler → deploy to Railway → confirm the
> path responds → then register the URL in the provider's dashboard.

### Why these paths

`src/proxy.ts` protects `/dashboard(.*)` only, so `/api/webhooks/*` is reachable
without a session — which is required, since providers post with no cookies.
Verified: `POST /api/webhooks/slack` returns 404 (route absent), **not** a 307
redirect to sign-in.

Do not move these under `/dashboard/*`, and do not extend the Clerk route
matcher to cover `/api/*` — either change would make every webhook redirect to
the sign-in page, which providers see as a failure.

### Signature verification

Each provider authenticates differently. Do not assume one shared middleware:

- **Slack** — HMAC SHA-256 over `v0:{timestamp}:{raw body}` using
  `SLACK_SIGNING_SECRET`, compared against the `X-Slack-Signature` header.
  Needs the **raw** body, so the request cannot be `JSON.parse`d first.
- **ClickUp** — HMAC SHA-256 of the raw body against the `X-Signature` header,
  using the secret returned when the webhook is created (not the API token).
- **Fireflies** — `FIREFLIES_WEBHOOK_SECRET` is already in `.env.local`;
  mechanism to be confirmed against their docs on day 4.

### Notion is not here on purpose

Notion has **no webhook API for internal integrations** — it is pull-only, so it
does not fit this pattern. See the Notion section in
[CLAUDE.md](../CLAUDE.md).
