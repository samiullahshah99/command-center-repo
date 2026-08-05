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
