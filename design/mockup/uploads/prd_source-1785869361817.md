A single system that everything in the company is tied into, giving leadership a bird's-eye view of what every person and team is doing, whether timelines are being hit, and what needs attention — without anyone having to manually chase updates.

The Command Center is the **intelligence and automation layer** on top of ClickUp*, Slack, the internal portal, and our other tools that:

1. Turns meetings and Slack updates into tracked, assigned, deadlined action items.
2. Auto-completes recurring tasks by reading what people actually did in our systems (instead of manual check-offs).
3. Tracks each role differently (agents, ops/leadership, creative, coders, agencies) against the right signals.
4. Gives the founder a Slack-taggable copilot for "where do things stand?" questions.
5. Rolls everything up into a high-level Executive Control Tower across all departments.

> *"A central system that everything is tied into, where we can have automations integrated with Slack to make sure everything's getting actually actioned on."*
> 

This is explicitly a **large, multi-phase project**, not a simple build. It is foundational because almost every other Project Oasis initiative reports into it.

---

## 2. Problem statement

As the team scales, leadership has no reliable way to see what is happening across the org:

- Action items from meetings and Slack live in people's heads or scattered notes; many are forgotten or never followed up on.
- There is no consistent timeline/ownership on work, so "this needs to be done" rarely has a due date or an accountable owner.
- The founder has to constantly stay aware of, and manually ask for updates on, everything — which is unsustainable and error-prone ("you forget about stuff you asked for, or you constantly have to ask for updates").
- Different roles produce different kinds of output (tickets, briefs, edits, code, agency reports), and today there is no unified way to see whether each role is actually delivering its expected volume.
- There is no single high-level view of departmental and agency health for the founder to make decisions from.

## 3. Goals & non-goals

### Goals

- One source of truth for **who is doing what, by when, and current status**, spanning the whole org.
- **Zero-friction capture**: action items are created from meetings and Slack automatically; recurring tasks auto-complete from system activity wherever possible.
- **Role-aware tracking**: each role is measured against the signals that actually reflect its work.
- **Proactive surfacing**: overdue items, blocked items, and at-risk timelines are flagged automatically (in Slack), not discovered late.
- A **founder copilot** that answers status questions on demand from a single place.
- An **Executive Control Tower** rollup: per-department health (good / bad / needs attention) for high-level decisions.

### Non-goals (for now)

- Replacing ClickUp as the task system of record.
- A formal **Decision Log** for major business choices — Damian passed on this for now; park as a future idea.
- Finance/profitability dashboard build — related (Executive Control Tower) but scoped in its own PRD.
- Adding so much friction (mandatory daily check-offs) that the team resists adoption — automate completion wherever feasible instead.

---

## 4. Users & roles

| Persona | What they need from the Command Center |
| --- | --- |
| **Founder (Damian)** | Bird's-eye view of all teams; copilot for status questions; Executive Control Tower; founder task-offload tracking. |
| **Head of Ops (Ardin)** | Cross-team delivery visibility; manage coders/projects; configure per-role tracking and automations. |
| **Support Manager (Ronalyn)** | Her action items + daily ops tasks; agent-level visibility. |
| **CX Ops (Diane)** | Daily ops tasks (e.g. inventory returns review) that should auto-complete from her activity. |
| **Creative strategist (Hashim)** | Brief-quota visibility (feeds from the Brief Tracker PRD). |
| **Frontline CX agents** | Action items from team meetings; AI company search for answers. |
| **Coders / FDE (Usama + contractors)** | Project/task assignment, timelines, progress tracking. |
| **Agencies (email, media buying, etc.)** | Lightweight reporting capture pulled from where they already report (mostly Slack + tool APIs). |

---

## 5. System architecture (high level)

            `┌──────────────────────────────────────────────┐
            │              COMMAND CENTER                    │
            │        (intelligence + automation layer)       │
            └──────────────────────────────────────────────┘
                 ▲          ▲           ▲            ▲
   ingest        │          │           │            │   surface
 ┌───────────────┴──┐  ┌────┴─────┐ ┌───┴────────┐ ┌─┴──────────────┐
 │ Meeting capture  │  │  Slack   │ │  ClickUp   │ │ Internal portal│
 │ (Fireflies / AI  │  │ channels │ │ (system of │ │ (CX, inventory,│
 │ meeting tool)    │  │          │ │  record)   │ │  portal events)│
 └──────────────────┘  └──────────┘ └────────────┘ └────────────────┘
        + Shopify, Klaviyo, ad accounts, Notion (read-only signal sources), Claude Connector, Task management via slack

        ┌───────────────── OUTPUTS ─────────────────┐
        │ • Per-role tracking views                  │
        │ • Overdue / blocked Slack alerts           │
        │ • Founder copilot (Slack-taggable)         │
        │ • Executive Control Tower rollup           │
        │ • Company AI search (AI brain)             │
        └────────────────────────────────────────────┘`

