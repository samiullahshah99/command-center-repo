# Gaps — mocked surfaces in shipped UI

**What this file is for.** Every place the app renders data that is **invented**
rather than queried. A mocked panel in the real app is indistinguishable from a
working one to anyone who did not build it, and the first person to quote a number
off a placeholder has been misled by us. This is the list to check before anyone
screenshots a screen for a stakeholder.

**The rule these entries follow.** Mocked data lives behind the feature's own
service seam (`api/service.ts`), is typed like the real thing, carries an
`isSample` flag in its DTO, and the UI renders a visible **"Sample data"**
caption from that flag — so a renderer cannot show the data without the caption,
and flipping one field in one file removes both.

> Related, but not the same thing: `src/app/dashboard/*` stubs that render
> "Not built yet" show **no data at all**. Those are listed in
> [docs/backend-audit.md](./backend-audit.md) §8, not here — an empty stub cannot
> mislead anyone.

---

## People & org — the Miro org-chart claim *(a relabel, not a mock)*

| | |
| --- | --- |
| **Surface** | `/dashboard/people` → subtitle |
| **Mockup says** | "Org chart seeded from Miro · live embed: luckyfours.app/embed/org" |
| **We render** | "Org chart derived live from roles and departments." |
| **Audit ref** | §2.7 — an embed URL is config, not an integration |

⚠️ **NOTHING IS MOCKED HERE — the claim was removed, not simulated.** There is no
Miro integration, no Miro credential, no embed route, and no `luckyfours.app/embed`
anywhere in this repo. The chart the page renders is genuinely derived from `role`
and `department`, so the subtitle now describes what actually produced it.

**Why the mockup's line could not ship as written.** It names a *source of truth*
for the org chart. A reader who believes the chart mirrors Miro will go and fix a
wrong reporting line **in Miro** and wait for it to appear here — and it never
will, because the arrow points the other way: this chart is built from
`person.role_id` and `person.department_id`, and Miro (if it exists at all) is
downstream of nobody. That is a worse failure than a missing feature, because
nothing looks broken.

### If the team does want the real Miro embed

Per audit §2.7, **this is a one-line env var, not a build.** An embed is an
`<iframe>` pointing at a board URL — no OAuth, no client, no webhook, no sync. Add
the URL to config, render the iframe, and drop the derived chart or keep both. What
it is *not* is an integration: an embedded board cannot be queried, cannot be
diffed against the roster, and would not keep itself in step with `person`. So if
both ship, the derived chart stays the source of truth and the embed is a picture.

---

## People & org — Recruiting card (fully mocked)

| | |
| --- | --- |
| **Surface** | `/dashboard/people` → "Recruiting" card |
| **Generator** | `sampleOpenRoles()` in `src/features/people/api/service.ts` |
| **Marker** | `TODO(backend): recruiting source (model or ATS — decision not yet made)` |
| **DTO flag** | `PeopleOrg.recruitingIsSample` |
| **Audit ref** | §2.7 — no ATS in the PRD's integration list |

⚠️ **EVERY FIELD IS INVENTED.** There is no recruiting model, no `open_role` table,
and no ATS connection. Nothing in this database describes a hiring pipeline, so
there is no query that could return these rows — unlike most gaps on this page,
this one is not "a real table we have not wired up yet".

Two illustrative rows render behind a `SampleDataCaption`. **The decision is
upstream of the build:** a lightweight `open_role` table we own, or an ATS
integration, has not been made yet.

> ⚠️ **Do NOT resolve this by adding an `open_role` table and seeding it.** A
> seeded vacancy is indistinguishable from a real one at the database level, and a
> vacancy is exactly the kind of thing someone repeats out loud in a meeting or
> forwards to a candidate. The caption is the safeguard; a seed removes it.

⚠️ **Everything else on this screen is real** — every chip, name, role display and
department comes from `person`, `role` and `department`. The org chart is not
mocked in any part.

---

## Automations — rule FIRED counts (hybrid)

