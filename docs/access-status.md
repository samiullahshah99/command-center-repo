# Integration Access Status

Tracks API access for the Command Center integrations. Credentials themselves
live in `.env.local` (gitignored) — never in this file.

| Integration | Status | Notes |
| --- | --- | --- |
| **Clerk** | ✅ done | Dev instance `feasible-mudfish-56`. Sign-up mode `restricted` (invitation-only). Production instance not yet created. |
| **Slack** | ✅ done | App "Command Center". Scopes: channels/groups read+history, `chat:write`, `users:read`, `app_mentions:read`. Test channel ID in [urls.md](./urls.md). |
| **ClickUp** | ⬜ not started | Blocks the capture → confirm → sync pipeline. Use a service account token, not a personal one. |
| **Meeting tool / Fireflies** | ⬜ not started | Blocked on the tool decision (dedicated AI meeting tool vs. Fireflies + own extraction). |
| **Internal portal** | ⬜ not started | Read access for auto-completion signals. Confirm an event exists for "returns/awaiting-review acknowledged" before building against it. |
| **Klaviyo** | ⬜ not started | Agency reporting metrics. |
| **Shopify** | ⬜ not started | Read-only context for the founder copilot. |
| **Sentry** | ✅ done | Client + server + edge configured. `NEXT_PUBLIC_SENTRY_DISABLED='true'` disables locally. |
| **OpenRouter (LLM)** | ✅ done | Key verified with a live call to `anthropic/claude-sonnet-5`. ⚠️ Only **$10.28** of $110 credit remains. See [CLAUDE.md](../CLAUDE.md) for model slugs. **Open question: was routing via a third-party proxy a deliberate choice? See below.** |

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
