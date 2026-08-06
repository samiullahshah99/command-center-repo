# Completion engine — design

**Status: DESIGN ONLY. No code has been written.** This document takes positions so
the build session argues with a proposal rather than a blank page. Decisions that
need the team lead's sign-off are listed in §7.

Resolves audit **D5** ("what evaluates a rule, what is the evidence model, when
does `fallback_manual` apply") and the half of **§2.8** that says Founder offload's
"verifiably handed off" must share one evidence concept with the completion ledger.

Unblocks four sample surfaces (§6) and the PRD's core claim: **evidenced, never
self-declared.**

---

## 0. ⚠️ Read this first — the five seeded rules cannot match anything

Measured against the live database, not inferred:

| Owner | Cadence | `auto_complete_rule` | `fallback_manual` |
| --- | --- | --- | --- |
| Ardin | weekly | `{source: 'slack', event: 'ops_review_posted', within: '7d'}` | false |
| Diane | daily | `{source: 'portal', event: 'awaiting_review_acknowledged', within: '24h'}` | **true** |
| Hashim | weekly | `{source: 'brief_tracker', event: 'briefs_submitted', within: '7d'}` | false |
| Ronalyn | weekly | `{source: 'fireflies', event: 'recap_delivered', within: '7d'}` | **true** |
| Usama | daily | `{source: 'slack', event: 'standup_message', within: '24h'}` | false |

**Not one of these five names a `(source, event_type)` pair that exists in
`unified_event`.** Checked against all 604 rows:

- `unified_event.source` is Zod-constrained to `RAW_EVENT_SOURCES` =
  `slack | clickup | fireflies | ugc | vision`. **`portal` and `brief_tracker`
  can never appear**, so Diane's and Hashim's rules are structurally unmatchable —
  not "no data yet", but "no row of this shape can ever exist". (`portal` is in
  `IDENTITY_SOURCES` only; it issues identities and delivers no webhooks.)
- Slack emits exactly one `event_type`: `message`. There is no `ops_review_posted`
  and no `standup_message`.
- Fireflies emits `meeting.transcribed`. There is no `recap_delivered`.

**The consequence for this design.** The seeded rules describe *intent in English*
("a standup message in Slack"), not *matching criteria*. A typed rule shape that
merely tightens `{source, event, within}` into a stricter version of itself would
produce five rules that compile, validate, and match nothing — a green engine with
a permanently empty ledger, which reads as "nobody did their work" rather than
"nothing is wired up".

So the typed shape in §3 must express **a predicate over the events we actually
have** (`source` + `event_type` + a subject/metadata filter + an actor rule), and
migrating the five rules is a data task with a human in the loop, not a cast.

> ⚠️ **This is also why `fallback_manual` cannot be an afterthought.** Two of the
> five tasks already carry it. On the day the engine ships, the honest state for
> most of these tasks is "no rule that can fire" — see §5.

---

## 1. Evaluation model — cron vs per-event reaction

### Recommendation: **react per `unified_event`, plus a nightly sweep for the negative case.**

Not a hedge — the two answer different questions, and only one of them can be
answered by reacting to an event at all:

| Question | Answerable by | Why |
| --- | --- | --- |
| "Did this task get done?" | **reaction** | A completion is caused by an event arriving. |
| "Did this task **not** get done by the window's end?" | **cron** | Nothing arrives. There is no event to react to. |

An engine built only on reactions can never mark a window missed, because the
absence of a signal emits nothing. An engine built only on cron re-scans the whole
event table on a schedule to discover things it was already told about in real
time.

### Why reaction fits the infrastructure we actually have

Measured against `src/lib/queue/`, not against a generic pg-boss description:

1. **The registry seam already exists and is the documented extension point.**
   `src/lib/queue/registry.ts` is "the ONLY place that maps a source to its parse
   handler", explicitly built so workers can move to a separate Railway service
   later without touching handlers. A completion evaluator is one more entry.

2. **The enqueue-in-the-same-transaction pattern is already load-bearing.**
   `ingest.ts` uses pg-boss's `fromDrizzle(tx, sql)` so a job can never reference a
   row that was rolled back. The normaliser can enqueue `completion.evaluate`
   inside the same transaction that writes the `unified_event` — the completion job
   then cannot observe an event that does not exist.

   > ⚠️ **Gate the enqueue on the INSERT actually happening**, exactly as ingest
   > gates on `inserted`. `unified_event` upserts on `(raw_event_id, source_seq)`,
   > so `pnpm renormalise` re-runs the whole table. An ungated enqueue would fire a
   > completion job for all 604 events on every re-normalise.

3. **`batchSize=2` + `perJobResults: true` + a per-job try/catch is the house
   pattern**, and completion needs it more than parsing does. A batch of two events
   can belong to two different people's tasks; without `perJobResults` one
   malformed rule drags an unrelated person's completion through the whole retry
   ladder and into the dead-letter queue. Two existing tests
   (`batch-isolation.test.ts`, `extraction-batch-isolation.test.ts`) pin this
   behaviour — the completion evaluator gets a third.

4. **A `completion.*` queue name, not `parse.*`.** Same reasoning the extraction
   queue is `extract.action-items`: it runs *after* normalisation and belongs to no
   connector. Dots, not colons — pg-boss v12 rejects `:`.

### What a cron-only design would cost us

- **Latency becomes a config value.** My day's recurring panel would show `pending`
  for up to a full poll interval after the signal arrived. The screen's entire
  claim is that it reads activity rather than asking for check-offs; a task that
  stays "not done" for 15 minutes after you did it teaches people to distrust it.
- **Re-scanning is the expensive half.** Reaction touches one event and the rules
  whose `(source, event_type)` matches it. Cron re-queries a growing table on every
  tick to re-derive what it was already told.
- **It duplicates a delivery guarantee we already own.** pg-boss gives us
  at-least-once delivery with a retry ladder and dead-lettering. A cron loop
  re-implements "did I already handle this?" in application code, and the answer
  has to be the same unique index the reaction path needs anyway (§3.4).

### What the nightly sweep is for — and what it must NOT do

One scheduled job, `completion.sweep`, running after the UTC day boundary:

- Close windows that ended with no completion: this is what makes
  `state = 'missed'` (or `manual_required`, per §5) real rather than inferred by
  every consumer separately.
- **Nothing else.** In particular it must not "catch up" completions by re-scanning
  events — if the reaction path missed one, that is a bug to fix, not a hole to
  paper over nightly. A sweep that silently repairs the reactor is a sweep that
  hides the reactor being broken.

> ⚠️ **Workers boot in-process from `src/instrumentation.ts`, `nodejs` runtime
> only, once per process.** With more than one container the sweep would run once
> per container. Either pin the schedule to a single instance or make the sweep
> idempotent under the §3.4 unique index — the index makes it safe, so prefer
> leaning on it over deployment topology.

---

## 2. The evidence model — one shape, two surfaces

Designed once. §2.8's warning is explicit: separately designed, the ledger and
Founder offload produce two incompatible notions of proof.

### 2.1 The shape

```
{ signal, evidence_source, evidence_ref, completed_at }
```

| Field | Meaning | Notes |
| --- | --- | --- |
| `signal` | WHICH rule/criterion was satisfied | New. Names the matched predicate, not the prose. |
| `evidence_source` | WHERE the proof lives | `slack \| clickup \| vision \| ugc \| fireflies \| portal \| manual` |
| `evidence_ref` | POINTER to the proof | ⚠️ An id, never prose — see 2.3 |
| `completed_at` | WHEN it happened | The event's `occurred_at`, **not** `now()` — see 2.4 |

`completion_event` already has three of the four (`completed_at`,
`evidence_source`, `evidence_ref`), and its header already says append-only. The
table needs `signal`, a window key, and a subject pointer that is not
`recurring_task_id` (§2.5).

### 2.2 `evidence_source` — extend the existing constant, do not invent a second

`EVIDENCE_SOURCES` today is `['portal', 'slack', 'clickup', 'manual']`. It is
missing `vision`, `ugc` and `fireflies`, which are three of our five real event
sources. **Extend this one constant** rather than adding a per-surface list; it is
TEXT + Zod, so widening costs a Zod change and no migration.

> ⚠️ `evidence_source` is deliberately NOT `RAW_EVENT_SOURCES`. It is a superset:
> it must also express `manual` (a human) and `portal` (our own records), neither
> of which is a webhook source. Reusing `RAW_EVENT_SOURCES` here would make a
> manual check-off unrepresentable — which is exactly how "evidenced" silently
> becomes "self-declared with no marker".

### 2.3 ⚠️ `evidence_ref` is an ID. Never model prose, never a quoted span

The temperature-0 finding in CLAUDE.md is that model wording is not stable across
runs — descriptions are reworded every time, and even `source_span` widens and
narrows. That already broke `content_hash`, which exact-matches a span the model
does not reproduce.

**A completion must never key on anything a model wrote.** `evidence_ref` holds:

- `unified_event.id` for a signal completion (a uuid we assigned, stable forever)
- `person.id` for a manual check-off (§5)
- never a description, a summary, a quote, or an LLM-generated label

If a human-readable line is wanted on the ledger, it is **rendered at read time**
from the referenced row, so it can never drift from what it points at.

### 2.4 `completed_at` is the EVENT's time, not the worker's

`completed_at = unified_event.occurred_at`.

> ⚠️ The signal can arrive late — a webhook retry, a queue backlog, a
> `pnpm renormalise` run replaying a fixed parser. Stamping `now()` would credit
> Monday's standup to Wednesday, and the day it happens is the day a backlog
> clears, which is exactly when nobody is looking. Using the event's own time also
> makes the window assignment in §3.3 deterministic and replayable.

### 2.5 The polymorphic-subject problem, and the position I take

`completion_event.recurring_task_id` is `NOT NULL` and cascades. Founder offload
needs the same four fields against a different subject.

**Position: keep `completion_event` recurring-only. Give offload its own table
with the same four evidence columns, and share the SHAPE through a Zod schema and
a writer helper — not through one polymorphic table.**

| Option | Verdict |
| --- | --- |
| Nullable `recurring_task_id` + `offload_item_id` + CHECK exactly-one | Rejected — every query grows a `WHERE … IS NOT NULL`, and the cascade semantics differ per subject |
| Generic `subject_type` + `subject_id` (no FK) | Rejected — loses referential integrity, which is the one thing Postgres was doing for us here |
| **Two tables, one shared evidence shape** | **Chosen** |

> **Why the shared thing is a schema and a helper, not a table.** The audit's
> requirement is that the two surfaces cannot end up with two incompatible notions
> of proof. That is satisfied by one Zod schema (`evidenceSchema`), one writer
> (`recordEvidence()`), one `EVIDENCE_SOURCES` constant and one rule about
> `evidence_ref` — all of which are enforceable in code review and in tests. A
> shared table would additionally give up `NOT NULL` FKs and cascade correctness,
> and buy nothing the shared schema does not already buy.
>
> This mirrors `EXTERNAL_SYSTEMS`: one constant across three columns that mean
> three different things, and CLAUDE.md is emphatic that sharing the vocabulary is
> right while conflating the meanings is not.

### 2.6 Minimal `founder_offload_item` sketch

```
founder_offload_item
  id                uuid pk
  task              text not null
  note              text
  proposed_owner_person_id  uuid null → person(id) on delete set null
  hours_per_week    integer
  status            text not null  CHECK IN ('proposed','assigned','in_transition','handed_off')
  -- the SAME four evidence fields, populated only at hand-off:
  signal            text
  evidence_source   text            CHECK IN (EVIDENCE_SOURCES)
  evidence_ref      text
  completed_at      timestamptz     -- "verifiably handed off at"
  created_at / updated_at
```

Plus `founder_offload_evidence` if hand-off needs a *history* rather than a final
answer — recommended, and append-only for the same reason as `completion_event`.

⚠️ **`proposed_owner_person_id` is nullable on purpose.** The workflow's first
stage is "Damian surfaces a task" before anyone is named; the current preview
screen already renders that state.

⚠️ **CHECK constraint: `status = 'handed_off'` requires all four evidence fields
non-null.** That makes "verifiably handed off" structural rather than a
convention — the same move as `tracked_item_external_ref_ck`. Without it,
"verifiably" is a word in a mockup.

### 2.7 ⚠️ The `source_type` enum question — take the third door

§2.8 flags that `source_type` is a **pgEnum** (`meeting | slack | manual | system`)
with no `founder_offload` value, and `ALTER TYPE … ADD VALUE` cannot run inside a
transaction and can never be removed.

**Position: do not touch the enum. Offload gets its own table (§2.6), so the
question does not arise.**

| Option | Assessment |
| --- | --- |
| `ALTER TYPE … ADD VALUE 'founder_offload'` | Irreversible, non-transactional, and **solves a problem we do not have** — it only matters if offload items are `tracked_item` rows, which §2.8 does not require |
| Convert `source_type` → TEXT + CHECK, as `tracked_item.source_system`/`.status` already were | The right fix *eventually*, and the precedent is ours. But it is a migration on a populated column done for a feature that needs no `tracked_item` row |
| **Own table, enum untouched** | **Chosen** — offload has its own lifecycle, its own statuses, and no need to appear on the tracker board |

> **Why not convert now while we are here.** `tracked_item`'s two conversions were
> done **while the table was empty**. `source_type` is on a populated
> `tracked_item`, so converting is a real data migration with a real rollback
> story, and it should be scheduled deliberately — not bundled into a feature that
> can proceed without it. **If offload items must later appear on the tracker
> board, do the TEXT + CHECK conversion then**, and do it as its own change.

---

## 3. A typed `auto_complete_rule`

Replaces `z.object({source, event, within}).optional()` — described in its own file
as "loose on purpose while the rule shape is still being designed".

### 3.1 The shape

```ts
type AutoCompleteRule = {
  version: 1;

  /** Stable id for the ledger's `signal` column. Never regenerate for an existing rule. */
  signal: string;                       // e.g. 'standup_posted'

  match: {
    source: RawEventSource;             // slack | clickup | fireflies | ugc | vision
    eventType: string;                  // MUST be a real unified_event.event_type
    /** Optional narrowing. Absent = any. */
    subject?: { idIn?: string[]; labelMatches?: string };
    /** Equality only, against unified_event.metadata. No expressions. */
    metadata?: Record<string, string | number | boolean>;
  };

  /** ⚠️ See 3.5 — this is the attribution trap. */
  actor: 'must_be_owner' | 'any';

  window: { cadence: Cadence };         // from the task; restated for self-containment
  minCount?: number;                    // default 1
};
```

**No `within`.** Today's `'24h'` / `'7d'` duplicates `cadence` and invites
disagreement (a `weekly` task with `within: '24h'`). The window comes from the
cadence — one source of truth.

**No expression language.** `metadata` is equality-only. A rule DSL is a parser, an
evaluator, a security surface and a debugging problem; the five real cases need
none of it.

### 3.2 The five seeded rules as concrete cases

What each becomes — and the honest verdict for each:

| Owner | Intent | Typed rule | Fires today? |
| --- | --- | --- | --- |
| Usama | daily standup in Slack | `source: 'slack', eventType: 'message', metadata: {channel: '<standup-id>'}, actor: 'must_be_owner'` | ✅ **Yes** — Slack is 90.9% attributed and emits `message`. Needs the channel id filled in |
| Ardin | weekly ops review posted | `source: 'slack', eventType: 'message', metadata: {channel: '<ops-id>'}, actor: 'must_be_owner'` | ✅ Yes, same shape |
| Hashim | weekly briefs submitted | `source: 'vision', eventType: 'brief.submitted', actor: 'must_be_owner'` | ⚠️ **Partly** — 17 events exist, 6 unattributed. `brief_tracker` was never a source; Vision is the real one |
| Ronalyn | weekly recap delivered | `source: 'fireflies', eventType: 'meeting.transcribed', actor: 'must_be_owner'` | ❌ **No** — Fireflies is **0% attributed** (D4). With `must_be_owner` it can never fire. Keep `fallback_manual: true` |
| Diane | daily returns acknowledged | *no rule expressible* | ❌ **No** — `portal` emits no events. This is a **manual-only task** until an internal endpoint exists. Keep `fallback_manual: true` |

> **This table is the real output of the design.** Three of five need a human to
> supply a channel id or confirm a source; one is blocked on attribution; one has
> no signal at all. Shipping the engine does not make five rules work — it makes
> two work, and makes the other three *visibly* manual instead of invisibly broken.

### 3.3 Window logic — the 23:59 / 00:01 question

**Reuse the UTC-day convention from `src/lib/dept-health.ts`** — `startOfUtcDay()`
is `Date.UTC(y, m, d)`, and the "due today is not overdue" rule already depends on
it.

- A completion is credited to the **UTC day of its `completed_at`** (= the event's
  `occurred_at`, §2.4).
- **23:59:59Z credits that day. 00:00:01Z credits the next.** No grace period.

Window keys (`window_start`, a `date`):

| Cadence | Window |
| --- | --- |
| `daily` | that UTC day |
| `weekly` | ISO week, **Monday** 00:00Z |
| `biweekly` | ISO week pairs anchored on the task's `created_at` week |
| `monthly` | first of the UTC month |
| `quarterly` | first of the UTC quarter |

> ⚠️ **The team is in PKT (UTC+5).** A 03:00 PKT standup is 22:00Z **the previous
> day** — so under this rule it credits *yesterday*, and a person doing their
> standup every morning would look like they are always one day late. This is a
> real trade, and I have taken UTC because every other date boundary in the
> codebase is UTC and a second convention is worse than a wrong one. **§7 flags
> it: if the team wants local-day semantics, that is a deliberate decision and the
> constant belongs beside `OVERDUE_BAD_DAYS`**, not inlined here.

### 3.4 Matching twice in one window — idempotency

**One `completion_event` per `(recurring_task_id, window_start)`.** Enforced by
Postgres, not by application logic:

```sql
CREATE UNIQUE INDEX completion_event_task_window_key
  ON completion_event (recurring_task_id, window_start);
```

Writes are `INSERT … ON CONFLICT DO NOTHING`.

> ⚠️ **`DO NOTHING`, not `DO UPDATE`.** The FIRST qualifying signal is the
> completion; a second standup message the same day is not a better proof of the
> first. `DO UPDATE` would let a later, weaker signal overwrite the evidence
> pointer of an earlier, stronger one — and the row is append-only by contract.
>
> This is also what makes the whole engine safe under at-least-once delivery,
> under `pnpm renormalise`, and under a sweep that runs on two containers. **One
> statement, not select-then-insert** — the same reasoning that makes
> `ingestRawEvent` safe against concurrent duplicate webhook deliveries.

`window_start` is a new **NOT NULL** column on `completion_event` (the table is
empty, so no backfill).

### 3.5 ⚠️ Attribution — `actor: 'must_be_owner'` silently never fires on two sources

Measured, 604 events, **222 unattributed (36.8%)**:

| Source | Attribution | Effect on a `must_be_owner` rule |
| --- | --- | --- |
| `slack` | 90.9% | Works |
| `vision` | ~43% | Fires sometimes — **under-reports silently** |
| `clickup` | 50% | Works when the actor email is inline |
| `ugc` | **0%** (94/94 `creator.rejected`, 20/20 `creator.approved`) | **Never fires** |
| `fireflies` | **0%** | **Never fires** |

A rule with `actor: 'must_be_owner'` on UGC or Fireflies is not "waiting for a
signal" — it is *structurally incapable* of completing, forever, and it looks
identical to a person not doing their work.

**Required behaviour — this is the part that must not be dropped in the build:**

1. **The rule validator rejects `actor: 'must_be_owner'` on a source whose
   attribution rate is zero.** Not a warning in a log — a validation error at
   configuration time, on the Automations screen, naming D4.
2. `actor: 'any'` on such a source completes the task for **anyone's** matching
   event. That is a real weakening and must be visible: the ledger row is marked
   `attribution: 'unattributed'` and the UI says *"completed by an unattributed
   signal"*, never a person's name.
3. **Never infer the actor from the task's owner.** If the event has
   `person_id IS NULL`, the completion is unattributed. Writing the owner's id in
   would fabricate the single fact the ledger exists to record — the same rule
   that makes name-matching never an auto-link at any confidence.

> **This is why the sweep matters.** A rule that cannot fire produces a missed
> window every period, which surfaces on the Automations screen as a rule that has
> never fired — a visible, diagnosable state instead of a silent zero.

---

## 4. The `completed_at` consumer that already exists

### 4.1 What My day does today

`src/features/my-day/api/service.ts` (~line 316):

```ts
doneThisWeek: itemRows.filter(
  (r) => r.status === 'done' && r.lastUpdateAt !== null && r.lastUpdateAt >= weekStart
).length
```

`tracked_item.last_update_at` is a proxy, documented at the field as such: it is
"when this row last changed", not "when the work finished". Re-open an item and
close it again and it counts twice; edit a done item's title and it re-enters this
week.

### 4.2 The swap

`doneThisWeek` becomes a count of completion rows in the week, for this person,
across both kinds of work. `last_update_at` stops being consulted for this number
(it remains a legitimate freshness signal elsewhere).

### 4.3 ⚠️ Should `tracked_item` completion also write completion rows? **Yes.**

Otherwise "done this week" means two different things in one number — recurring
tasks measured by evidence, tracked items measured by a row-mutation timestamp —
and no consumer could tell which half it was looking at.

**Position: a `tracked_item` transitioning to `done` writes an evidence row too**,
into a `tracked_item_completion` table with the same four fields:

- `evidence_source = 'manual'`, `evidence_ref = <person.id>` when a human closed it
- the real signal when auto-completion lands
- `completed_at` = the transition time

Consequences worth stating plainly:

- **A re-opened and re-closed item produces TWO rows.** Correct, and the
  append-only rule requires it — the item genuinely was completed twice. Consumers
  asking "is it done now?" read `tracked_item.status`; consumers asking "what
  happened this week?" read the ledger. Those are different questions and today
  they share one wrong answer.
- **`tracked_item` gains no `completed_at` column.** A column would drift from the
  ledger, and the ledger is the append-only record.

> **Cost, stated honestly:** this is a write on a hot path (every status change)
> and a third table. The alternative — leaving `doneThisWeek` on `last_update_at`
> for tracked items and evidence for recurring — is cheaper and produces a number
> that is quietly wrong in a way nobody can see. §7 flags it for sign-off.

---

## 5. `fallback_manual` semantics

Today it is a boolean nothing reads. Two of five tasks set it.

### 5.1 When does a task fall back?

Three distinct states, and conflating them is how the honest degradation gets lost:

| State | Condition | Falls back? |
| --- | --- | --- |
| `no_rule` | No rule, or a rule that cannot be expressed (Diane) | **Immediately** — never wait for a signal that has no sender |
| `awaiting_signal` | Rule exists, window open, nothing yet | No — not yet |
| `window_closed_unmet` | Window ended with no matching event | **Yes**, at the boundary, by the sweep |

**Position: `fallback_manual` is permission, not state.** It answers "may a human
close this?", not "is it closeable now?". The state above is computed; the boolean
is configuration.

⚠️ **A task with `fallback_manual: false` and no workable rule is a
misconfiguration, and the Automations screen must say so** — it can neither
auto-complete nor be closed by hand, so it is permanently red for a reason that is
nobody's fault. Two of the five (Hashim, Ardin) are in exactly that position if
their channel ids are never supplied.

### 5.2 Who may check it off?

**Position: the owner, plus `founder` / `ops_lead`.**

- Owner-only is too strict: people take leave, and an ops lead closing a window
  during someone's holiday is legitimate.
- Anyone-with-an-account is too loose: this is the record of whether a person did
  their work.
- The role check reuses `requireRole()` and `ROUTE_ACCESS` — no second
  authorisation vocabulary.

⚠️ **The acting person is always recorded, even when they are the owner.** "Diane
closed her own window" and "Ardin closed Diane's window" are different facts and
the ledger must not flatten them.

### 5.3 How a manual check-off is evidenced differently

```
signal          = 'manual_checkoff'
evidence_source = 'manual'
evidence_ref    = <person.id of whoever clicked>
completed_at    = the click time
```

This is the mechanism by which **"evidenced, never self-declared" degrades
honestly instead of silently**:

- `evidence_source = 'manual'` is queryable. "What fraction of completions were
  self-declared?" is one `WHERE`, and it is the metric that tells you whether the
  automation is actually working.
- The UI must never render a manual check-off identically to a signal completion.
  A signal row says what proved it; a manual row says **who asserted it**. Same
  ledger, visibly different rows.
- `evidence_ref` is a person id, not a note. Free text here would become the
  place people explain themselves, and the field would stop being queryable.

> ⚠️ **A manual check-off does NOT suppress a later signal.** The unique index
> means the manual row wins the window (first write). That is deliberate and worth
> knowing: closing a window by hand and then genuinely doing the work leaves the
> ledger saying "manual". The alternative — letting a signal overwrite — breaks
> append-only and lets a later row rewrite history.

---

## 6. The flip list

### 6.1 Flips to real when this ships

| Surface | Seam to swap | Becomes |
| --- | --- | --- |
| **Capture queue — auto-completion ledger** | `buildLedger(now)` in `src/features/extraction/api/service.ts:662` | Query `completion_event` joined to `recurring_task` + `person`. `LedgerRow.evidence` renders from `evidence_ref`; **drop the `⚠️ INVENTED` markers on `evidence` and `when`** and set `isSample: false` |
| **My day — recurring state + evidence** | `sampleRecurringState(index, fallbackManual)` in `src/features/my-day/api/service.ts:155` | Real state from §5.1 (`auto_completed` / `awaiting_signal` / `manual_required` / `missed`) + real evidence line |
| **Automations — FIRED count + last fired** | `sampleFired(index, cadence, hasRule, now)` in `src/features/automations/api/service.ts:125` | `count(*)` and `max(completed_at)` per task. `Automations.firedIsSample = false` |
| **Control Tower — auto-completed stat** | `sampleAutoCompleted(capturedThisWeek)` in `src/features/home/api/service.ts:83` | Count of this week's rows with `evidence_source <> 'manual'` |
| **Automations — rule STATUS** | `roleProfileStatus()` / `ruleStatus()` in the same file | Can key on whether the rule is *expressible and has fired*, not merely present |
| **My day — `doneThisWeek`** | §4.2 | Ledger count instead of the `last_update_at` proxy |

Each of the four sample generators carries a `TODO(backend): completion engine
(audit D5)` marker today; each has a `docs/gaps.md` entry to delete on flip.

### 6.2 ⚠️ What does NOT flip

Naming these matters as much as the list above — a flip announcement that implies
everything went real is worse than no announcement.

| Surface | Why it stays sample |
| --- | --- |
| **My team — agent performance** (`AgentCadence`, handle time, CSAT) | **Zendesk is not integrated.** Nothing to do with completion; the word "cadence" on that screen means *adherence*, a different concept from `recurring_task.cadence` |
| **Person profile — Calendar tab** | No calendar integration |
| **Person profile / My day — Meetings** | Fireflies attribution is 0% (D4). The transcripts are real; the join to a person is not |
| **Founder offload rows** | The model in §2.6 does not exist yet. The evidence *shape* is shared from day one; the *data* is a separate build |
| **Automations — QUOTA column** | Every `quota_config` is `{}`. Real, and really empty |
| **Recruiting, Agency reporting, AI search** | No model, no ATS, no retrieval layer |

And within the engine's own scope, three of five rules do not start working
(§3.2) — Diane's has no source, Ronalyn's is attribution-blocked, and Hashim's and
Ardin's need a human to supply a channel id.

---

## 7. Decisions to sanity-check with the team lead

Ordered by how much rework a late reversal causes.

1. **UTC day boundary vs PKT local day.** §3.3. A 03:00 PKT standup credits the
   *previous* UTC day, so a punctual person can look permanently one day late.
   Everything else in the codebase is UTC; changing later means re-deriving every
   historical window. **Highest-regret decision in this document.**

2. **Does `tracked_item` completion write evidence rows too?** §4.3. Yes gives one
   uniform "done this week" and costs a write on every status change plus a third
   table. No is cheaper and leaves the number quietly meaning two things.

3. **Offload gets its own table; `source_type` enum untouched.** §2.7. If the lead
   wants offload items on the tracker board, this inverts and we owe a TEXT +
   CHECK conversion of a populated column.

4. **Who may manually check off — owner + founder/ops_lead?** §5.2. Owner-only is
   defensible; it fails during leave.

5. **`actor: 'any'` on zero-attribution sources — allowed with an "unattributed"
   marker, or forbidden outright?** §3.5. Allowing it lets Ronalyn's rule fire on
   *anyone's* Fireflies event, which may be worse than not firing.

6. **Manual check-off wins the window permanently.** §5.3. Append-only says yes; it
   means an early manual close cannot be superseded by the real signal.

7. **Two of five tasks are misconfigured today** (`fallback_manual: false` + no
   workable rule). §5.1. Someone must supply the two Slack channel ids or accept
   that those tasks show as permanently unsatisfiable.

8. **Rule migration is a human data task, not a cast.** §0. The five seeded rules
   reference sources and event types that do not exist. Whoever owns the config
   has to rewrite them against real events before the engine means anything.