**Key architectural decision:** ClickUp is the canonical task store. The Command Center reads from and writes to ClickUp via its API, layers automation/intelligence on top, and pushes notifications and rollups out to Slack and the portal. We do **not** duplicate task storage.

**Suggested stack (aligned to current tooling):** Python/FastAPI services, Pydantic AI agents for the copilot and per-role monitors, n8n for glue automations and scheduled crons, Postgres for Command Center state (mappings, role configs, auto-completion ledger), Next.js for any custom views inside the portal, Logfire/Langfuse for observability on agent runs.

---

## 6. Functional requirements

### 6.1 Meeting & update ingestion → action items

- Ingest meeting transcripts and produce structured action items: **task description, owner, due date, follow-ups**.
- Evaluate a dedicated AI meeting tool (one was demoed in-meeting that records, generates action items, assigns to people, and produces a doc per meeting) **vs.** continuing with Fireflies for transcription plus our own extraction.
    - 
- Extracted action items must **sync into ClickUp** (assigned to the right person) so progress is tracked there — not just listed in a doc.
- Slack updates (e.g. Ardin's status posts, Ronalyn's action items to agents) should also be parsed into action items under the right owner.
- Each generated item links back to its source (meeting doc / Slack message) for context.

### 6.2 Automated task completion (read activity, don't ask for check-offs)

The system should mark recurring tasks complete by **observing real activity in our tools**, minimizing manual check-offs:

- Example: Diane's daily "review inventory returns" task auto-completes when the system sees she filtered and acknowledged the returns/awaiting-review tab in the portal.
- Example: Hashim's weekly brief quota auto-tracks from briefs submitted (via the Brief Tracker — see companion PRD).
- Maintain an **auto-completion ledger** (what was completed, by whom, evidenced by which event) so completion is auditable and can't simply be self-declared.
- Where an activity signal isn't available, fall back to a lightweight manual check-off, but treat automated detection as the default goal.

### 6.3 Role-aware tracking

Each role is monitored against different signals. The Command Center needs configurable **role profiles**:

| Role | Primary signals tracked |
| --- | --- |
| CX agents | Ticket volume, comments/resolutions (already trackable in Zendesk). |
| Ops / leadership (Ronalyn, Diane) | Action items + recurring daily ops tasks; delivery volume/cadence. |
| Creative strategist (Hashim) | Briefs submitted per week vs. quota (Brief Tracker). |
| Video editors | Edits/videos submitted vs. quota (Brief Tracker). |
| Coders (Usama + contractors) | Assigned projects/tasks, timelines, progress, what's in flight. |
| Agencies | Reporting pulled from Slack updates + tool APIs (Klaviyo etc.); see §6.7. |

A per-role monitor (Pydantic AI agent) watches the relevant ClickUp tasks, Slack channels, and tool signals for that role and reports volume/cadence/at-risk status.

### 6.4 Timelines, overdue & blocked flagging

- Every tracked item should have an owner and a due date.
- **Overdue items get flagged automatically** and pushed to Slack ("deadline approaching / overdue, write an update").
- ClickUp ↔ Slack two-way: status changes and reminders flow to Slack; updates posted in Slack reflect back to the item.
- Blocked/at-risk items surface to the relevant lead and roll up to the Control Tower.

### 6.5 Founder copilot (Slack-taggable status agent)

- An agent connected to ClickUp, Slack, the portal, Shopify, and other tools, given **founder-specific context** so it understands what Damian cares about and how he phrases things.
- Damian can **@-tag it in Slack** and ask, e.g., *"What's going on with Commercive on this sample request?"* → it returns current status, last update, and whether anyone is behind.
- Useful especially for tracking external parties (Commercive) where we can't directly assign tasks but can track requests and their updates.

### 6.6 Founder task-offload tracker

- Maintain a living list of tasks Damian currently does that should be handed off, with a proposed owner and an estimate of time reclaimed.
- Seed examples raised in-meeting:
    - Re-tagging photo reviews mis-attributed to the wrong product (e.g. a Santos photo tagged under Bron) in the reviews app.
    - Unpublishing/removing 1–3 star reviews so they don't show on the site.
- Workflow: Damian surfaces a task → Ardin assigns an owner and structures it → the task is tracked here so it's verifiably handed over and being done.

### 6.7 Agency reporting capture

- Don't increase agency workload. **Extract the detailed reporting they already provide** (mostly in Slack) and pull it into our portal.
- Where useful, supplement with tool APIs (e.g. Klaviyo for the email agency) — but agencies should instead provide the *qualitative* layer (ongoing strategies/projects) we can't get from APIs, while quantitative metrics come from the API.
- Each agency is different; design the capture to adapt per agency rather than forcing one rigid format.

### 6.8 Company AI search ("AI brain") *(related; can phase separately)*

- A company-wide AI search that taps into the portal, meeting docs/transcripts, Slack, and Notion databases.
- Use case: a CX agent with a question they can't answer searches the AI brain and gets an answer pulled from company knowledge.
- Must respect access boundaries (sensitive content excluded by role).

### 6.9 People page / org chart

