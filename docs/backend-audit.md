# Backend Audit — Frontend Contract vs. Existing Backend

**Run:** 2026-08-05. Method per [docs/frontend-data-contract.md](./frontend-data-contract.md) §6,
against [docs/backend-inventory.md](./backend-inventory.md).

**Precedence applied.** [docs/prd-amendments.md](./prd-amendments.md) overrides the
contract wherever they conflict. The only live conflict is the task destination:
every mockup "Synced to ClickUp" / "Action items → ClickUp" element is audited as
**tracker-native promotion state** (`tracked_item.candidate_action_item_id`), not
as an external sync. Those elements are therefore **✅ built**, not 🔴 — the
amendment turned a days-level integration into a field that already exists.

**Contract ↔ schema map taken as given** (§6). Correspondences were not
re-derived.

**Naming disputes resolved in the frontend's favour at the DTO layer** (§6 step
6) — feature `api/types.ts` + `service.ts`. DB naming (snake_case, singular) is
unchanged, so every rename below is a serializer change, never a migration.

**Effort scale** (§6 step 5):

| Rating | Meaning |
| --- | --- |
| **DTO** | Serializer/DTO tweak — minutes |
| **QUERY** | New query or aggregation — hours |
| **PIPELINE** | New integration, engine, or schema+pipeline — days |

---

## Summary

Screens only (§2.1–§2.15). ✅ port as-is / 🟡 port with refactor / 🔴 net-new,
counted per contract table row.

| Screen | ✅ | 🟡 | 🔴 | Single largest blocker |
| --- | --- | --- | --- | --- |
| 2.1 Login | 0 | 1 | 1 | **No role model anywhere.** Clerk authenticates; nothing assigns or stores a role |
| 2.2 Sidebar / app shell | 0 | 1 | 2 | **No `department` table**, so `deptNav` has no source; nav visibility needs the role model |
| 2.3 Executive Control Tower | 0 | 4 | 2 | **Department health** — no table, no health rule, no per-dept rollup |
| 2.4 Department detail | 0 | 2 | 2 | **No `department` table**; CX panel additionally needs Zendesk |
| 2.5 Person profile | 3 | 4 | 0 | **Meeting entity assembly** — transcripts exist but Fireflies attribution is 0% |
| 2.6 Capture queue | 3 | 0 | 2 | **Team-scoped filter** (§4.1) has no team model to scope by |
| 2.7 People & org | 0 | 0 | 2 | **No org structure at all** — no `reports_to`, no dept, no ATS |
| 2.8 Founder offload | 0 | 0 | 2 | **Entire model absent**; `source_type` has no `founder_offload` |
| 2.9 AI search | 0 | 0 | 3 | **No retrieval layer**, and role-filtered retrieval is a hard requirement |
| 2.10 My day | 2 | 4 | 1 | **No Clerk-user → `person` mapping**, so "me" cannot be resolved |
| 2.11 My team | 0 | 3 | 2 | **No team/dept model**; agent performance needs Zendesk |
| 2.12 Briefs & quota | 1 | 1 | 3 | **No weekly persistence** — quota is current-week, computed on the fly |
| 2.13 My projects | 0 | 2 | 1 | **`project` has no due date and no progress**; GitHub absent |
| 2.14 Automations | 0 | 1 | 1 | **No rule engine** and no `fired` tracking on `recurring_task` |
| 2.15 Agency reporting | 0 | 0 | 5 | **Nothing exists** — no agency model, no Klaviyo, no Slack post path |
| **Total** | **9** | **23** | **29** | |

Core entities (§1) and sub-entities (§3), audited separately because a mismatch
there fans out:

| Section | ✅ | 🟡 | 🔴 |
| --- | --- | --- | --- |
| §1.1 Person | 3 | 2 | 1 |
| §1.2 ActionItem | 5 | 4 | 2 |
| §1.3 Department | 0 | 0 | 6 |
| §1.4 Project | 1 | 3 | 3 |
| §3 Sub-entities | 0 | 3 | 3 |

### What the shape of this says

**The ingest half is built; the aggregate half is not.** Every 🔴 at the *entity*
level is a read-model concern — department, weekly snapshots, org structure,
agency reporting. Nothing in the 🔴 column is an ingestion or extraction gap,
because §1.2 ActionItem — the atom of the whole system — is 5✅/4🟡/2🔴 with both
🔴s in one place (the completion engine).

