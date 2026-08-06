# Command Center — Frontend Data Contract

**Purpose.** The mockup frontend is the fixed contract (per team-lead direction). This document specifies every screen across both mockup files, each data-driven UI element, and the field-level schema it implies. The backend is audited *against this document*: for every field, classify ✅ exact match / 🟡 exists-but-mismatched / 🔴 missing.

**Sources of truth.**
- `design/mockup/Command Center.dc.html` — exec/company screens (Control Tower, Department, Person profile, Capture queue, People & org, Founder offload, AI search)
- `design/mockup/Command Center Roles.dc.html` — role workspaces (Login, My day, My team, Briefs & quota, My projects, Automations, Agency reporting) + role-aware sidebar
- `uploads/prd-command.md` — semantics (personas, auto-completion philosophy, integrations)
- Field names below are taken from the mockup's own template variables (e.g. `dept.healthLabel`, `item.evidence`, `my.recurring`) — treat them as the canonical frontend-facing names.

**Conventions.** Types are TypeScript-flavored. `*Color` / `*Bg` / `initials` variables in the mockup are **presentation-derived** — the backend must supply the underlying enum/value, never the color. Those derivations happen in the frontend theme layer.

---

## 1. Shared / core entities

These appear on multiple screens. Audit these first — a mismatch here fans out everywhere.

### 1.1 Person
| Field | Type | Used on | Notes |
|---|---|---|---|
| `id` | string | everywhere | |
| `name` | string | all screens (`person.name`, `item.owner`, `curName`) | |
| `role` | string (display title) | Person profile, People & org, sidebar (`person.role`, `curRole`) | e.g. "Founder", "Head of Ops" |
| `roleProfileId` | ref → RoleProfile | Person profile, My day (`person.roleProfile`, `my.roleProfile`) | links person to tracked signals/quota |
| `department` | ref → Department | Person profile (`person.deptName`) | |
| `slackHandle` | string | Person profile (`person.slack`) | |
| `initials`, `color` | — | derived client-side | do NOT build backend fields |

### 1.2 ActionItem (the atom of the whole system)
| Field | Type | Used on | Notes |
|---|---|---|---|
| `id` | string | | |
| `title` / `task` | string | CT, My day, My team, Founder offload, Capture queue (`item.task`, `item.title`) | |
| `owner` | ref → Person | all task tables (`item.owner`) | |
| `due` | date | My day, My projects (`item.due`) | PRD: every item must have owner + deadline |
| `status` | enum `open \| in_progress \| blocked \| at_risk \| done \| dismissed` | all task tables (`item.status`, `item.state`, `item.stateLabel`) | mockup renders label + color from this; confirm exact enum values with team, then freeze |
| `source` | enum `meeting_fireflies \| slack \| manual \| founder_offload` | Capture queue, CT capture stats (`item.source`) | |
| `sourceRef` | object `{ channel?, meetingId?, timestamp, quote? }` | Capture queue (`item.quote`, `#proj-retention · 11:38`) | evidence of origin |
| `completionType` | enum `auto_evidenced \| manual_checkoff` | My day, Auto-completion ledger | PRD core concept: "evidenced, not self-declared". ⚠ depends on the completion engine — `completion_event` currently has 0 rows and no writer |
| `evidence` | string / object | Auto-completion ledger (`item.evidence`, `item.ev`) | what activity proved completion |
| `trackerState` | object `{ tracked: boolean, trackedItemId?, projectName?, promotedAt? }` | Renders wherever the mockup shows "Synced to ClickUp" / "Action items → ClickUp" | **SUPERSEDED MAPPING (amendment 2026-08-04):** the Command Centre is the task system of record; no external task tool is written to. Mockup ClickUp badges render as tracker-native state — approved items are `tracked_item` rows on `/dashboard/tracker` (landing in the `Inbox` project). Labels change to "Added to tracker" / "Action items → Tracker" |
| `confidence` | number | Capture queue (`item.conf`) | AI-extraction confidence for review UI (exists: `candidate_action_item.confidence`) |

