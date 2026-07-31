# Week 1 exit test

A repeatable, end-to-end check that the ingestion pipeline works:
**event → `raw_event` → queue → `unified_event` → attributed to a person.**

Runnable by anyone with repo access and `.env.local`. Every step has an expected
result and the exact SQL to confirm it.

```bash
pnpm verify:exit          # automated portion — run this first and last
pnpm verify:exit --verbose
```

`verify:exit` is **read-only** and safe against production. It cannot post a
Slack message or click "Send test" in a provider console, so the steps that need
a live delivery are marked **MANUAL** below.

---

## Known constraints

These are **documented limitations, not test failures**. A run that reports them
is behaving correctly.

| # | Constraint | Effect | Remedy |
| --- | --- | --- | --- |
| C1 | ~~Slack lacks `users:read.email`~~ — **RESOLVED**, scope granted after reinstall | Slack identities now auto-resolve by email (verified: 30 humans, 30 emails). Slack event envelopes still carry no email themselves, so resolution happens via the `users.list` backfill, not from the event. | None. Keep `requireEmailScope()`: a scope lost to token rotation returns HTTP 200 with the email silently omitted, so a backfill would report success and link nobody. |
| C2 | Vision sends `actor.email: null` on every real event so far | Vision identities usually arrive unresolved even though the contract allows an email | Link by hand once per person; every later event resolves at step 1 (exact) automatically. |
| C3 | Fireflies `audio_url` / `video_url` are **paid-plan only** | Requesting either fails the WHOLE GraphQL query with "You need to be subscribed to a paid plan", which reads like the entire API being unavailable | Already handled: both fields are excluded from `TRANSCRIPT_FIELDS`. Everything else — `sentences`, `speakers`, `summary`, `participants`, `transcript_url` — works on the current plan. **Do not add them back.** |
| C4 | The Fireflies webhook carries no actor (`{event, meeting_id, timestamp}` only) | A Fireflies `unified_event` has `person_id = NULL` by construction | Speaker→person attribution comes from the transcript's `speakers`/`participants`, which is Week 2 extraction work. |
| C5 | `.env.local`'s `DATABASE_URL` points at the **production** Railway database | Anything you run locally reads and writes production | Intended for now. Be deliberate with `--commit` flags. |

---

## Step 0 — Prerequisites (do this first)

Automatic identity resolution needs at least one person to have an email —
**email is the only cross-system join key**, because Vision, UGC and Command
Centre are three separate Clerk instances whose ids are not comparable.

```bash
pnpm people:email                                  # list the roster
pnpm people:email "Ardin" ardin@luckyfours.com     # set one
```

> Addresses are set at run time, never committed: this repo is public.

**Expected:** `pnpm verify:exit` check `5b` goes from ❌ to ✅.

```sql
SELECT name, email FROM person ORDER BY name;
```

Confirm the workers are running (Railway logs, or `pnpm dev` locally):

```
[queue] workers started for 5 queues (batchSize=2, retryLimit=5)
```

---

## Step 1 — Slack message → attributed event  🖐️ MANUAL

Post a message in a channel the bot has been invited to.

> `#proj-` is a **convention for where the bot is invited**, not a filter. The
> handler stores events from every channel deliberately — an event never stored
> cannot be replayed, whereas a wrong downstream filter is one `WHERE` clause
> from being fixed.

**1a. It lands in `raw_event`:**

```sql
SELECT id, external_id, received_at, processed
FROM raw_event
WHERE source = 'slack'
ORDER BY received_at DESC
LIMIT 3;
```
*Expected:* a new row within seconds. `external_id` is Slack's `event_id`
(`Ev…`), **not** `event.ts`.

**1b. It is normalised:**

```sql
SELECT ue.event_type, ue.occurred_at, ue.occurred_at_source,
       ue.subject_type, ue.subject_id, ue.person_id
FROM unified_event ue
JOIN raw_event re ON re.id = ue.raw_event_id
WHERE re.source = 'slack'
ORDER BY ue.occurred_at DESC
LIMIT 3;
```
*Expected:* `event_type = 'message'`, `occurred_at_source = 'payload'`,
`subject_type = 'channel'`.

> ⚠️ Slack fires **`app_mention` AND `message`** for the same message when the
> bot is mentioned. Two `raw_event` rows, two `unified_event` rows, same
> `occurred_at`. That is correct — but any "messages sent" count must filter on
> `event_type` or it double-counts mentions.

**1c. `person_id` resolves with NO manual step:**

⚠️ The Slack **event envelope** carries no email — only a `U…` id. Resolution
comes from the `users.list` backfill, which now works because `users:read.email`
is granted. Run it once so the identity carries an address:

```bash
pnpm identities:backfill slack --commit
```

```sql
SELECT source, external_id, email, person_id, confidence
FROM person_identity
WHERE source = 'slack'
ORDER BY created_at DESC;
```
*Expected:* rows with a populated `email`, and `person_id` set with
`confidence = 'email'` **for anyone whose address is on a person** (Step 0).

An identity whose Slack address is not on the roster stays
`person_id IS NULL` — correct, not a failure. Link it at
`/dashboard/identities`, then:

```sql
SELECT count(*) FROM unified_event ue
JOIN person_identity pi ON pi.id = ue.person_identity_id
WHERE pi.source = 'slack' AND ue.person_id IS NOT NULL;
```
*Expected:* every historical Slack event for that user is attributed by one
`UPDATE`, because `unified_event.person_identity_id` is stored.

---

## Step 2 — Fireflies transcript replay

A committed, scrubbed fixture makes this repeatable without spending API quota
(the plan allows a limited number of requests per **day**).

**2a. Replay the stored fixture through the schema:**

```bash
pnpm vitest run src/features/connectors/fireflies
```
*Expected:* all pass, including the real-shape fixture
`fixtures/fireflies/replay-transcript.json`.

**2b. Replay the committed fixture through the real pipeline** (spends NO API
call — this is the repeatable path):

```bash
pnpm verify:exit --replay
```

⚠️ `--replay` is the one mode of `verify:exit` that WRITES. It runs the fixture
through `ingestRawEvent` → `normaliseRawEvent` → the worker's
upsert-on-`fireflies_id`, i.e. the same code a live delivery uses; only the
network call is substituted. Rows are namespaced `replay-` and re-running
updates rather than duplicating.

**Or fetch live** (spends one request from a per-DAY quota):

```bash
pnpm renormalise --source=fireflies --commit
```

```sql
SELECT fireflies_id, title, duration_seconds,
       jsonb_array_length(payload->'sentences') AS sentences,
       jsonb_array_length(payload->'speakers')  AS speakers,
       fetched_at
FROM transcript
ORDER BY fetched_at DESC;
```
*Expected:* a row with a non-zero sentence and speaker count.

**2c. The announcement is normalised:**

```sql
SELECT ue.event_type, ue.subject_type, ue.subject_id, ue.person_id
FROM unified_event ue
JOIN raw_event re ON re.id = ue.raw_event_id
WHERE re.source = 'fireflies'
ORDER BY ue.occurred_at DESC;
```
*Expected:* `event_type = 'meeting.transcribed'`, `subject_type = 'meeting'`,
and **`person_id IS NULL`** — see C4. That is the correct result, not a failure.

**2d. Speaker identities:** not implemented. The webhook has no actor and
`speakers` lives on the fetched transcript, so mapping speakers to people is
Week 2 extraction work. The raw material is in place:

```sql
SELECT jsonb_pretty(payload->'speakers'), payload->'participants'
FROM transcript LIMIT 1;
```

**To regenerate the fixture** (rarely needed):

```bash
pnpm fireflies:fixture <meetingId>
```
It scrubs speaker names and emails, replaces the AI summary with synthetic prose
— a real meeting summary is dense business content and this repo is public —
then **verifies its own output** and refuses to write a file that still contains
a real name or a non-`example.com` address.

---

## Step 3 — Vision and UGC events  🖐️ MANUAL