**Three absences block far more than their own screens:** the role model, the
`department` table, and the Clerk→`person` mapping. See
[Decisions required](#decisions-required).

---

## §1 Core entities

### §1.1 Person → `person` (+ `person_identity`, `role_profile`)

| Field | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| `id` | ✅ | — | `person.id` uuid |
| `name` | ✅ | — | `person.name` |
| `role` (display title) | 🟡 | **DTO** | No display-title column. Resolve from `role_profile.name` via `person.role_profile_id`. **Already done** — `PersonProfile.person.role` exists |
| `roleProfileId` | ✅ | — | `person.role_profile_id` |
| `department` | 🔴 | **QUERY** | **No `department` table.** Needs table + FK + join. The table itself is hours; the health/stats on it are separate (§1.3) |
| `slackHandle` | 🟡 | **DTO** | From `person_identity` where `source='slack'` → `display_name`. ⚠ **Do not use `person.slack_id`** — deprecated and NULL for all 7 rows (inventory §2.2) |
| `initials`, `color` | — | — | Contract says do not build. `getRoster()` and `PersonProfile` already return `initials` client-side-equivalently; harmless |

> ⚠ **`person` is 7 rows and seeded.** `email` is deliberately absent from the
> seed (public repo) and bootstrapped via `pnpm people:email`. Email is the only
> automatic cross-system join key, so an unseeded roster resolves nobody.

### §1.2 ActionItem → `tracked_item` (post-approval) + `candidate_action_item` (pre-approval)

The contract's single most important entity, and the healthiest area of the
backend.

| Field | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| `id` | ✅ | — | Both tables |
| `title` / `task` | 🟡 | **DTO** | Two sources: `candidate_action_item.description` pre-approval, `tracked_item.title` post. ⚠ `title` is NULL unless `source_system='internal'` (enforced by `tracked_item_content_by_source_ck`). DTO must select by stage |
| `owner` | ✅ | — | `owner_person_id` → `person`, on both tables |
| `due` | ✅ | — | `tracked_item.due_date` (timestamptz) / `candidate_action_item.due_date` (**`date`**, deliberately — "Friday" has no timezone) |
| `status` | 🟡 | **DTO** | Backend: `open \| in_progress \| blocked \| done \| cancelled`. Contract wants `at_risk` and `dismissed` too. **`at_risk` = `tracked_item.risk_flag` boolean**, a separate column; **`dismissed` = `candidate_action_item.review_status='rejected'`**. Both derivable, but the enum must be frozen first — see [Decisions](#decisions-required) |
| `source` | 🟡 | **DTO** | Backend `source_type` pgEnum: `meeting \| slack \| manual \| system`. Contract wants `meeting_fireflies \| slack \| manual \| founder_offload`. `meeting`→`meeting_fireflies` is a rename; **`founder_offload` has no backend origin** (§2.8) and `system` has no contract counterpart |
| `sourceRef` `{channel?, meetingId?, timestamp, quote?}` | 🟡 | **QUERY** | `quote` = `candidate_action_item.source_span` ✅ (NOT NULL, min 10 chars — the contract's evidence requirement is already structurally guaranteed). `channel`/`meetingId` need a join through `unified_event.subject_id` / `.metadata`; `tracked_item.source_ref` holds only a single scalar |
| `completionType` | 🔴 | **PIPELINE** | Completion engine unbuilt. `completion_event` has **0 rows and no writer** (inventory §2.5) |
| `evidence` | 🔴 | **PIPELINE** | Same engine. This is the PRD's "evidenced, not self-declared" core concept |
| `trackerState` | ✅ | — | **Per amendment.** `tracked_item.candidate_action_item_id` is exactly `{tracked, trackedItemId, projectName, promotedAt}`; the tracker service already returns the join, and `tracked_item_candidate_key` guarantees one item per candidate |
| `confidence` | ✅ | — | `candidate_action_item.confidence` real, CHECK-constrained 0–1 |

> **The amendment is a net simplification here.** Had ClickUp remained the
> destination, `trackerState` would be a two-way sync with member mapping and
> rate limits. As tracker-native state it is a column that exists and a
> constraint that enforces it.

### §1.3 Department → *nothing*

**Every field is net-new. There is no `department` table** — confirmed against all
12 tables in the schema directory.

| Field | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| `id`, `name` | 🔴 | **QUERY** | New table + `person.department_id` FK + backfill for 7 people |
| `health` `good \| needs_attention \| bad` | 🔴 | **QUERY** | Needs a **defined rule**, not just a column. Nothing in the backend computes health today |
| `summary` | 🔴 | **QUERY** | AI-generated one-liner. **The pattern is already built** — reuse the `ai_summary` two-gate cache (hash → TTL) and its zero-data code guard verbatim (inventory §6.5). Extend the table's subject from `person_id` to a polymorphic subject, or add a sibling table |
| `keyStat` `{label, value}` | 🔴 | **QUERY** | Per-dept headline metric |
| `stats` `{label, value}[]` | 🔴 | **QUERY** | Stat strip |
| `flags` / `deptType` | 🔴 | **DTO** | Contract already recommends `deptType` enum over `isCreative`/`isCx` booleans. Cheap once the table exists |

> ⚠ **This single absence is the largest structural gap in the audit.** It blocks
> or partially blocks §2.2 (`deptNav`), §2.3 (dept health cards — the Control
> Tower's primary content), §2.4 (entire screen), §2.5 (`person.deptName`), and
> §2.11 (team = department).
>
> The `ai_summary` reuse is worth calling out as a genuine win: the hardest part
> of `dept.summary` — not calling the model on every render, never calling it with
> zero data, double-labelling the output — is solved and tested.

### §1.4 Project → `project`

| Field | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| `id`, `name` | ✅ | — | `project.id`, `.name`. 4 rows: `Command Center`, `Content Operations`, `Inbox`, `Studio / UGC Platform` |
| `owner` | 🟡 | **DTO** | Column is `lead_person_id`. Frontend calls it `owner` → rename at the DTO |
| `status` | 🟡 | **DTO** | Backend `active \| paused \| complete \| archived` (CHECK). Contract wants `in_flight \| blocked \| at_risk \| done`. **These are different vocabularies, not a rename** — `blocked`/`at_risk` are risk states the backend tracks per *item* (`risk_flag`), not per project. Needs the enum-freeze decision |
| `progress` 0–100 | 🔴 | **QUERY** | Not stored. Derivable as done/total from `tracked_item` — `getProjects()` already computes per-project counts, so this is an extension of an existing query, not a new one |
| `due` / `timeline` | 🔴 | **QUERY** | `project` has **no due-date column**. Schema add + DTO |
| `deliverySignal` | 🔴 | **PIPELINE** | GitHub. No code exists (§5) |
| `meta` | 🟡 | **DTO** | Short subtitle (team/dept) — trivial, but transitively blocked on §1.3 |

---

## §2 Screens

Ordered per contract §2.

### 2.1 Login — 0✅ / 1🟡 / 1🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Sign-in → session with `userId`, `role`, `departmentId` | 🟡 | **PIPELINE** | Clerk auth **is built** and `userId` is available. `role` and `departmentId` are absent — no role model, no department table. Populating role claims means Clerk `publicMetadata` (or a `person.role` column) plus a sync path |
| Role → workspace routing | 🔴 | **PIPELINE** | No role model to route on |
| Persona list (demo-only) | — | — | Explicitly not a backend requirement |

> ⚠ **RBAC was deliberately REMOVED from this codebase.** CLAUDE.md: navigation
> RBAC was powered by Clerk Organizations, which were stripped along with
> Billing, and `useOrganization`, `<Protect>`, `has({ plan })` and
> `NavItem.access` must not be reintroduced. So the seven roles in §4 are not a
> re-enable — they are a **new role model built without Clerk Organizations**.
>
> ⚠ `src/proxy.ts` uses Clerk's **deprecated** `createRouteMatcher`. Per inventory
> §4.3, new protected surfaces should do resource-based checks. The existing
> services already do (`await requireUser()` on every export) — that pattern
> extends to roles cleanly.

### 2.2 Sidebar / app shell — 0✅ / 1🟡 / 2🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Role → nav visibility map | 🔴 | **PIPELINE** | Blocked on the role model |
| Department list (`deptNav`) → `GET /departments` | 🔴 | **QUERY** | Blocked on §1.3 |
| Current user chip → `GET /me` | 🟡 | **QUERY** | Clerk gives the authenticated user. **There is no Clerk-user → `person` mapping**, so `curName`/`curRole` cannot resolve to a roster row. `person_identity` has a `'portal'` source reserved for exactly this (it is in `IDENTITY_SOURCES` but not `RAW_EVENT_SOURCES`) — the slot exists, unused |

> **Partial credit worth noting:** `GET /api/nav-badges` already exists and
> serves cached (60s) sidebar counts via `getNavCounts`, with the auth check
> deliberately *outside* the cache so one user's authorisation is never served to
> another. The badge mechanism is built; only role-conditional *visibility* is not.

### 2.3 Executive Control Tower — 0✅ / 4🟡 / 2🔴

The screen with the most existing partial support, via `getHomeSnapshot()`.

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| `lastSyncedAt` / "Live · synced 2m ago" | 🟡 | **DTO** | `HomeSnapshot.lastEvent {source, at}` exists. ⚠ Render it through `@/lib/format-date`, never `Date.now()` in a render — inventory §6.8 |
| Department health cards (`deptCards`) | 🔴 | **QUERY** | Blocked on §1.3. **This is the Control Tower's primary content** |
| Active projects (`towerProjects`) | 🟡 | **QUERY** | `getProjects()` returns company-wide projects with per-project item counts. Needs `progress` + `due` (§1.4) |
| Needs attention (`attention`) | 🟡 | **DTO** | **Genuinely built.** `HomeSnapshot.attention[]` is worst-first sorted, severity-ranked (`red`/`amber`/`unowned`), capped with a truthful uncapped `attentionTotal`, and carries `title`/`detail`/`days`/`actorName`/`href`. Contract wants `{text, owner, age, severity}` — a field rename. ⚠ Backend `kind` values are brief-and-candidate-centric (`brief_sent_back`, `brief_in_review`, `candidate_unowned`); the contract implies overdue/blocked *tasks*, which is a different query |
| Founder copilot (`POST /copilot/ask` → `{answer, sources[]}`) | 🔴 | **PIPELINE** | No retrieval layer. Shares everything with §2.9. Mockup citation `Shopify` is superseded — inventory §3.7: no Shopify client, the internal backend stub throws `NotImplementedError` on all 5 methods |
| Weekly capture stats (`companyStats`) | 🟡 | **QUERY** | `HomeSnapshot` has `reviewPending`, `reviewOldestAt`, `activity[]` (per-day counts), `activityTotal`. Needs **week bucketing split by source and by completion type**. Source split is available from `unified_event.source`; **completion type is blocked on the completion engine** |

> **Endpoint shape: ✅ compliant.** `getHomeSnapshot()` is a single
> pre-aggregated call — no raw task lists shipped to the client, exactly what §2.3
> demands. Its type header states every field comes from a real query with no
> placeholders. **Extend this endpoint rather than adding a second rollup.**

### 2.4 Department detail — 0✅ / 2🟡 / 2🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Header: name, health, summary, stats | 🔴 | **QUERY** | Blocked on §1.3 |
| Current projects + at risk/blocked | 🟡 | **QUERY** | `getProjects()` + `getBoard()` exist; needs a dept filter, which needs the dept FK |
| **Creative-only:** brief backlog + 6-week performance | 🟡 | **PIPELINE** | Backlog: `getBriefBoard()` **exists and works off real Vision events**. Performance chart needs `WeeklyQuotaSnapshot` persistence (§3.2) — currently no history at all |
| **CX-only:** agent performance + team list | 🔴 | **PIPELINE** | Zendesk. No code exists |
| Back-crumb | — | — | No data |

### 2.5 Person profile — 3✅ / 4🟡 / 0🔴

**The best-supported screen in the audit — the only one with zero 🔴.**
`getPersonProfile(personId)` already returns items, events, counts, activity-gap
reasoning and a cached AI summary.

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Header (`name`, `role`, `deptName`, `slack`, `week`) | 🟡 | **DTO** | `name` ✅, `role` ✅ (already in the DTO). `deptName` blocked on §1.3; `slack` from `person_identity`; `week` label is a formatting concern |
| Task rows (`person.taskRows`, `taskCount`) | ✅ | — | `PersonProfile.items[]` + `counts {open, overdue, done, total}`. Carries `originOwnerConfidence` — provenance the contract does not even ask for |
| Meetings (`person.meetings`, `meetingCount`) | 🟡 | **QUERY** | `transcript` (6 real rows) + Fireflies `unified_event`s exist. `ProfileEvent` is generic (`source`, `eventType`, `occurredAt`) — the Meeting entity (§3.6) needs title/summary/actions assembled. ⚠ **Fireflies attribution is 0%** (inventory §0), so "meetings touching this person" cannot currently be answered from `person_id` |
| "Capture from Slack" panel | 🟡 | **QUERY** | Filter `candidate_action_item` by `owner_person_id` — a new query over a built table |
| AI summary | ✅ | — | **Fully built**, including the two-gate cache, stale-preferred-over-empty fallback, zero-data code guard, and double labelling. `SummaryCard` carries `cached` and `generatedAt` |
| "Action items → ClickUp" | ✅ | — | **Per amendment**, renders as tracker-native state. Already present |
| Role profile & signals | 🟡 | **DTO** | `role_profile` exists; `tracked_signals` is untyped JSONB (inventory says rebuild) |
| Calendar tab | 🔴 | **PIPELINE** | ⚠ Not counted above — the contract lists it as a tab, not a table row. Calendar integration is confirmed in scope (§4.1) but **no code exists** |

### 2.6 Capture queue — 3✅ / 0🟡 / 2🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Incoming source cards (Slack + Fireflies) | ✅ | — | Contract itself marks this "largely ✅ built". `candidate_action_item` supplies `source_span` (the quote), `description`, owner + `owner_confidence`, `due_date`, `confidence`, `review_status`. **19 real rows** |
| Review queue + Approve / Dismiss | ✅ | — | `approveCandidate()` / `rejectCandidate()`: one transaction, `SELECT … FOR UPDATE` so a double-click reads as "already decided", lands in the `Inbox` project. Dismiss = `review_status='rejected'` |
| "Added to tracker" badge | ✅ | — | Per amendment |
| Auto-completion ledger | 🔴 | **PIPELINE** | Completion engine unbuilt |
| **Team-scoped queue filter (§4.1)** | 🔴 | **QUERY** | Named requirement. Filter to candidates whose proposed owner is on the manager's team **or** whose source is her team's meetings/Slack channels. The owner half is a join once a team model exists; **the source half needs channel→team mapping, which does not exist** — Slack events are stored workspace-wide with no team dimension |

> ⚠ **One live defect inherited from the inventory.** `content_hash` idempotency
> is over `owner_name + source_span`, and the model does not reproduce
> `source_span` byte-identically across runs even at temperature 0 — so a
> re-extraction can create a duplicate pending row. **⚠ MEASURED: latent, not
> active** — 0 duplicate hashes and 0 duplicate owner+span pairs across all 19
> rows. The queue is the screen where a duplicate would surface. Inventory §2.3
> prescribes span *overlap* matching rather than exact equality; do not "fix" it
> by hashing the description.

### 2.7 People & org — 0✅ / 0🟡 / 2🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Org chart (`org.groups`, seeded from Miro) | 🔴 | **PIPELINE** | **No org structure whatsoever** — no `reports_to`, no department, no Miro client. Cheapest viable path: `person.reports_to` + `department_id` and drop the Miro seed (an embed URL is config, not an integration) |
| Recruiting panel / OpenRole | 🔴 | **PIPELINE** | No model, no ATS, not in the PRD integration list. Contract flags it ⚠ itself |

### 2.8 Founder offload — 0✅ / 0🟡 / 2🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Stats strip (`offloadStats`) | 🔴 | **QUERY** | Counts by status, once the model exists |
| Table (`offloadRows`) / OffloadItem | 🔴 | **QUERY** | Small dedicated model: `{task, proposedOwner, hoursPerWeek, status: proposed\|assigned\|in_transition\|handed_off, verifiedBy?}`. **`source_type` has no `founder_offload` value** — it is a pgEnum (`meeting\|slack\|manual\|system`), so adding one is an `ALTER TYPE`, which cannot run inside a transaction |

> The contract's own note is right: "verifiably handed off" implies the same
> evidence/verification concept as the completion ledger. **Design these two
> together** — one evidence model, two surfaces. Doing them separately produces
> two incompatible notions of proof.
>
> ⚠ Note the precedent for the enum problem: `tracked_item.source_system` and
> `.status` were both converted from pgEnum to TEXT+CHECK precisely because
> `ALTER TYPE` cannot run in a transaction and a value can never be removed.
> `source_type` is the remaining pgEnum and is about to need a new value.

### 2.9 AI search / Company AI brain — 0✅ / 0🟡 / 3🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Search box + suggested queries | 🔴 | **QUERY** | Static suggestions are trivial; a popularity endpoint needs a query log |
| Answer + `sources[]` with citations | 🔴 | **PIPELINE** | **No retrieval layer, no index, no embeddings.** Corpus spans portal, Notion, transcripts, Slack — **the Notion client does not exist** (pull-only; `pnpm verify:notion` is a credential check, not a client) |
| **Retrieval-level role scoping** | 🔴 | **PIPELINE** | §4.1 decision 4 makes this a **hard backend requirement**: the retrieval layer must filter sources by role *before* answer generation, not hide UI. Blocked on the role model, and it cannot be retrofitted cheaply — it is an index-partitioning decision |

> Assets that do exist and should be reused: `complete()` in `src/lib/ai/client.ts`
> with its tier abstraction, the one-file vendor confinement in `provider.ts`, and
> every hard-won parsing rule — **no `response_format`** (silently ignored on some
> OpenRouter routes), prompt for bare JSON, strip fences defensively, Zod as the
> actual guarantee. Also reuse the citation discipline from §6.5: trust our own
> counts, not the model's.
>
> ⚠ **Agency AI search is excluded** (§4.1 decision 3) — so this screen needs
> role-based *exclusion*, not just scoping, from day one.

### 2.10 My day — 2✅ / 4🟡 / 1🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Greeting + date → `GET /me/day` | 🟡 | **QUERY** | Needs the Clerk→`person` mapping to resolve "me" |
| Today's action items + alerts | 🟡 | **QUERY** | `tracked_item` by owner exists (`getPersonProfile` proves the query); needs `due ≤ today` + overdue/at-risk flagging. `counts.overdue` already computed; `risk_flag` exists |
| Recurring tasks — "completion read from activity" | 🔴 | **PIPELINE** | The completion engine. `recurring_task` has 5 seeded rows, `cadence`, and an untyped `auto_complete_rule` JSONB — **but nothing evaluates it** and `completion_event` has no writer |
| Meeting panel | 🟡 | **QUERY** | Same as §2.5: transcripts exist, Meeting assembly + 0% Fireflies attribution |
| AI summary (daily) | ✅ | — | Per-person summaries built; a daily variant reuses the two-gate cache. ⚠ Hash the day's inputs, **not** `updated_at` |
| "Action items → ClickUp" | ✅ | — | Per amendment |
| Role signals | 🟡 | **DTO** | `role_profile.tracked_signals` untyped JSONB |

> **Endpoint shape: 🔴 non-compliant.** §2.3/§2.10 require rollups
> pre-aggregated. `GET /me/day` does not exist in any form, and the per-scope
> filter it needs ("me") has no resolution path. This is the screen where the
> Clerk→`person` gap bites hardest — every other element is close.

### 2.11 My team — 0✅ / 3🟡 / 2🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Header + team health | 🔴 | **QUERY** | No team/dept model, no health rule |
| Agent performance (Zendesk) | 🔴 | **PIPELINE** | No code exists. Appears on 3 screens (§3.3) |
| Team action items ("from the weekly CX sync") | 🟡 | **QUERY** | `tracked_item` filtered by team + `source_type='meeting'`. ⚠ Contract text says "tracked in ClickUp" — **superseded**, reads as tracker-native |
| At risk / blocked | 🟡 | **QUERY** | `risk_flag` + `status='blocked'` exist; needs team scope |
| Team member list | 🟡 | **QUERY** | `getRoster()` exists (id, name, initials); needs team scope |

### 2.12 Briefs & quota — 1✅ / 1🟡 / 3🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| This week's quota "6 / 8 · W32" | 🟡 | **QUERY** | `getBriefQuota()` **exists**: real per-person counts since Monday vs `role_profile.quota_config.briefsPerWeek`, and it returns `configured: false` rather than rendering a 0-of-0 bar when no quota is set. ⚠ **Two mismatches:** it counts `brief.created` while the contract wants *submitted*; and it is **current-week only, computed on the fly** |
| ↳ *nudge text (calendar-aware)* | 🔴 | **PIPELINE** | Sub-line of the row above, **not counted separately** — it is the blocker that makes that row 🟡 rather than ✅. Calendar integration absent; nudge is AI/rule-generated |
| Avg turnaround "2.1d concept → brief" | 🔴 | **QUERY** | Derivable by folding Vision events (`brief.created` → `brief.submitted` deltas) — real data exists for this |
| In ad testing / winners | 🔴 | **PIPELINE** | No model, no source. `BRIEF_STATES` has no `in_testing`/`winner` |
| Brief backlog | ✅ | — | `getBriefBoard()` — real Vision events, folded by `brief-fold.ts`, production-filtered |
| 6-week performance chart + exception annotation | 🔴 | **PIPELINE** | `WeeklyQuotaSnapshot` (§3.2) needs **weekly persistence**; the contract says explicitly this cannot be on-the-fly. Plus an `exception` field ("W31 dip = product launch freeze") |

> ⚠ **A real semantic decision hides here.** `brief-fold.ts` derives state by
> folding events and **deliberately stores nothing** — "a stored state is a second
> source of truth that can disagree with the log it came from." `WeeklyQuotaSnapshot`
> requires the opposite: persisted weekly rows. These are reconcilable (a snapshot
> is a point-in-time *observation*, not a competing state) but the distinction has
> to be deliberate, or the snapshot table becomes a second brief-state store.

### 2.13 My projects — 0✅ / 2🟡 / 1🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Stats strip (total / in flight / blocked) | 🟡 | **DTO** | `getProjects()` already returns per-project item counts and non-terminal counts |
| Projects / in flight / blocked / task rows | 🟡 | **QUERY** | Needs `owner=me` scope (Clerk→`person`), plus `progress` and `due` (§1.4) |
| Overdue → Slack nudge | 🔴 | **PIPELINE** | Two gaps: **Slack posting is not built** (ingest only — §5), and there is no alert-rule engine (§3.5). ✅ Slack *posting* is at least de-risked: DMs work with `chat:write` alone, `im:write` verified unnecessary |

> ⚠ Contract caption says "synced with ClickUp" — **superseded**. Renders as
> tracker-native. GitHub `deliverySignal` remains 🔴.
>
> ⚠ If a Slack bot posts here, the **bot user id loop guard** is mandatory: every
> message the bot posts returns as an `event_callback`, and without the guard a
> replying bot replies to its own reply — an infinite loop billed per LLM call
> that looks like a runaway worker, not a missing `if`.

### 2.14 Automations — 0✅ / 1🟡 / 1🔴

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Role profiles table | 🟡 | **QUERY** | `role_profile` exists with 7 seeded rows, but `tracked_signals`, `quota_config` and `source_channels` are all **untyped JSONB** and inventory §8 says *rebuild*. Screen is admin CRUD → needs create/update/disable, and only reads exist |
| Auto-completion rules table | 🔴 | **PIPELINE** | `recurring_task` has `cadence`, `auto_complete_rule` JSONB and `fallback_manual`, but **no `fired` count, no `lastFiredAt`, and nothing evaluates the rule**. The engine is the work; the table is a placeholder |

> This screen is where the completion engine's *configuration* lives, so it and
> the ledger (§2.6) and My day's recurring panel (§2.10) are **one feature with
> three surfaces**. Sequence them together.

### 2.15 Agency reporting — 0✅ / 0🟡 / 5🔴

Nothing in the backend supports this screen.

| Element | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| Agency entity `{id, name, slackChannel}` | 🔴 | **QUERY** | New model. ⚠ No `person`/roster concept covers external vendors |
| ReportRequirement + overdue banner + **Post in Slack** | 🔴 | **PIPELINE** | New model + **Slack posting (not built)** |
| Klaviyo metrics | 🔴 | **PIPELINE** | `KLAVIYO_API_KEY` is reserved in `.env.example` and **no code exists** — grep confirms the name appears only as a *tool label* in `role-profile-form.tsx` and `seed.ts`. Confirmed in scope (§4.1) |
| Capture log + parsed output | 🔴 | **PIPELINE** | Needs a per-agency Slack channel watcher. ✅ Partially de-risked: Slack events are already stored **workspace-wide** and the architecture explicitly forbids channel-prefix filtering at ingest ("an event never stored cannot be replayed"), so the raw material would already be landing |
| Ongoing strategies (AI-parsed from Slack) | 🔴 | **PIPELINE** | A second extraction target. ⚠ **Do not build a second extraction path** — inventory §6.3: one path, one prompt, one schema, or the eval measures only one of them while appearing to cover extraction as a whole |

---

## §3 Sub-entities

| Entity | Verdict | Effort | Notes |
| --- | --- | --- | --- |
| **3.1 Brief** | 🟡 | **QUERY** | Derived by folding Vision events — real data, production-filtered, `getBriefBoard()` built. ⚠ **Status enums disagree:** backend `BRIEF_STATES = in_progress \| in_review \| sent_back \| approved`; contract wants `draft \| in_review \| submitted \| in_testing \| winner`. Only `in_review` overlaps. Also **no `product` field** |
| **3.2 WeeklyQuotaSnapshot** | 🔴 | **PIPELINE** | Weekly persistence + `exception?`. Needed by two screens' 6-week charts. See the derive-vs-store note in §2.12 |
| **3.3 AgentPerformance** | 🔴 | **PIPELINE** | Zendesk. Appears on 3 screens; no code exists |
| **3.4 RoleProfile** | 🟡 | **QUERY** | Table exists; three untyped JSONB columns; inventory says rebuild. It is "the config backbone for My day, Briefs & quota, My team, My projects" — so **typing it is high-leverage** |
| **3.5 AutomationRule** | 🔴 | **PIPELINE** | No `fired` tracking, no engine |
| **3.6 Meeting** | 🟡 | **QUERY** | `transcript` (6 real rows, 13–1060 sentences) + Fireflies `unified_event`s + extracted `actions` all exist. Needs assembly into one DTO. ⚠ `attendees: Person[]` is blocked by **0% Fireflies attribution** |

### Enum freeze (contract §3 closing note)

The contract asks for enums frozen once and reused. Current state of disagreement:

| Enum | Backend | Contract | Gap |
| --- | --- | --- | --- |
| Item status | `open \| in_progress \| blocked \| done \| cancelled` | + `at_risk`, `dismissed`; no `cancelled` | `at_risk` = `risk_flag` col; `dismissed` = candidate `rejected` |
| Capture status | `pending \| approved \| rejected \| auto_approved` | `pending \| approved \| dismissed` | `rejected`→`dismissed` rename; `auto_approved` unrepresented in the UI |
| Brief status | `in_progress \| in_review \| sent_back \| approved` | `draft \| in_review \| submitted \| in_testing \| winner` | Only 1 of 5 overlaps |
| Project status | `active \| paused \| complete \| archived` | `in_flight \| blocked \| at_risk \| done` | Different vocabularies |
| Health | *(none)* | `good \| needs_attention \| bad` | Net-new |
| Cadence | `daily \| weekly \| biweekly \| monthly \| quarterly` | `on_track \| behind \| ahead` | ⚠ **Different concepts under one word** — backend cadence is a *schedule*, contract cadence is *adherence* |

> All of these are DTO-layer resolutions per §6 step 6 — **except** where the
> backend has no value to map from (health, `in_testing`, `winner`), which are
> genuinely net-new. The cadence collision is worth renaming in the contract:
> two different things are called `cadence` on the same screen (§2.11 uses it for
> adherence; `recurring_task.cadence` is a schedule).

---

## Endpoint shape audit (§6 step 3)

| Requirement | Status | Notes |
| --- | --- | --- |
| **Control Tower rollup pre-aggregated** | ✅ **Compliant** | `getHomeSnapshot()` is a single call returning severity-ranked attention rows, pipeline counts, activity buckets and review counts. No raw task lists reach the client. **Extend it; do not add a second rollup** |
| **My day rollup pre-aggregated** | 🔴 **Missing** | `GET /me/day` does not exist |
| **Per-scope filter: person** | ✅ | `getPersonProfile(personId)` |
| **Per-scope filter: project** | ✅ | `getBoard(projectId)` |
| **Per-scope filter: "me"** | 🔴 | **No Clerk-user → `person` mapping.** Blocks §2.10 and §2.13 entirely |
| **Per-scope filter: team** | 🔴 | No team model. Blocks §2.11, and the §4.1 capture filter |
| **Per-scope filter: department** | 🔴 | No `department` table. Blocks §2.3, §2.4 |
| **Team-scoped capture queue (§4.1)** | 🔴 | Owner half is a join once teams exist. **Source half needs channel→team mapping, which does not exist** |
| Auth on every entry point | ✅ | `await requireUser()` on every `'use server'` export — resource-based, not matcher-based. The right foundation for role checks |

> **Architectural note.** The current read path is **Server Actions + ORM** (8
> features), not route handlers — inventory §4.3. Every contract "implied
> endpoint" (`GET /control-tower`, `POST /copilot/ask`, `GET /me/day`) maps to a
> Server Action today, not an HTTP route. That satisfies the *shape* requirement
> but means the contract's endpoint names are notional. If the rebuild exposes a
> real HTTP API, these become genuine routes and the pre-aggregation rule carries
> over unchanged.

---

## Integration status (§5, pre-marked — confirmed against the inventory)

| Integration | Status | Screens blocked |
| --- | --- | --- |
| Slack **ingest** | ✅ built | — |
| Slack **post** (alerts, copilot bot) | 🔴 absent | §2.13, §2.15, §2.3 copilot |
| Fireflies | ✅ built | — (⚠ 0% attribution) |
| UGC (internal) | ✅ built | — (⚠ 0% attribution, 128 events) |
| Vision (internal) | ✅ built | — |
| ClickUp | ✅ built (read) | — (⚠ dormant write methods to delete) |
| Notion | 🔴 no client | §2.9 |
| Internal backend (ex-Shopify) | 🟡 stub, all methods throw | §2.3 copilot citations |
| Klaviyo | 🔴 no code | §2.15 |
| Zendesk | 🔴 no code | §2.4, §2.11, §3.3 |
| GitHub | 🔴 no code | §2.13, §1.4 `deliverySignal` |
| Calendar | 🔴 no code | §2.5 tab, §2.12 nudge |
| Miro | 🔴 no code | §2.7 (avoidable — an embed URL is config) |

**Five confirmed-in-scope integrations have zero code:** Klaviyo, Zendesk,
GitHub, Calendar, Miro. Per §4.1 all are buildable — credentials are coming.

> ⚠ **Third-party integrations must be developed against DUMMY accounts first**
> (CLAUDE.md, security requirement). Early integration code sends malformed
> requests, retries too fast, and occasionally writes. **The cost lands on
> evaluation** — a fresh test account has no history, which is exactly why
> `fixtures/extraction-eval/real/` is empty and real extraction accuracy is still
> unmeasured. **Raise the account question for Zendesk and Klaviyo now**, not at
> eval time.

---

## Decisions required

Per §6 step 7. Ordered by how many screens each unblocks.

### D1. The role model — who assigns a role, and where does it live? 🔴 blocks 9 screens

§4's matrix needs seven roles (`founder, ops_lead, support_manager, cx_agent,
creative, coder, agency`). **Nothing in the backend has a role concept** for
access. RBAC was deliberately removed with Clerk Organizations, and
`useOrganization` / `<Protect>` / `NavItem.access` must not be reintroduced.

Open: Clerk `publicMetadata` vs a `person.role` column vs reusing
`role_profile`? Note `role_profile` currently means *tracked signals + quota*
(work config), **not access** — conflating them is tempting and wrong: a Creative
and a Coder have different quotas *and* different access, but an Ops lead and a
Founder share access while differing on neither signals nor quota.

**Hardest constraint:** §4.1 decision 4 makes role-filtered *retrieval* a hard
requirement for AI search — an index-partitioning decision that cannot be
retrofitted cheaply. Decide before building the search index, not after.

### D2. `department` — the missing table 🔴 blocks 5 screens

No `department` table exists. Blocks §2.2 `deptNav`, §2.3 dept health cards (the
Control Tower's primary content), §2.4 entirely, §2.5 `person.deptName`, §2.11
(team = department?).

Open: (a) is "team" the same thing as "department", or a sub-level? §2.11 and the
§4.1 capture filter both say "team"; §2.4 says department. (b) **What is the
health rule?** `good | needs_attention | bad` needs a definition, not a column —
and it is the Control Tower's headline signal, so a hand-wavy rule becomes the
number the founder reads every morning.

### D3. Clerk user → `person` mapping 🔴 blocks 2 screens + all "me" scoping

There is no link between an authenticated Clerk user and a `person` row, so "me"
cannot be resolved. Blocks §2.10 (every element), §2.13, and the `GET /me` chip.

**The slot already exists and is unused:** `person_identity` reserves
`source='portal'` for the Command Centre's own Clerk instance — it is in
`IDENTITY_SOURCES` but deliberately not in `RAW_EVENT_SOURCES`. Writing a
`('portal', clerkUserId)` identity on first sign-in reuses the resolver, the
provenance CHECK, and the whole unresolved-queue machinery. **Cheapest high-value
fix in this audit** — hours, not days.

⚠ Ids are **not** comparable across the three Clerk instances (Vision, UGC,
Command Centre) and may collide. Identity must stay the pair
`(source, external_id)`.

### D4. Email-less identity attribution — 0% on UGC and Fireflies 🔴 quality gap on every per-person metric

**⚠ MEASURED 2026-08-05** (re-checked at audit time; `raw_event` was 584):

| Source | Events | Attributed | Rate |
| --- | --- | --- | --- |
| `slack` | 11 | 10 | 90.9% |
| `clickup` | 2 | 1 | 50.0% |
| `vision` | 433 | 188 | 43.4% |
| `ugc` | 128 | 0 | **0.0%** |
| `fireflies` | 10 | 0 | **0.0%** |

⚠ **Ingestion is live, so these drift.** The inventory recorded 578 events and
42.6% Vision attribution hours earlier; both moved without any code change. The
**two zeroes are structural and have not moved** — that is the finding, not the
percentages.

This is not a bug — both internal platforms document `actor.email` as nullable
and Fireflies webhooks carry no actor at all. But it means **every per-person and
per-department metric silently under-reports**, and reads as "no activity" rather
than "no attribution". §2.3, §2.4, §2.5, §2.10, §2.11 all consume attributed
counts.

Open: (a) can UGC/Vision add `actor.email` to their envelopes? Cheapest fix by
far, and it is an internal contract. (b) For Fireflies, do we resolve speakers
from `speakers[]` + `participants[]`? ⚠ Constrained: `speakers[]` is `{id, name}`
with **no email**, nothing links a speaker to a participant entry, and **name
matching is never an auto-match at any confidence level** — a wrong auto-link
silently attributes one person's work to another. (c) Do we surface an
"unattributed" count in the UI so the gap is visible rather than invisible?
`HomeSnapshot.identitiesUnlinked` already does this for identities — extend the
pattern.

### D5. The completion engine — `completion_event` design 🔴 blocks 4 surfaces

`completion_event` has **0 rows and no writer**; `recurring_task.auto_complete_rule`
is untyped JSONB that nothing evaluates. This blocks §1.2 `completionType` +
`evidence`, §2.6 ledger, §2.10 recurring panel, §2.14 rules table — and it is the
PRD's core concept ("evidenced, not self-declared").

Open: (a) what evaluates a rule — a cron, or a reaction to each `unified_event`?
(b) What is the evidence model, and **is it shared with Founder offload's
"verifiably handed off"** (§2.8)? Design them together or get two incompatible
notions of proof. (c) `fallback_manual` exists on the table — when does a task
fall back, and who decides?

### D6. Enum freeze 🟡 blocks clean DTOs on every screen

Six enums disagree between backend and contract (table in §3 above). All are
DTO-layer resolutions per §6 step 6 — but they must be frozen **once**, not
per-screen, or each feature invents its own mapping. Two need real decisions
rather than renames: **brief status** (only 1 of 5 values overlaps) and
**cadence** (backend = schedule, contract = adherence — two concepts, one word).

### D7. Inventory §9 discrepancies — resolve, don't port

Per §6 step 7, all three carried forward:

1. **Dead `TASK_SOURCE_OF_RECORD` config.** `src/config/env.ts` exposes
   `taskSourceOfRecord()` defaulting to **`'clickup'`** — the opposite of the
   2026-08-04 amendment. **⚠ MEASURED: zero consumers** outside its own file and
   test. Delete the module, or reduce it to what is actually read. Until then it
   is a live invitation to build the wrong thing.
2. **Dormant ClickUp write methods.** `createTask()` and `updateTaskStatus()` are
   implemented and tested; **only tests call them**, so the no-write-path rule
   holds in practice. §5 of the contract already says "to be deleted". Do it —
   every mockup ClickUp badge now renders tracker-native, so nothing needs them.
3. **Stale schema comments.** `candidate-action-item.ts` still says "THE
   DESTINATION IS NOTION (Ocean)"; `tracked-item.ts` still describes ClickUp as
   system of record per PRD §3.2. **The constraints are correct; only the prose is
   stale** — but this audit's whole precedence rule exists because of that prose.

### D8. Weekly persistence vs. derive-don't-store 🟡 blocks 2 charts

`brief-fold.ts` deliberately stores nothing: "a stored state is a second source of
truth that can disagree with the log it came from." `WeeklyQuotaSnapshot` (§3.2)
requires persisted weekly rows, and the contract says explicitly this cannot be
on-the-fly.

Reconcilable — a snapshot is a point-in-time *observation*, not a competing state
— but say so explicitly, or the snapshot table quietly becomes a second brief
store. Also decide the `exception` mechanism ("W31 dip = product launch freeze"):
who sets it, and is it per-scope or global?

### D9. `getBriefQuota()` counts `brief.created`, contract wants *submitted* 🟡 1 screen

A one-line semantic difference with real consequences: creating a brief is not
submitting one, and the quota headline ("6 / 8") is the creative's primary
metric. Confirm which event the quota counts before the chart is built on top of it.

---

## Phase plan (§6 step 8 — days-level items grouped by screen)

PIPELINE-rated work only, ordered so that unblockers come first.

**Phase 0 — unblockers (no screen ships, 5 screens become buildable)**
- D3 Clerk→`person` via `person_identity('portal', …)` — hours, not days
- D2 `department` table + `person.department_id` + health rule
- D1 role model + role claims

**Phase 1 — completion engine** → §2.6 ledger, §2.10 recurring, §2.14 rules, §1.2 `completionType`/`evidence`
- Design with §2.8 Founder offload's verification model (D5)

**Phase 2 — weekly persistence** → §2.4 creative perf chart, §2.12 6-week chart
- `WeeklyQuotaSnapshot` + `exception` (D8)

**Phase 3 — external integrations** (each independent, all need dummy accounts first)
- Zendesk → §2.4 CX panel, §2.11 agent perf, §3.3
- GitHub → §2.13 `deliverySignal`, §1.4
- Slack **post** → §2.13 nudge, §2.15 button, §2.3 copilot bot
- Calendar → §2.5 tab, §2.12 nudge
- Klaviyo → §2.15 metrics

**Phase 4 — retrieval layer** → §2.9, §2.3 copilot
- ⚠ Role-filtered retrieval (D1) is an index-partitioning decision. **Decide
  before indexing.**

**Phase 5 — remaining net-new models**
- §2.8 Founder offload · §2.7 org + recruiting · §2.15 agency reporting

> ⚠ **§2.15 Agency reporting is 5/5 🔴 and depends on Slack post + Klaviyo + a
> parsing pipeline.** It is the largest single block of net-new work in the
> contract. If the Aug 13 delivery is tight, this is the screen to defer — and its
> strategy-parsing must reuse the one extraction path, not add a second.