### 1.3 Department
| Field | Type | Used on | Notes |
|---|---|---|---|
| `id`, `name` | string | CT, Department, sidebar `deptNav` (`dept.name`) | |
| `health` | enum `good \| needs_attention \| bad` | CT dept cards, Department header (`dept.healthLabel`, `item.healthLabel`) | PRD: per-department good/bad/needs-attention |
| `summary` | string | Department (`dept.summary`) | AI-generated one-liner |
| `keyStat` | `{ label, value }` | CT dept cards (`item.keyStat`) | headline metric per dept |
| `stats` | `{ label, value }[]` | Department (`dept.stats`) | stat strip |
| `flags` | booleans by type | mockup: `dept.isCreative`, `dept.isCx` | drives conditional panels (brief backlog vs agent perf); prefer a `deptType` enum over booleans |

### 1.4 Project
| Field | Type | Used on | Notes |
|---|---|---|---|
| `id`, `name` | string | CT active projects, Department, My projects (`item.project`, `item.name`) | |
| `owner` | ref → Person | (`item.owner`) | |
| `status` | enum `in_flight \| blocked \| at_risk \| done` | (`item.status`, risks lists `dept.risks`, `proj.risks`, `team.risks`) | |
| `progress` | number 0–100 | My projects (`item.progress`, `item.barColor` derived) | |
| `due` / `timeline` | date | My projects (`item.due`) | |
| `deliverySignal` | object | My projects: "delivery signal from GitHub" | e.g. `{ source: 'github', lastCommitAt, prCount }` |
| `meta` | string | cards (`item.meta`) | short subtitle, e.g. team/dept |

---

## 2. Screen-by-screen contract

### 2.1 Login (`Command Center Roles.dc.html`)
Demo screen simulates role pick; production requirement is real auth.

| Element | Data needed | Endpoint implied |
|---|---|---|
| Sign-in | session with `userId`, `role`, `departmentId` | `POST /auth/login` (or SSO) → session/JWT carrying role claims |
| "each role gets its own workspace" | role → workspace routing | role claim must be resolvable at app shell load |
| Persona list (`personaGroups`, `p.sees`) | demo-only | not a backend requirement |

**Audit checkpoints:** RBAC exists? Role claims in session? Roles enumerated: `founder, ops_lead, support_manager, cx_agent, creative, coder, agency` (from PRD persona table).

### 2.2 Sidebar / app shell (role-aware)
| Element | Data needed |
|---|---|
| Nav sections Workspace / Company / Ask (`navMyday`, `navTeam`, `navBriefs`, `navProjects`, `navAgency`, `navAutomations`, `showCompany`, `showDepts`, `showBrainBtn`) | server-known role → nav visibility map; frontend renders conditionally |
| Department list under Departments (`deptNav`) | `GET /departments` (id, name) |
| Current user chip (`curName`, `curRole`) | `GET /me` |

**Audit checkpoints:** `GET /me` returns role + department; departments listable.

### 2.3 Executive Control Tower
| Element | Data needed | Implied endpoint |
|---|---|---|
| Header "Company state · {date}" + "Live · synced 2m ago" | `lastSyncedAt` timestamp | rollup endpoint metadata |
| Department health cards (`deptCards`: name, `healthLabel`, `keyStat`, `sub`) | Department entity §1.3 | `GET /control-tower` (pre-aggregated — do NOT ship raw tasks to client) |
| Active projects (`towerProjects`) | Project entity §1.4, company-wide filter | same rollup |
| Needs attention (`attention`: `item.text`, `item.owner`, `item.age`, severity color) | flagged items: overdue/blocked/at-risk with owner + age | same rollup |
| Founder copilot panel (question → answer, `Sources: #proj-sourcing · ClickUp · Shopify`) | Q&A endpoint returning `{ answer, sources[] }` with citations | `POST /copilot/ask`; mockup also implies Slack `@command-center` bot |
| This week's capture stats (`companyStats`): captured 34, from Fireflies 22, from Slack 12, auto-completed 18, open review queue | weekly aggregate counters by source + completion type | part of rollup; needs week bucketing |

**Audit checkpoints:** does an aggregation layer exist at all (dept health, weekly counters)? Health computed from what rule? Copilot endpoint + source citation model?