Trigger one of each (act in Vision; use UGC's webhook test or a real action).

```sql
SELECT re.source, ue.event_type, ue.occurred_at, ue.occurred_at_source,
       ue.subject_type, ue.subject_label, ue.person_id, pi.email
FROM unified_event ue
JOIN raw_event re ON re.id = ue.raw_event_id
LEFT JOIN person_identity pi ON pi.id = ue.person_identity_id
WHERE re.source IN ('vision','ugc')
ORDER BY ue.occurred_at DESC
LIMIT 10;
```

*Expected:*
- Both normalise, `occurred_at_source = 'payload'` (both send ISO 8601).
- **UGC** carries `actor.email` when a real user acts → `person_id` populates
  automatically if that address is on a person.
- **Vision** usually has `email IS NULL` → `person_id IS NULL`. See C2.
- UGC's `actor.id = "system"` events record **no identity at all** — deliberate,
  since a "system" identity would sit in the manual queue forever.

> ⚠️ The two contracts differ at every turn: UGC uses `type`/`actor.id`/`entity`,
> Vision uses `event`/`actor.user_id`/`subject`. Reusing one normaliser for both
> would parse nothing and report success.

---

## Step 4 — ClickUp task change  🖐️ MANUAL

Change a task's status in ClickUp.

```sql
SELECT ue.event_type, ue.occurred_at, ue.subject_type, ue.subject_id,
       ue.metadata->>'field' AS changed_field,
       ue.person_id, pi.email
FROM unified_event ue
JOIN raw_event re ON re.id = ue.raw_event_id
LEFT JOIN person_identity pi ON pi.id = ue.person_identity_id
WHERE re.source = 'clickup'
ORDER BY ue.occurred_at DESC
LIMIT 5;
```

*Expected:* `event_type = 'taskUpdated'`, `subject_type = 'task'`,
`changed_field = 'status'`.

**ClickUp is the only source that carries the actor email inline**
(`history_items[].user.email`), so `person_id` populates automatically as soon as
that address is on a person. If it does not, check Step 0.

> `subject_label` is deliberately NULL — ClickUp is the system of record for task
> content and CLAUDE.md forbids mirroring titles.

---

## Step 5 — Retry and dead-letter

Proves a failing job retries with backoff and eventually dead-letters rather
than vanishing or spinning forever.

```bash
pnpm test:db    # includes the queue integration suite
```
*Expected:* the retry, exhaustion and dead-letter tests pass against real
pg-boss.

Inspect live queue state:

```sql
SELECT name, state, count(*) AS n
FROM pgboss.job
GROUP BY 1, 2
ORDER BY 1, 2;

-- Anything that exhausted its retries:
SELECT name, state, retry_count, output, created_on
FROM pgboss.job
WHERE state = 'failed' OR name = 'parse.dead-letter'
ORDER BY created_on DESC
LIMIT 20;
```

*Expected:* `completed` dominates. `failed` / `parse.dead-letter` rows are fine
if they came from a deliberate failure test — check `output`.

Two behaviours worth knowing:
- **Permanent failures skip the ladder.** A plan or auth error throws
  `PermanentJobError`, which the worker turns into pg-boss's `deadletter` status
  on the **first** attempt. Six attempts cannot change a billing tier, and the
  API budget is per **day**.
- **A poison job does not take its batch down.** `batchSize: 2` means the handler
  receives an array; `perJobResults: true` plus a per-job try/catch settles each
  job on its own outcome.

---

## Step 6 — Idempotency

**6a. A duplicate delivery creates no second `raw_event`:**

```bash
pnpm tsx scripts/send-test-webhook.ts vision                # note the id
pnpm tsx scripts/send-test-webhook.ts vision --duplicate    # same id again
```
*Expected:* both return **200**, and the second prints
`✅ dedupe  same row as the first send`.

```sql
SELECT source, external_id, count(*)
FROM raw_event
WHERE external_id IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1;
```
*Expected:* **zero rows.**

**6b. Re-normalising creates no second `unified_event`:**

```bash
pnpm renormalise --commit
pnpm renormalise --commit    # again
```

```sql
SELECT raw_event_id, source_seq, count(*)
FROM unified_event
GROUP BY 1, 2
HAVING count(*) > 1;
```
*Expected:* **zero rows.**

**6c. Re-normalising preserves ids** — Week 2's extraction pipeline will
reference `unified_event.id`, so a rebuild must not invalidate them:

```sql
SELECT count(*) FILTER (WHERE created_at = updated_at) AS never_rebuilt,
       count(*) FILTER (WHERE updated_at > created_at) AS rebuilt,
       count(*) AS total
FROM unified_event;
```
*Expected:* `created_at` never moves; only `updated_at` does.

**6d. A tampered payload is rejected:**

```bash
pnpm tsx scripts/send-test-webhook.ts vision --tamper
```
*Expected:* **401**, and no new `raw_event` row.

---

## Sign-off

```bash
pnpm verify:exit
```

Week 1 is complete when:

- [ ] `verify:exit` reports **0 fail**
- [ ] Every remaining ⚠️ maps to a documented constraint C1–C5
- [ ] Steps 1, 3 and 4 have been run manually with live events
- [ ] `pnpm test` and `pnpm test:db` pass
- [ ] `pnpm build` exits 0

| verify:exit id | Checklist step |
| --- | --- |
| 1, 2, 2b | Ingest and normalisation coverage |
| 3 | Timestamp parsing (steps 1–4) |
| 4, 4b | Step 6 — idempotency |
| 5, 5b, 5c | Step 0 and identity resolution |
| 6 | Audit trail (`linked_by` / `linked_at`) |
| 7, 7b | Step 5 — retry and dead-letter |
| 8, 8b | Step 2 — Fireflies |
| 9 | Constraint C1 |