| | |
| --- | --- |
| **Surface** | `/dashboard/automations` → "Auto-completion rules" card, FIRED column |
| **Generator** | `sampleFired()` in `src/features/automations/api/service.ts` |
| **Marker** | `TODO(backend): completion engine (audit D5)` |
| **DTO flag** | `Automations.firedIsSample` |
| **Audit ref** | D5, §2.14, §3.5 AutomationRule |

⚠️ **Hybrid — read the split.**

**Real:** every recurring task row, its owner, its cadence, its watched signal
(from `auto_complete_rule.source` + `.event`), its `fallback_manual` flag, and
**both status columns**. Also real: the entire Role profiles table — names, people
counts and names, tracked signals, quota, rule and source.

**Invented:** the FIRED count and last-fired timestamp. `completion_event` has **0
rows and no writer**, and nothing evaluates `auto_complete_rule` — so nothing has
ever fired. Counts are derived from the row's index and cadence (a daily task
plausibly fires more than a weekly one) and share the Capture-queue ledger's
one-day-apart spread, so the same task tells the same story on both screens.

> ⚠️ **NEVER seed `completion_event` to fix this.** A seeded row makes a
> fabricated firing indistinguishable from a measured one at the database level.

### ⚠️ Two DERIVED status columns — and the swap point

Neither `role_profile` nor `recurring_task` has a status column. Both pills are
computed in `../api/service.ts`:

| Column | Derivation |
| --- | --- |
| Role profile → STATUS | `live` when the profile's people have an auto-complete rule; `manual` otherwise |
| Rule → STATUS | `active` when a rule exists; `manual_fallback` when only `fallback_manual`; `no_rule` otherwise |

**When the `role_profile` rebuild (audit §3.4) adds a real status column, those two
functions are the only place to change.** The derivation is deliberately kept out of
the components — a derived value that looks stored is how a screen starts
disagreeing with the database.