### 2.4 Department detail
| Element | Data needed |
|---|---|
| Back-crumb (`crumb`) → CT | — |
| Header: name, health, summary, stats (`dept.*`) | Department §1.3 |
| Current projects (`dept.projects`) + At risk / blocked (`dept.risks`) | Project §1.4 filtered by dept |
| **Creative-only:** Brief backlog table (`dept.backlog`: Brief, Product, Owner, Age, Status) + Past performance chart (`dept.perf`: submitted vs quota, last 6 weeks, annotation "W31 dip = product launch freeze") | Brief entity §3.1 + weekly quota snapshots §3.2 |
| **CX-only:** Agent performance table (`dept.agents`: Agent, Tickets, Resolved, CSAT, Cadence) + team list (`dept.team`) | AgentPerformance §3.3 (⚠ Zendesk) |

**Audit checkpoints:** per-dept project queries; conditional panels imply `deptType`; brief/agent data pipelines exist?

### 2.5 Person profile
Tabs: Tasks / Meetings / Calendar (`person.tabTasks`, `person.tabMeetings`, `person.tabCalendar`).

| Element | Data needed |
|---|---|
| Header (`person.name`, `role`, `deptName`, `slack`, `week`) | Person §1.1 + current-week label |
| Task rows (`person.taskRows`, `person.taskCount`) | ActionItems filtered by owner |
| Meetings (`person.meetings`, `person.meetingCount`) | Meeting entity: `{ id, title, when, tool (fireflies), summary, actions[] }` |
| "Capture from Slack" panel | recent capture items where this person is owner/mentioned |
| AI summary | per-person generated summary string |
| "Action items → ClickUp" | sync status per item (§1.2 `clickupSync`) |
| Role profile & signals (`person.roleProfile`, `person.signals`) | RoleProfile §3.4 |

**Audit checkpoints:** per-person query across tasks + meetings + signals; calendar source (Google Calendar? not in PRD integration list — ⚠ flag).

### 2.6 Capture queue
| Element | Data needed |
|---|---|
| Incoming sources: Slack MCP card (`#proj-retention · 11:38`, quote, proposed item) and Fireflies transcript card ("Weekly CX sync · today 10:00") | CaptureItem = existing `candidate_action_item`: `{ id, source, sourceRef (via unified_event), source_span (quote), description (proposedTask), owner + owner_confidence, due_date, confidence, review_status }` — **largely ✅ built** |
| Review queue (`queue`, `queueCount`, `queueEmpty`) with Approve / Dismiss (`item.approve`, `item.dismiss`) | ✅ built: `review_status='pending'` list; `approveCandidate()` promotes to `tracked_item` (one transaction, `FOR UPDATE`, lands in `Inbox` project); dismiss = `review_status='rejected'` |
| ~~"Synced to ClickUp" badge~~ → **"Added to tracker" badge** (`synced`, `hasSynced`) | tracker-native promotion state per amendment 2026-08-04: `tracked_item` exists for this candidate (`tracked_item.candidate_action_item_id`). **No ClickUp write path — none is to be built** |
| Auto-completion ledger (`ledger`: Task, Owner, Evidence, When) | 🔴 depends on unbuilt completion engine — `completion_event` has 0 rows and no writer. Frontend mocks this panel until the engine exists |

**Audit checkpoints:** ingestion (Slack, Fireflies) ✅ built; extraction with confidence ✅ built; promotion ✅ built; team-scoped queue filter (per §4.1 decision) 🔴 missing; completion ledger 🔴 unbuilt.

### 2.7 People & org
| Element | Data needed |
|---|---|
| Org chart ("seeded from Miro · live embed: luckyfours.app/embed/org") | org tree: Person + reportsTo; or embed URL config (`org.groups`, `org.lead.open`, `org.ops.open`) |
| Recruiting panel ("Video editor · contract · 4 candidates in review", "CX agent · full-time · sourcing") | OpenRole: `{ title, employmentType: contract\|full_time, stage: sourcing\|in_review\|..., candidateCount }` |

**Audit checkpoints:** org structure stored anywhere? Recruiting data source (ATS? manual?) — ⚠ not in PRD integrations.

### 2.8 Founder offload
Workflow caption: "Damian surfaces a task → Ardin assigns an owner → tracked here until verifiably handed off."

