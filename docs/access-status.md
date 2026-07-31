# Integration Access Status

Tracks API access for the Command Center integrations. Credentials themselves
live in `.env.local` (gitignored) — never in this file.

| Integration | Status | Notes |
| --- | --- | --- |
| **Slack** | ✅ done | App installed, webhook **live** at `/api/webhooks/slack`, bot invited to the `#proj-` channel. 2 events received. |
| **ClickUp** | ✅ done | Token + team id set. Webhook **registered team-wide** (`b2322908-49a8-4388-8796-8cac3c128ae1`), health active. 1 event received. ⚠️ Transitional — see [CLAUDE.md](../CLAUDE.md). |
| **Notion** | ✅ done | Token verified via `pnpm verify:notion` — 4 databases shared. Pull-only; feeds PRD §5.8, a later phase. |
| **Fireflies** | ✅ done | `FIREFLIES_API_KEY` + `FIREFLIES_WEBHOOK_SECRET` present. Integration is day 4. |
| **OpenRouter (LLM)** | ✅ done | Key verified with a live call. ⚠️ Only **$10.28** of $110 credit remains. |
| **Postgres** | ✅ done | Railway. Schema + migrations applied; `DATABASE_URL` internal, `DATABASE_PUBLIC_URL` for migrations. |
| **Clerk** | ✅ done | Dev instance, invitation-only sign-up. Production instance not yet created. |
| **Sentry** | ✅ done | Client + server + edge. Source-map upload configured. |
| **Portal API** | ⏳ blocked | Contract questions sent to the backend engineer. Endpoint reserved at `/api/webhooks/portal` (PRD §5.2). |
| **Studio API** | ⏳ blocked | Awaiting Usama. Endpoint reserved at `/api/webhooks/studio`. Expected to replace ClickUp for content outputs. |
| **Zendesk** | ⏳ not requested | PRD §5.3. |
| **Klaviyo** | ⏳ not requested | PRD §5.7. |
| **Miro** | ⏳ not requested | PRD §5.9. |

## Notion — recorded detail

Verified with `pnpm verify:notion` (read-only; `scripts/verify-notion.ts`).

- Integration name: **Command Center**
- `Notion-Version`: `2022-06-28` (mandatory on every request)
- Databases shared with the integration — **sharing is already done**, no
  outstanding manual step:

| Database ID | Title |
| --- | --- |
| `2d9c2839-383e-43ea-aa43-9c219052c4b6` | Projects |
| `d13ec8fc-482f-45a7-91d5-8125917ef564` | Dev Track |
| `5371c604-cca3-45d4-9105-e8271e95d15b` | Sprints in weeks |
| `2a8641ef-3273-4865-9c17-7270e8dd8887` | Meeting Notes |

- `NOTION_DATABASE_ID` is **not yet set** in `.env.local` — pick one of the above
  when the client is built.
- **Pull-only**: no webhook API for internal integrations, so Notion does not fit
  the `raw_event` inbound pattern used by the other connectors.
- Client will live at `src/features/connectors/notion/` once the Day 3 shared
  connector interface exists. Deliberately not written yet.

## Slack — recorded detail

- App name: **Command Center**
- Scopes granted: `channels:read`, `channels:history`, `groups:read`,
  `groups:history`, `chat:write`, `users:read`, `app_mentions:read`
- Test channel ID: see [urls.md](./urls.md)
- Bot must be invited to every `#proj-` channel it should read.

## Open question — OpenRouter vs. direct Anthropic

**Raise with the lead before Week 2.** LLM traffic currently routes through
OpenRouter, a third-party proxy. The Command Center will send **meeting
transcripts, Slack messages, and customer data** through it (PRD §6.1, §6.5,
§6.8). That means a third party sits in the path of the company's most sensitive
internal communications.

- Was OpenRouter deliberate (multi-provider fallback, unified billing), or just
  what was convenient to sign up for?
- Does whoever owns data policy need to approve a subprocessor here?
- Is the account personal or company-owned? A personal account holding company
  data is a continuity risk as well as a compliance one.

A direct Anthropic key removes the intermediary and is a drop-in change if the
`src/lib/ai/client.ts` boundary is respected. Cheap to decide now; expensive to
unpick once transcripts have been flowing through it for a month.

## Outstanding

- Add `app_mention` / `message.channels` event subscriptions when the copilot
  work starts.
- Create the production Clerk instance (needs a domain + DNS) and re-apply the
  restricted sign-up mode — instance settings do not carry over from development.