⚠️ **A rule wins over a fallback in the status.** Two of the five seeded tasks carry
BOTH a rule and `fallback_manual = true`. They read "Active", because something *is*
watching; the fallback is surfaced separately on the row ("manual fallback
available") so the real field is not hidden by the derivation.

⚠️ **`manual_fallback` is warning, not destructive.** The PRD plans for it — "where
no reliable signal exists, tasks fall back to a lightweight manual check-off" — so it
is a known design limitation, not a failure.

### The three untyped JSONB columns

`tracked_signals`, `quota_config` and `source_channels` are untyped jsonb and the
inventory says rebuild them (audit §3.4). Every parse on this page returns a
fallback and **cannot throw** — exercised against arrays, nulls, strings, numbers,
mixed-type arrays, `NaN`, `Infinity`, negatives and stringified numbers. A malformed
config renders an em dash in one cell rather than taking down the operator's only
view of what is configured. **Today every `quota_config` is `{}`, so the QUOTA
column is em dashes across the board** — that is real, not a gap.

---

## My projects — Slack nudge status note *(not a data mock)*

| | |
| --- | --- |
| **Surface** | `/dashboard/my-projects` → foot of the "Blocked / at risk" card |
| **Renderer** | `SlackNudgeNote` in `src/features/my-projects/components/my-projects-body.tsx` |
| **Marker** | `TODO(backend): slack post + alert rule` |
| **Audit ref** | §2.13, §5 integration row "Slack — post" |

⚠️ **Listed here for findability, but it is NOT invented data — it is the
opposite.** No number, row or figure on that page is mocked.

The mockup ends the risk panel with a claim: *"Overdue items are auto-flagged to
Slack — 'deadline approaching, write an update.'"* **That automation does not
exist.** Slack is ingest-only: there is no posting path, no `chat.postMessage`
call anywhere in the codebase, and no alert-rule engine to decide when one should
fire.

Rendering the mockup's sentence verbatim would be the most damaging option on the
page — a reader would stop chasing an overdue item believing Slack had already
nudged its owner. So the claim is **inverted into a status note**: "Slack nudges
pending — posting integration not yet built. Overdue items are not auto-flagged to
anyone yet."

**GitHub gets no such note, deliberately.** The mockup names it only in the
subtitle, and the subtitle keeps the mention. Nothing on the page renders a
delivery signal, so there is no invented surface to caption — inventing a commit
column to match a phrase would be the failure this file exists to prevent. The
integration is tracked in `docs/backend-audit.md` §5.

---

## Briefs & quota — nudge and ad testing

| | |
| --- | --- |
| **Surface** | `/dashboard/briefs` → quota hero's nudge line, and the "In ad testing" card |
| **Generators** | `sampleNudge()` / `sampleAdTesting()` in `src/features/briefs/api/service.ts` |
| **Markers** | `TODO(backend): calendar-aware nudge` · `TODO(backend): ad-testing pipeline` |
| **DTO flags** | `MyQuota.nudgeIsSample` · `AdTesting.isSample` |
| **Audit ref** | §2.12 |

**The nudge** is calendar-aware in the mockup ("2 to go before Friday — writing
blocks Mon & Wed on your calendar"). Calendar has no client, no credentials and no
table. The *remaining count* inside it is real (target minus submitted); the
scheduling advice is not, so the whole line is prefixed "Sample nudge —".

⚠️ **The nudge is omitted entirely when no quota is configured** — which is the
case today. A nudge toward a target nobody set is noise, and inventing urgency is
worse than saying nothing.

**Ad testing** is wholly invented. `BRIEF_STATES` is
`in_progress | in_review | sent_back | approved` — there is no `in_testing`, no
`winner`, no table and no source emitting one. Fixed values rather than derived
ones, precisely because there is no real signal to derive from.

**Real on that page:** the submitted count, the ISO week, the average turnaround
(created → submitted pairs over 30 days, production-filtered), the brief backlog
and the 6-week chart.

---

## Quota semantics — counting SUBMISSIONS, not approvals *(changed 2026-08-06)*

⚠️ **Not a mock — a substitution, and it changed a number that was already on
screen.**

Decision 6 (2026-08-06) says the weekly quota counts **APPROVED** briefs. The live
Vision catalogue emits **no `brief.approved` event at all** — only `created`,
`updated`, `submitted`, `sent_back`, `commented` and `script_saved`. Escalated to
the platform owner; pending.

`getBriefQuota()` previously counted **`brief.created`**, which audit **D9** flagged
as measuring the wrong thing (briefs *started*, not delivered). It now counts
**`brief.submitted`** — the closest measurable proxy to the decision.

**What moved as a result:**

| Surface | Before | After |
| --- | --- | --- |
| People page → quota column (`BriefQuotaBar`) | briefs *created* this week | briefs *submitted* this week — **a different measure, not simply smaller** |
| Briefs & quota → hero card | *(new)* | briefs submitted this week |
| 6-week charts (department + briefs) | *(new)* | submissions, captioned |

⚠️ **Measured on live data for the current week:** created = Usama 6 / Ardin 5;
submitted = Usama 10 / Ardin 0. Submissions can EXCEED creations because a brief
submitted this week may have been started in an earlier one — so anyone comparing
the People column against last week's screenshot should expect movement in either
direction.

`QuotaRow.created` was **renamed to `submitted`** rather than left in place with
new contents — a field whose name says "created" holding submissions is how the
next reader draws a wrong conclusion from a correct number.

⚠️ **The Control Tower is NOT affected.** Its brief-pipeline widget reads
`foldBriefs()` directly, not `getBriefQuota()` — checked, not assumed.

⚠️ `brief.updated` is still never counted: it fires 278 times across 19 briefs, so
counting it would measure editing volume and present it as output.

---

## Department detail — three data gaps, none of them a mock

⚠️ **This entry documents MISSING FIELDS AND A SUBSTITUTION, not invented data.**
Every number on `/dashboard/departments/[id]` is a real count. It is listed here
because a reader of the page will see em dashes and a caption and should be able to
find out why.

| Gap | Surface | Behaviour | Audit ref |
| --- | --- | --- | --- |
| **Brief `product`** | Brief backlog, PRODUCT column | Always `—` | §3.1 |
| **Approval-week series** | 6-week chart | Counts *submissions*, captioned | Decision 6 (2026-08-06) |
| **Quota exception annotation** | 6-week chart | Omitted entirely | D8 |

**1. Vision carries no product field on a brief.** The mockup's backlog has a
PRODUCT column; `FoldedBrief` has `id`, `label`, `state`, timestamps and actor —
no product. The column renders `—` rather than inventing a value or silently
dropping the column.

**2. The chart counts submissions, not approvals.** Decision 6 says the quota
counts APPROVED briefs. ⚠️ **The live Vision catalogue contains no
`brief.approved` events at all** — only `created`, `updated`, `submitted`,
`sent_back`, `commented` and `script_saved`. An approvals series would be six empty
bars, which reads as a broken chart rather than as a data gap. The brief's
documented fallback is taken: briefs currently in `in_review`, bucketed by
`stateEnteredAt`. Surfaced two ways — the card title says "Briefs submitted vs
quota" and a caption states why. `BriefPerformance.usesSubmittedFallback` carries
it; flip to approvals and drop the flag the day Vision emits the event.

> ⚠️ Bucketing from the fold reflects each brief's CURRENT state, so a brief
> submitted in W31 and sent back in W32 counts in neither. That under-counts rather
> than inventing, and a true series needs transition replay rather than a fold.

**3. No quota is configured, so the bars are neutral.** Every `role_profile.
quota_config` is `{}`. An unconfigured quota is not a zero quota, so bars render
neutral rather than all-below-target — colouring them against a threshold nobody
set would be a fabricated judgement. Same rule `getBriefQuota` already applies.

**4. The mockup's exception annotation ("W31 dip = product launch freeze") is
omitted.** There is no exception field and no place to store one (audit D8).

**Also worth knowing:** the brief panel is **not department-filtered**, and cannot
honestly be. A Vision brief has no department — attribution runs brief → actor
identity → person, and Vision attribution is partial. Filtering by the actor's
department would silently drop every brief whose actor is unlinked, which is most
of them, and present a short list as a complete one.

**The department summary sentence is deterministic**, built from live counts with
no model call — it is not an AI summary and carries no sample flag. Extending
`ai_summary` to a polymorphic subject is backend work (audit §1.3).

---

## My team — Agent performance FIGURES (hybrid)

| | |
| --- | --- |
| **Surface** | `/dashboard/my-team` → "Agent performance" card |
| **Generator** | `buildAgentPerformance()` in `src/lib/agent-performance.ts` (shared) |
| **Marker** | `TODO(backend): zendesk (audit §3.3)` |
| **DTO flag** | `MyTeam.agents.figuresAreSample` |
| **Renderer** | `@/components/agent-performance-table` (shared by My team and the CX department panel) |
| **Audit ref** | §3.3 AgentPerformance, §2.4 CX panel, §2.11, §5 integration row "Zendesk" |

⚠️ **Hybrid — read the split.**

**Real:** the AGENT column. Actual `person` rows in the actor's department, with
their `role.display_name`.

**Invented:** TICKETS, RESOLVED, CSAT and CADENCE. Zendesk has **no code at all** —
no client, no credentials, no table — though it is confirmed in scope (frontend
contract §4.1). `AgentPerformance` appears on three screens in the contract, so
this is the shape those will share.

The figures are derived from each person's real open-item count so they are stable
per agent across reloads rather than reshuffling — a figure that changes on refresh
reads as live telemetry. `cadence` in particular follows the one real signal
available (open-item load), which keeps the mocked column at least directionally
honest. It is still invented; the caption is what makes that legible.

⚠️ **`cadence` here means ADHERENCE, not a schedule** — a named enum trap from the
audit. `recurring_task.cadence` is a repetition interval
(`daily | weekly | biweekly | monthly | quarterly`); this screen's column is
whether an agent is keeping up. The type is `AgentCadence` and deliberately does
**not** reuse `Cadence` from `@/db/schema/recurring-task` — importing that one
would typecheck and mean the wrong thing.

⚠️ **Agents = all department members**, not only those with `role.code = 'cx_agent'`.
A manager viewing a department where nobody carries that role would otherwise get
an empty table, which reads as a broken integration rather than "no agents here".

**Everything else on that page is real** — the health badge (shared with the
sidebar's dot), all four stat cards, the team action items, the at-risk panel and
the member list.

---

## Capture queue — auto-completion ledger EVIDENCE and WHEN (hybrid)

| | |
| --- | --- |
| **Surface** | `/dashboard/extraction` → "Auto-completion ledger" card |
| **Generator** | `buildLedger()` in `src/features/extraction/api/service.ts` |
| **Marker** | `TODO(backend): completion engine (audit D5)` |
| **DTO flag** | `CaptureQueue.ledger.detailIsSample` |
| **Renderer** | `Ledger` in `src/features/extraction/components/capture-queue-view.tsx` |
| **Audit ref** | D5, §1.2 `completionType`/`evidence`, §2.6 ledger |

⚠️ **Hybrid — read the split.**

**Real:** the TASK and OWNER columns. Queried from `recurring_task` joined to
`person`, so the ledger names the same five tasks the Automations table and My day
show, with their actual owners. The watched signal quoted inside the evidence
string is also real (`auto_complete_rule.source` + `.event`).

**Invented:** the EVIDENCE claim (that the signal fired) and the WHEN. The
completion engine does not exist — `completion_event` has **0 rows and no
writer**, and nothing evaluates `auto_complete_rule`.

The caption says exactly this rather than a blanket "Sample data", because
labelling the whole card fake would be its own inaccuracy.

> ⚠️ **NEVER seed `completion_event` to fix this.** A seeded row makes a
> fabricated completion indistinguishable from a measured one at the database
> level. The seed spec's hard rules forbid it.

**Everything else on that page is real** — the provenance cards, the review queue,
and the "Added to tracker" list. See the note at the foot of this file.

---

## My day — "Today" timeline

| | |
| --- | --- |
| **Surface** | `/dashboard/my-day` → "Today" card |
| **Generator** | `sampleToday()` in `src/features/my-day/api/service.ts` |
| **Marker** | `TODO(backend): calendar` |
| **DTO flag** | `MyDay.today.isSample` |
| **Renderer** | `TodayCard` in `src/features/my-day/components/my-day-body.tsx` |
| **Audit ref** | §2.5, and §5 integration row "Calendar (Google?)" |

Same root cause as the person profile's Calendar tab: no provider client, no
credentials, no `calendar_event` table. Three fixed blocks with fixed times, so
the card is stable across reloads rather than reshuffling — a timeline that
changes on refresh reads as live data.

---

## My day — recurring task STATE and EVIDENCE (hybrid)

| | |
| --- | --- |
| **Surface** | `/dashboard/my-day` → "Recurring tasks" card |
| **Generator** | `sampleRecurringState()` in `src/features/my-day/api/service.ts` |
| **Marker** | `TODO(backend): completion engine (audit D5)` |
| **DTO flag** | `MyDay.recurring.stateIsSample` |
| **Renderer** | `RecurringCard` / `RecurringRow` in `my-day-body.tsx` |
| **Audit ref** | D5, §1.2 `completionType`/`evidence`, §2.10, §2.14 |

⚠️ **THE ONLY HYBRID ENTRY IN THIS FILE — read the split carefully.**

**Real:** the task rows themselves (`recurring_task` filtered by
`owner_person_id = me`), their `cadence`, their `fallback_manual`, and the
watched signal built from `auto_complete_rule.source` + `.event`. The seed
aligned these rows to the mockup's Automations table, so the five tasks and their
cadences are genuine.

**Invented:** each row's completion `state` and its `evidence` line. The
completion engine does not exist — `completion_event` has **0 rows and no
writer**, and nothing evaluates `auto_complete_rule`.

The card's caption says exactly this ("state and evidence are illustrative — the
tasks and cadences are real") rather than a blanket "Sample data", because
labelling the whole card as fake would be its own inaccuracy.

⚠️ **The task NAME is a display mapping, not invented data.** `recurring_task`
has no name column and the seed spec forbids adding one, so
`RECURRING_LABEL` maps the real `auto_complete_rule.event` to the mockup's
wording. The underlying value is real; only the phrasing is ours. An unmapped
event falls back to a humanised form of itself rather than a blank row.

> ⚠️ **NEVER seed `completion_event` to fix this.** A seeded row makes a
> fabricated state indistinguishable from a measured one at the database level.

---

## My day — latest meeting card

| | |
| --- | --- |
| **Surface** | `/dashboard/my-day` → "Latest meeting" card |
| **Generator** | `sampleLatestMeeting()` in `src/features/my-day/api/service.ts` |
| **Marker** | `TODO(backend): fireflies attribution` |
| **DTO flag** | `MyDay.latestMeeting.isSample` |
| **Renderer** | `@/components/meeting-card` (shared with the person profile) |
| **Audit ref** | D4, §2.10, §3.6 |

Same root cause as the person profile's Meetings tab: the transcripts are real and
stored, but Fireflies webhooks carry a `meeting_id` and no actor, so attribution is
0% and "my meetings" has no honest join.

⚠️ The card renders "**ACTION ITEMS → TRACKER**", not the mockup's "→ ClickUp" —
the 2026-08-04 amendment made the Command Centre the task system of record.

---

## Control Tower — "Auto-completed from activity" row

| | |
| --- | --- |
| **Surface** | `/dashboard/overview` → "This week's capture" card, one row |
| **Generator** | `sampleAutoCompleted()` in `src/features/home/api/service.ts` |
| **Marker** | `TODO(backend): completion engine` |
| **DTO flag** | `HomeSnapshot.weekly.autoCompletedIsSample` |
| **Renderer** | `WeeklyCaptureCard` in `src/features/home/components/home-view.tsx` |
| **Audit ref** | D5 (completion engine design), §1.2 `completionType`/`evidence`, §2.14 |

**Why it is mocked:** the completion engine does not exist. `completion_event` has
**0 rows and no writer**, and nothing evaluates
`recurring_task.auto_complete_rule`. The PRD's core "evidenced, not
self-declared" concept is unbuilt.

**Shape of the invention:** derived as half the week's real captured count, so it
moves with the data rather than sitting frozen while everything around it changes
— a static number beside live ones is the version most likely to be believed. It
is still invented; the `preview` caption beside the row label is what makes that
legible.

> ⚠️ **NEVER fix this by seeding `completion_event`.** A seeded row makes a
> fabricated number indistinguishable from a measured one *at the database level*,
> which is strictly worse than a labelled placeholder. The seed spec's hard rules
> forbid it for the same reason.

**To make it real:** build the engine (decision D5 — design it together with
Founder offload's "verifiably handed off" evidence model), then count
`completion_event` rows for the week and set `autoCompletedIsSample: false`.

---

## Control Tower — Founder copilot exchange

| | |
| --- | --- |
| **Surface** | `/dashboard/overview` → "Founder copilot" card |
| **Generator** | `FounderCopilot()` in `src/features/home/components/home-view.tsx` — hardcoded JSX |
| **Marker** | Card carries a `Preview` caption |
| **Audit ref** | §2.3 (the panel), §2.9 (the retrieval it depends on) |

**Why it is mocked:** there is no copilot backend — no retrieval layer, no index,
no embeddings, no `POST /copilot/ask`. Notion, one of the four corpus sources, has
no client at all.

**Shape of the invention:** one question-and-answer pair as demo copy, styled to
the mockup. ⚠️ **This one is hardcoded in the component rather than behind the
service seam** — a deliberate exception to the pattern used elsewhere in this
file, because there is no query shape to stand in for yet. Putting invented prose
into `getHomeSnapshot()` would imply the rollup can answer questions.

⚠️ **There is deliberately NO INPUT FIELD on the card.** A text box would invite a
real question and answer it with a canned reply about a company that does not
exist — the most misleading thing this page could do. The working affordance is
the top bar's copilot field, which navigates to AI search.

⚠️ **Sources read "Portal", not "Shopify".** The mockup cites Shopify; per audit
§3.7 there is no Shopify client and none is to be built — internal backend
endpoints replace it.

**To make it real:** build the retrieval layer (§2.9), including role-filtered
retrieval, which is a hard requirement and an index-partitioning decision that
must be made *before* anything is indexed.

---

## Person profile — Calendar tab

| | |
| --- | --- |
| **Surface** | `/dashboard/people/[personId]/profile` → Calendar tab |
| **Generator** | `sampleCalendar()` in `src/features/person-profile/api/service.ts` |
| **Marker** | `TODO(backend): calendar integration` |
| **DTO flag** | `PersonProfile.calendar.isSample` |
| **Renderer** | `src/features/person-profile/components/calendar-tab.tsx` |
| **Audit ref** | §2.5, and §5 integration row "Calendar (Google?)" |

**Why it is mocked:** there is no calendar integration. No provider client, no
credentials, no `calendar_event` table. Confirmed in scope by the frontend
contract's §4.1 resolved decisions, but zero code exists.

**Shape of the invention:** a Mon–Fri week anchored to the Monday of the current
UTC week, with a fixed per-weekday pattern of generic blocks (`Team standup`,
`Focus block`, `Review session`, `Planning`, `Weekly wrap-up`). Times are fixed
strings; the dates move with the clock so the grid is always "this week".

**To make it real:** replace the function body with a provider query and set
`isSample: false`. Nothing else on the page changes — the renderer never
formats a date and never hardcodes the flag.

⚠️ **Do not skip the dummy-account rule.** CLAUDE.md requires a new third-party
integration to be built against a dedicated test account first. A calendar is a
read-only integration, which lowers the risk, but the account question should be
raised before credentials are requested rather than at eval time.

---

## Person profile — Meetings tab

| | |
| --- | --- |
| **Surface** | `/dashboard/people/[personId]/profile` → Meetings tab |
| **Generator** | `sampleMeetings()` in `src/features/person-profile/api/service.ts` |
| **Marker** | `TODO(backend): fireflies attribution` |
| **DTO flag** | `PersonProfile.meetings.isSample` |
| **Renderer** | `src/features/person-profile/components/meetings-tab.tsx` |
| **Audit ref** | D4 (email-less identity attribution), §2.5, §3.6 |

**Why it is mocked — and this one is subtler than the calendar.** The transcripts
are **real and already stored**: six of them, 13–1060 sentences each. What cannot
be answered is *"which meetings touched this person"*. Fireflies webhooks carry a
`meeting_id` and no actor, so Fireflies attribution sits at **0% of 10 events**.
The transcript payload's `speakers[]` is `{id, name}` with **no email**, nothing
links a speaker to a `participants[]` entry, and name matching is never an
auto-match at any confidence level — a wrong auto-link silently attributes one
person's work to another. So there is no honest join from a transcript to a
person yet.

**Shape of the invention:** two meetings dated 2 and 6 days before now, with the
profile's own subject as an attendee alongside role words (`Ops lead`,
`Support manager`) rather than invented colleague names. Summaries state in their
own text that they are samples.

**To make it real:** resolve Fireflies speakers to people (decision D4), then
query `transcript` joined through this person's Fireflies `unified_event`s and set
`isSample: false`.

⚠️ **The label says "Action items → Tracker", not "→ ClickUp".** The mockup says
ClickUp. Per the 2026-08-04 amendment the Command Centre is the task system of
record and no external task tool is written to, so rendering the mockup's label
would advertise a sync that does not exist and must never be built. This is a
deliberate divergence from the mockup, not an oversight.

---

## Not mocked — worth stating explicitly

Everything else on the person profile is **real data from real queries**: the
name, role profile, access role, department, Slack handle, open/overdue/done
counts, the 30-day event totals with their per-source breakdown, every task row,
and the AI summary (with its two-gate cache and double labelling intact).

⚠️ **A real zero is not a mocked zero.** The "Events (30d)" card reads 0 for
anyone whose activity arrives only through UGC or Fireflies, because both are at
0% attribution — that is a gap in *our linking*, not in their work, which is why
the card's sub-line names the contributing sources rather than showing a bare
count.