| Element | Data needed |
|---|---|
| Stats strip (`offloadStats`) | counts by status |
| Table (`offloadRows`): Task, Proposed owner, Time / wk, Status | OffloadItem: `{ id, task, proposedOwner → Person, hoursPerWeek: number, status: enum proposed \| assigned \| in_transition \| handed_off (verify exact states in mockup rows), verifiedBy? }` |

**Audit checkpoints:** likely 🔴 — small dedicated model; "verifiably handed off" implies an evidence/verification field like the ledger.

### 2.9 AI search / Company AI brain
| Element | Data needed |
|---|---|
| Search box + suggested queries | static suggestions or popularity endpoint |
| Answer with **Sources** list ("Portal → CX Playbook → Returns (updated Jul 22)", "Notion → Policies → …", "Weekly CX sync (Jul 28)…") | `POST /brain/search` → `{ answer, sources: [{ system: portal\|notion\|meeting\|slack\|clickup, path/title, updatedAt, url? }] }` |
| **Permission scoping**: "Answer scoped to CX agent access — finance and HR sources excluded." | retrieval must be role-filtered; the scope note itself is displayed (`{ scopeNote }`) |

**Audit checkpoints:** RAG/search index exists? Per-source connectors (Portal, Notion, meeting transcripts)? Role-based retrieval filtering (this is a hard requirement, not cosmetic)?

### 2.10 My day (agent/IC workspace)
| Element | Data needed |
|---|---|
| Greeting + date (`my.greeting`) | `GET /me/day` |
| Today's action items (`my.today`, `my.taskRows`, `my.taskCount`, alerts `my.alerts`/`my.hasAlerts`) | ActionItems owner=me, due≤today; alert items (overdue/at-risk) |
| Recurring tasks — "completion read from activity" (`my.recurring`: task, `signal`, status) | RecurringTaskInstance: `{ task, watchedSignal, status: auto_completed \| pending \| manual_required, evidence? }` |
| Meeting panel (`my.meeting.*`: title, when, tool, summary, actions) | latest meeting touching me, from Fireflies |
| AI summary | per-user daily summary |
| "Action items → ClickUp" | sync status |
| Role signals (`my.signals`, `my.roleProfile`) | RoleProfile §3.4 |

**Audit checkpoints:** "my scope" filtering; recurring-task engine with signal evaluation (likely shared with Automations, §3.5).

### 2.11 My team (support manager workspace)
| Element | Data needed |
|---|---|
| Header "My team — CX / Support" + health (`team.healthLabel`) | team = department or sub-team; health enum |
| Agent performance table via Zendesk (`team.agents`: Agent, Tickets, Resolved, CSAT, Cadence, `item.cadence`/`cadenceColor`) | AgentPerformance §3.3, weekly window |
| Team action items — "from the weekly CX sync tracked in ClickUp" (`team.actions`) | ActionItems filtered by team, source=meeting |
| At risk / blocked (`team.risks`) | flagged items for team |
| Team member list (`team.members`) | Person[] |

### 2.12 Briefs & quota (creative workspace)
Caption: "Submissions auto-tracked from the Brief Tracker — no manual check-offs."

| Element | Data needed |
|---|---|
| This week's quota "6 / 8 · W32" + nudge text ("2 to go before Friday — writing blocks Mon & Wed on your calendar.") | QuotaStatus: `{ period: 'W32', submitted: 6, target: 8, nudge?: string }` — nudge is AI/rule-generated and calendar-aware ⚠ |
| Avg turnaround "2.1d concept → brief" | metric: `avgTurnaroundDays` |
| In ad testing "1 early winner (Santos UGC)" | AdTestStatus: `{ inTesting: n, winners: [{ name }] }` |
| Brief backlog (`briefs.backlog`: Brief, Product, Owner, Age, Status) | Brief §3.1 |
| Past performance chart (`briefs.perf`, 6 weeks, "Quota: 16/wk team-wide. W31 dip = product launch freeze (exception applied).") | WeeklyQuotaSnapshot[] §3.2 incl. `exception?: string` |

### 2.13 My projects (coder/FDE workspace)
Caption: "synced with ClickUp; delivery signal from GitHub." Footer: "Overdue items are auto-flagged to Slack — 'deadline approaching, write an update.'"