- A People space containing the org chart (overview of where everyone sits), the current team, and recruiting.
- Source the existing org chart from Damian's Miro (needs updating) as a starting point.
- embedded from here  https://luckyfours.app/embed/org?key=37wpFcLXP6ppUHSKsgSVmEEnGoyRhvgS

### 6.10 Executive Control Tower (high-level rollup)

- A super-high-level overview of how each department is performing: **what's good, what's bad, what needs attention.**
- Pulls from the central task system, Slack, ClickUp, the portal, and agency reporting.
- Sections discussed: department status, agency performance scorecard, team performance, tools/spend we're paying for. (Finance/profitability is its own PRD but plugs in here.)
- Think of it as a higher-level companion to the weekly digest.

---

## 7. Data model (initial sketch)

The Command Center stores mapping/intelligence state; ClickUp stores the tasks themselves.

- **`person`** — id, name, role_profile_id, slack_id, clickup_id, portal_id.
- **`role_profile`** — id, name, tracked_signals[], quota config, source channels.
- **`tracked_item`** — id, clickup_task_id, owner_person_id, source_type (meeting | slack | manual | system), source_ref, due_date, status, last_update_at, risk_flag.
- **`recurring_task`** — id, owner_person_id, cadence, auto_complete_rule (event signal to watch), fallback_manual (bool).
- **`completion_event`** — id, recurring_task_id, completed_at, evidence_source, evidence_ref.
- **`agency`** — id, name, report_source (slack_channel / api), api_config, capture_rule.
- **`control_tower_metric`** — id, department, metric, value, status (good | warn | attention), as_of.
- **`copilot_context`** — founder-specific context + tool credentials/scopes for the status agent.

---

## 8. Integrations

| System | Direction | Purpose |
| --- | --- | --- |
| **ClickUp** | read/write | System of record; create/sync action items, read status, push due dates. |
| **Slack** | read/write | Ingest updates; push overdue/at-risk alerts; host the founder copilot; agency reporting source. Use the `#proj-` channel convention. |
| **Meeting tool / Fireflies** | read | Transcripts → action items. |
| **Internal portal** | read | Activity signals for auto-completion (e.g. inventory returns acknowledged). |
| **Shopify** | read | Context for copilot/status (orders, inventory). |
| **Klaviyo & ad accounts** | read | Agency metric supplementation. |
| **Notion** | read | Company AI search source. |
| **Miro** | read (import) | Seed org chart. |

---

## 9. Phasing

**Phase 0 — Foundations**

- ClickUp as system of record confirmed; person/role mapping built.
- `#proj-` Slack convention adopted for project channels.
- Decide meeting tool vs. Fireflies.

**Phase 1 — Capture & track (MVP)**

- Meeting/Slack → action items synced into ClickUp with owner + due date.
- Overdue/at-risk flagging pushed to Slack.
- Basic per-role views (start with creative strategist briefs + ops daily tasks).

**Phase 2 — Automate completion**

- Auto-completion ledger + first auto-complete rules (Diane's returns review, Hashim's brief quota).
- Founder copilot v1 (Slack-taggable, read-only status across ClickUp/Slack/portal).

**Phase 3 — Rollup & intelligence**

- Executive Control Tower (department health, agency scorecard, team performance).
- Agency reporting capture from Slack + APIs.
- Company AI search (AI brain) and People page / org chart.

**Later / parked**

- Decision log for major business choices.
- Deeper finance/profitability integration (separate PRD).

---

## 10. Open questions / decisions needed

1. **Meeting tool:** adopt the dedicated AI meeting tool (records, assigns action items, doc per meeting, ClickUp/Jira integrations) and retire Fireflies, or run it alongside Fireflies? *(Owner: Ardin to evaluate.)*
2. **Auto-completion trust model:** which recurring tasks genuinely have a reliable activity signal vs. need a manual check-off fallback? Define the first 3–5.
3. **Agency capture per agency:** confirm the report source and format for each agency before building the extractor.
4. **Access control for AI search:** what's sensitive and must be excluded per role?
5. **Friction tolerance:** how much daily check-off is acceptable before the team resists? Bias toward automation.
6. **Org chart source of truth:** import from Miro once, or keep Miro as canonical and sync?

---

## 11. Success metrics

- % of meeting/Slack action items that land in ClickUp with an owner + due date (target: high, automatic).
- Reduction in founder-initiated "what's the status of X?" manual asks.
- % of recurring ops tasks completed via automated detection vs. manual check-off.
- Overdue items caught-and-flagged before the deadline vs. discovered late.
- Adoption: active roles tracked through the Command Center.

---

## 12. Dependencies & related work

- **Brief Tracker** (companion PRD) — feeds creative strategist + video editor tracking and ad-performance attribution into the Command Center.
- **Ad reporting system** — supplies creative performance signals to the Control Tower.
- **Finance/profitability dashboard** — plugs into the Control Tower (separate PRD).
- **Product development pipeline tracker** — another department feed into the Control Tower.
1. MCP connector to slack and claude (individual access) / slack.