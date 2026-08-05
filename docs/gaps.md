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