| Element | Data needed |
|---|---|
| Stats strip (`proj.stats`) | counts: total / in flight / blocked |
| Projects (`proj.projects`), In flight, Blocked/at risk (`proj.risks`), task rows (`proj.taskRows`) | Project §1.4 owner=me, with `progress`, `due`, GitHub `deliverySignal` |
| Overdue → Slack nudge | Alert rule (backend job) — surfaces here as project flag; the *rule* lives in §3.5 |

**Audit checkpoints:** GitHub integration ⚠ (in mockup, not in PRD integration list). ClickUp two-way read for projects.

### 2.14 Automations (ops/admin)
Caption: "Each role is tracked against the signals that reflect its work. Auto-completion is evidenced, never self-declared." Fallback note: "Where no reliable signal exists, tasks fall back to a lightweight manual check-off."

| Element | Data needed |
|---|---|
| Role profiles table (`auto.profiles`: Role, People, Tracked signals, Quota, Auto-complete rule, Source, Status) | RoleProfile §3.4 |
| Auto-completion rules table (`auto.rules`: Recurring task, Watched signal, Source, Fired, Status) | AutomationRule §3.5 with `firedCount`/`lastFiredAt` |

This screen is admin CRUD → needs full create/update/disable endpoints, not just reads.

### 2.15 Agency reporting
| Element | Data needed |
|---|---|
| Header "Bloom & Send — reporting" | Agency entity: `{ id, name, slackChannel: '#agency-email' }` |
| Overdue banner: "July performance report is overdue (due Aug 1)" + "post it in #agency-email and it's captured automatically" + **Post in Slack** button | ReportRequirement: `{ agency, period, dueDate, status: received \| overdue \| upcoming, capturedFrom?: slack, capturedAt? }`; deep-link to Slack channel |
| Metrics "Pulled from the Klaviyo API — you don't need to report these numbers." (`ag.metrics`) | API-sourced metrics per agency (Klaviyo etc.): `{ label, value, source }[]` |
| Reporting status + "Last captured from Slack … Parsed into 3 ongoing strategies below" (`ag.reports`, `ag.capturedQuote`, `ag.capturedWhen`) | capture log with parsed output |
| Ongoing strategies table (`ag.strategies`: Strategy, Status, Note) — "the qualitative layer, what APIs can't tell us" | Strategy: `{ name, status: enum, note }`, AI-parsed from Slack reports |

**Audit checkpoints:** Klaviyo read integration; Slack channel watcher per agency; parsing pipeline (report → strategies). Likely heavily 🔴.

---

## 3. Sub-entities & enums (referenced above)

**3.1 Brief** — `{ id, title, product, owner → Person, submittedAt?, ageDays, status: enum draft \| in_review \| submitted \| in_testing \| winner (verify against Brief Tracker PRD) }`. Source of truth: Brief Tracker.

**3.2 WeeklyQuotaSnapshot** — `{ scope: role \| team \| person, scopeId, week: 'W31', submitted, target, exception?: string }`. Needed for 6-week charts on two screens; requires weekly persistence, not on-the-fly computation.

**3.3 AgentPerformance** — `{ agent → Person, week, tickets, resolved, csat, cadence: enum on_track \| behind \| ahead }`. Source: **Zendesk** ⚠ (appears on 3 screens; absent from PRD integration list — confirm and add to backend scope).

**3.4 RoleProfile** — `{ id, role, people: Person[], trackedSignals: Signal[], quota?: { metric, target, period }, autoCompleteRule?: string, source: enum (zendesk \| brief_tracker \| clickup \| github \| klaviyo \| portal \| slack), status: active \| paused }`. This is the config backbone for My day, Briefs & quota, My team, My projects.

**3.5 AutomationRule** — `{ id, recurringTask, watchedSignal, source, fired: { count, lastAt }, status: active \| paused, fallback: manual_checkoff \| none }`. Powers the recurring-task auto-complete on My day and the ledger on Capture queue.

**3.6 Meeting** — `{ id, title, when, tool: 'fireflies', attendees: Person[], summary, actions: ActionItem[] }`.

