# Integration Access Status

Tracks API access for the Command Center integrations. Credentials themselves
live in `.env.local` (gitignored) — never in this file.

| Integration | Status | Notes |
| --- | --- | --- |
| **Clerk** | ✅ done | Dev instance `feasible-mudfish-56`. Sign-up mode `restricted` (invitation-only). Production instance not yet created. |
| **Slack** | ✅ done | App "Command Center". Scopes: channels/groups read+history, `chat:write`, `users:read`, `app_mentions:read`. Test channel ID in [urls.md](./urls.md). |
| **ClickUp** | 🟨 token present, unverified | `CLICKUP_API_TOKEN` + `CLICKUP_TEAM_ID` are in `.env.local`, but no live call has confirmed them. Blocks the capture → confirm → sync pipeline. Prefer a service account token over a personal one. |
| **Meeting tool / Fireflies** | 🟨 token present, unverified | `FIREFLIES_API_KEY` + `FIREFLIES_WEBHOOK_SECRET` are in `.env.local`, unverified. Tool decision (dedicated AI meeting tool vs. Fireflies + own extraction) may still be open. |
| **Internal portal** | ⬜ not started | Read access for auto-completion signals. Confirm an event exists for "returns/awaiting-review acknowledged" before building against it. |
| **Klaviyo** | ⬜ not started | Agency reporting metrics. |
| **Shopify** | ⬜ not started | Read-only context for the founder copilot. |
| **Sentry** | ✅ done | Client + server + edge configured. `NEXT_PUBLIC_SENTRY_DISABLED='true'` disables locally. |
| **OpenRouter (LLM)** | ✅ done | Key verified with a live call to `anthropic/claude-sonnet-5`. ⚠️ Only **$10.28** of $110 credit remains. See [CLAUDE.md](../CLAUDE.md) for model slugs. **Open question: was routing via a third-party proxy a deliberate choice? See below.** |
| **Notion** | ✅ done | Token verified via `pnpm verify:notion` — integration "Command Center", **4 databases already shared** (see below). Feeds PRD §5.8 company AI search, a **later phase**; client not built. |

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