**Status enums to freeze once, reuse everywhere:** item status, department/team health, capture status (`pending \| approved \| dismissed`), report status, brief status, cadence. The mockup renders every one of these as label+color pairs — the backend ships the enum, the frontend theme maps it to color.

---

## 4. Role → screen access matrix (from Login personas + sidebar variants)

| Screen | Founder | Ops lead | Support mgr | CX agent | Creative | Coder | Agency |
|---|---|---|---|---|---|---|---|
| Control Tower | ✓ | ✓ | | | | | |
| Department / People & org / Founder offload | ✓ | ✓ | | | | | |
| Capture queue | ✓ | ✓ | ✓ (team-scoped) | | | | |
| Automations | | ✓ | | | | | |
| My day | | | ✓ | ✓ | ✓ | ✓ | |
| My team | | | ✓ | | | | |
| Briefs & quota | | | | | ✓ | | |
| My projects | | | | | | ✓ | |
| Agency reporting | | ✓ (all) | | | | | ✓ (own) |
| AI search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

AI search results are additionally **content-scoped** by role (§2.9), which is a retrieval-layer requirement beyond page access.

### 4.1 Resolved decisions (2026-08-05)
1. **Integrations** — Zendesk, GitHub, Calendar, and Miro are confirmed in scope; backend receives access/credentials. Treat all §5 rows as buildable.
2. **Support manager Capture queue** — access granted, **team-scoped**: queue filtered to items whose proposed owner is on her team or whose source is her team's meetings/Slack channels. Basis: PRD groups her under Ops/leadership, grants agent-level visibility, and routes her Slack-issued action items through capture.
3. **Agency AI search** — **excluded**. AI brain corpus is internal (portal, transcripts, Slack, Notion); PRD use case is internal staff; agencies are external vendors with reporting-capture needs only.
4. **Retrieval-level role scoping for AI search** — confirmed as a hard backend requirement: the search index/retrieval layer must filter sources by the requesting user's role before answer generation, not merely hide UI.

### 4.2 Resolved decisions (2026-08-06)
5. **Role model (audit D1)** — dedicated `role` lookup table (`id`, `code` TEXT UNIQUE, `display_name`) with `person.role_id` FK. Code compares `role.code` ('founder', 'ops_lead', 'support_manager', 'cx_agent', 'creative', 'coder', 'agency'), never numeric ids; seeds use explicit fixed ids. Role resolved into the session at sign-in alongside the Clerk→person link (D3).
6. **Brief quota semantics (audit D9)** — the quota counts briefs **approved** (per team lead: "6 approved out of 8"), not created (current `getBriefQuota()` behavior) and not submitted (contract's earlier guess). `brief-fold.ts` already derives `approved`; the quota query changes to count approved-within-week. ⚠ Pending one-line confirmation: a brief approved in a later week than created counts toward the approval week.
7. **Department health rule (audit D2)** — **ADOPTED as rule A, 2026-08-06** (team-lead confirmation pending; thresholds are named constants, one-line tunable): `bad` = any item overdue >3 days OR ≥2 blocked; `needs_attention` = any overdue/blocked/at-risk; else `good`. Implemented in `src/lib/dept-health.ts` as `computeDeptHealth(items, now) → { status, reasons[] }` (UTC day-boundary comparison; 20 tests), consumed by four agreeing surfaces: sidebar dots, Control Tower cards, department pages, My team. No activity-based signals in v1 (attribution gap, audit D4). Still pending: whether "team" ≡ "department" (working assumption team=department, isolated in `resolveTeamScope()` in the my-team feature).

---

## 5. Integration inventory implied by the frontend

| Integration | Direction | Screens depending on it | In PRD? |
|---|---|---|---|
| ClickUp | **read-only, transitional** (content-team events; amendment 2026-08-04: no write path, none to be built; dormant `createTask`/`updateTaskStatus` to be deleted) | origin of content-team signals only; all mockup "ClickUp sync" UI renders tracker-native state | ✓ built (read) |
| Slack | ingest ✅ built (events/webhook, HMAC+replay); post (alerts, copilot bot) 🔴 not built; deep links | Capture queue, CT, Agency reporting, My projects nudges | ✓ |
| Fireflies (meetings) | ingest ✅ built (v2 webhook + GraphQL transcript fetch + extraction) | Capture queue, CT stats, My day, Person profile | ✓ |
| **UGC (internal)** | ingest ✅ built — 128 events, ⚠ 0% person attribution (no actor email) | per-person/dept metrics | ✓ (internal contract) |
| **Vision (internal)** | ingest ✅ built — brief events; state derived by event folding (`brief-fold.ts`) | Briefs & quota, Department (creative) | ✓ (internal contract) |
| Internal portal | signal source + AI-search corpus | AI search, automations signals | ✓ |
| Notion | AI-search corpus only; **pull-only, no client built yet**; NOT a task destination | AI search | ✓ (read-only) |
| ~~Shopify~~ → **Internal backend endpoints** | point-lookup stub exists (`connectors/backend/client.ts`, all methods throw `NotImplementedError`); awaiting backend engineer. **No Shopify client — none to be built** | CT copilot citations (orders/inventory) | superseded |
| Klaviyo | metrics read — 🔴 **no code exists** (env var reserved only); confirmed in scope | Agency reporting | ✓ |
| Zendesk | metrics read (tickets/CSAT) — 🔴 **no code exists**; confirmed in scope | Department, My team | confirmed 2026-08-05 |
| GitHub | delivery signal — 🔴 **no code exists**; confirmed in scope | My projects | confirmed 2026-08-05 |
| Calendar (Google?) | availability/blocks — 🔴 **no code exists**; confirmed in scope | Person profile tab, Briefs nudge | confirmed 2026-08-05 |
| Miro (or embed) | org chart seed — 🔴 **no code exists**; confirmed in scope | People & org | confirmed 2026-08-05 |
| Brief Tracker (internal) | briefs + quota feed — arrives via Vision events, folded to state | Briefs & quota, Department (creative) | ✓ (separate PRD) |

---

## 6. How to run the audit with this document

**Precedence rule: `docs/prd-amendments.md` overrides this contract wherever they conflict.** This revision (2026-08-05) already folds in the 2026-08-04 amendment (Command Centre = task system of record) and the backend-inventory findings.

**Contract ↔ existing schema map** (use these correspondences; do not re-derive):

| Contract entity | Existing implementation |
|---|---|
| ActionItem | `tracked_item` (post-approval) + `candidate_action_item` (pre-approval) |
| Capture queue | `candidate_action_item` review queue + `approveCandidate()` promotion — ✅ built |
| Auto-completion ledger | `completion_event` — 🔴 0 rows, no writer; engine unbuilt |
| RoleProfile / AutomationRule | `role_profile` / `recurring_task` — 🟡 exist, untyped JSONB, inventory says rebuild |
| "Synced to ClickUp" (any screen) | tracker-native promotion state (`tracked_item.candidate_action_item_id`) |
| Brief / brief status | Vision events folded by `brief-fold.ts` (derive, don't store) + production filter |
| Meeting | `transcript` + fireflies `unified_event`s |

1. Backend inventory → `docs/backend-inventory.md` (done 2026-08-05), read-only pass.
2. For each table in §1–§3, mark every field: ✅ port as-is / 🟡 port with refactor (state the change) / 🔴 net-new. Inherit the inventory's §8 port verdicts where they apply.
3. For §2, additionally check the *endpoint shape*: rollups must arrive pre-aggregated (Control Tower, My day); per-scope filters must exist (person, team, dept, "me"); the team-scoped capture queue filter (§4.1) is a named requirement.
4. For §5, mark each integration: built / partial / absent (the table above is pre-marked from the inventory).
5. Rate every 🟡/🔴 by effort: serializer/DTO tweak (minutes) < new query/aggregation (hours) < new integration or pipeline (days).
6. Resolve all naming disputes in the frontend's favor **at the DTO layer** (feature `api/types.ts` + `service.ts`); DB naming (snake_case, singular) is unchanged.
7. Add a "decisions required" section: email-less identity attribution (0% on UGC/Fireflies), `completion_event` engine design, and the inventory §9 discrepancies (dead `TASK_SOURCE_OF_RECORD` config, dormant ClickUp write methods, stale schema comments).
8. Output `docs/backend-audit.md`; the days-level items grouped by screen become the phase plan.
