# Extraction eval fixtures

Ground truth for `pnpm eval:extraction`. Each case is a directory holding two
files:

```
<case>/transcript.json       the meeting, in the shape the extractor consumes
<case>/expected-items.json   hand-labelled action items + labelled traps
```

Both files must exist. A transcript with no labels cannot be scored, and the
loader refuses to load a half-case rather than quietly skipping it.

---

## ⚠️ The synthetic score is not an accuracy figure

`synthetic/` contains three transcripts **written by hand for this harness**.
They exist to:

- prove the pipeline runs end to end — fixture → prompt → model → parse → score
- catch a **regression** when the prompt, the model slug, or the parser changes
- exercise specific failure shapes that are hard to find in the wild

They do **not** estimate how well extraction works on real meetings, and a
number from them must never be reported as if they did. Three reasons:

1. **The cases were authored alongside the thing being tested.** The transcripts
   were written knowing what the prompt says. Real meetings were not.
2. **They are cleaner than reality.** Every speaker is correctly attributed, no
   crosstalk, no ASR errors, no half-finished sentences, no three people talking
   over each other. Fireflies output is none of those things.
3. **n = 3.** One item moving changes the headline by double digits.

The runner enforces the distinction: real and synthetic are scored and printed
**separately**, there is no blended headline, and a synthetic-only run prints a
reminder that the gate proved "no regression", not "accurate".

---

## Why `real/` is empty

Real accuracy is currently **unmeasured**. Two things block it, and neither is
fixable in code:

1. **Fireflies returns `You need to be subscribed to a paid plan to perform this
   action`** for any transcript the token holder does not own. So even with
   workspace access, other people's meetings cannot be pulled for labelling.
2. **Fireflies API work must run against a dedicated TEST account** per the
   security rule — and a fresh test account has no meeting history, so there is
   nothing in it to build an eval set from.

The one transcript that was obtainable was scrubbed down to ten greeting
sentences containing no commitments, so it cannot score extraction either.

This is a **data-access problem, not a harness problem**. The real path is
built and runs; drop labelled cases into `real/` and they are scored
automatically, with no code change. Until then the reported real metrics are
`n/a`, which is the honest answer.

### What would unblock it

- an upgraded Fireflies plan on the test account, **or**
- a handful of meetings recorded *into* the test account specifically for
  evaluation, **or**
- written sign-off to label 3–5 transcripts from the production account, with
  the scrub below applied before anything is committed.

---

## Fixture hygiene

**This repository is public.** A captured ClickUp response leaked a real work
email once already, and a scrubbed Fireflies transcript retained a speaker's
home city — that one passed every mechanical rule, because a city is not a name
and not an email address.

Rules for anything under `real/`:

- **Print the retained content in full and read it.** `pnpm eval:extraction
  --review` dumps every line of every fixture. A scrub report that says
  "replaced 3 names, 2 emails" tells you nothing about the sentence that
  survived; only reading the kept text catches the city, the employer, the
  clinic appointment, the salary figure, the name of somebody's kid.
- Speaker names → `Speaker A` / `Speaker B`, or plausible synthetic names.
- Emails → `@example.com`.
- Then read it again for what has no mechanical signature: places, employers,
  health, family, money, anything about a person outside work.
- If a line cannot be made safe, **delete the line.** A shorter fixture is fine;
  a leak is not.

Cases under `synthetic/` contain no real data — people, companies and events in
them are invented — so the scrub does not apply. They are still printed by
`--review`.

---

## What each synthetic case is for

| Case | Items | Tests |
| --- | --- | --- |
| `01-content-planning` | 3 | explicit commitment with an absolute date; an implicit one (`"I'll take that one"`) needing the previous line for context; an **ambiguous owner** — two people named Chris, and the transcript refuses to pick |
| `02-engineering-sync` | 4 | relative dates (`"by end of week"` → Friday; `"first thing Monday"` crossing a month boundary); a conditional-but-real commitment; a commitment whose date is genuinely unknowable and must be `null` |
| `03-strategy-discussion` | **0** | the zero case — a full meeting of substantive discussion with no commitments at all |

Case 03 carries the most weight. Every other case asks whether the extractor
finds what is there; 03 asks whether it can find **nothing** and be comfortable.
A model rewarded for looking useful will manufacture two or three plausible
items from a strategy discussion, and each one spends a reviewer's attention and
a little of their willingness to read the next batch. It is also the only case
where precision and hallucination rate are measurable in isolation: with zero
true items, every emitted item is a false positive by definition.

Across the three cases there are **17 labelled traps** — lines that must *not*
become action items. Suggestions (`"we should probably…"`), ideas explicitly
parked, agreement, questions, observations, needs voiced with no owner, and one
proposal the speaker disowns two lines later.

---

## ⚠️ Known weakness: these cases are too easy to catch a prompt regression

Established by deliberately breaking the prompt and re-running. Results on the
current model (`anthropic/claude-sonnet-5`):

| Prompt mutation | Effect on the scorecard |
| --- | --- |
| Rule 1 (`RETURN AN EMPTY ARRAY` / do not invent) **deleted** | **none** — still 100% |
| Rule 1 **inverted** to "be exhaustive, capture suggestions and ideas" | **none** — still 100% |
| Rule 1 + the whole `Do NOT extract:` example block + the "specific person took on specific work" paragraph **all deleted** | **none** — still 100% |
| `owner_name` forced to the literal `"Unknown"` | owner accuracy → **0%**, gate FAILS, recall/precision unaffected |
| `source_span` forced to be invented prose instead of a quote | hallucination → **11.1%**, gate FAILS |

Read that honestly, in both directions:

- **The harness works.** The last two rows prove the metrics move, the gate
  fails, and the process exits non-zero. They also prove the metrics are
  independent — destroying owner accuracy left recall and precision at 100%,
  which is what the matched-items denominator is for.
- **The first three rows are the problem.** Removing *all* the negative guidance
  from the prompt changed nothing, which means these three transcripts cannot
  currently detect a precision regression. The traps are too obvious: a strong
  model rejects "we should probably…" on general competence, with no help from
  the prompt.

So a green run here means **"the pipeline is intact"**, not "the prompt is
good". A weaker or cheaper model would likely fail these; Sonnet 5 does not need
the guardrails to pass them.

Worth doing when there is time or real data:

- harder traps — a suggestion phrased as a commitment, an owner named in the
  third person two turns away from the verb, a commitment retracted later
- crosstalk, ASR errors, and mis-attributed speaker labels, which real Fireflies
  output has and these do not
- run the same fixtures against the `fast` tier, where the guardrails should
  start mattering, and keep a per-tier baseline

---

## The metrics

| Metric | Definition | Denominator |
| --- | --- | --- |
| **owner accuracy** | right person named | items **matched** |
| **item recall** | true items found | items **expected** |
| **precision** | found items that are real | items **emitted** |
| **hallucination rate** | quotes not in the transcript | items **emitted** |

Two notes on definitions that are easy to get wrong, and are asserted in
`src/features/extraction/eval/score.test.ts`:

**Precision and hallucination rate are not the same measurement.** A false
positive that quotes a real line — `"we should probably look at pricing"` — is a
*judgement* error: the text exists, the model misread discussion as commitment.
A false positive whose `source_span` appears nowhere is a *fabrication*: the
model invented the evidence a reviewer would use to verify it. The first is a
prompt-tuning problem; the second means the output cannot be trusted at all.
Hallucination is checked mechanically against the transcript text, so it needs
no labels.

**Owner accuracy is denominated on matched items only.** Including items the
extractor never found would fold recall failures into the owner number, and both
metrics would move for the same reason — making a regression impossible to
place.

`null` is not `0`. A meeting with no true items has no recall; `0/0` is
undefined, and reporting it as 0% would penalise a case that was handled
perfectly. Null metrics print `n/a` and **skip** the threshold gate rather than
failing it.

---

## Adding a case

1. `mkdir fixtures/extraction-eval/<real|synthetic>/NN-short-name`
2. Write `transcript.json`:
   ```json
   {
     "id": "...", "origin": "synthetic|real",
     "title": "...", "meeting_date": "YYYY-MM-DD",
     "speakers": [{ "name": "..." }],
     "sentences": [{ "speaker_name": "...", "text": "..." }]
   }
   ```
   `meeting_date` is what relative dates resolve against — a wrong one makes
   every date in the case wrong.
3. Write `expected-items.json`. Give every item an `anchor`: a verbatim
   substring of the transcript. Matching is anchored on it rather than on the
   description, because the description is the model's own wording and varies
   legitimately between runs.
4. Fill in `must_not_extract` with the lines that must stay out. **This is the
   half people skip**, and it is the half that measures precision.
5. `pnpm eval:extraction --review` and read the output.

`origin` is declared in three places — the directory, `transcript.json`, and
`expected-items.json` — and the loader refuses to run if they disagree. The
redundancy is deliberate: this is the one field that decides whether a number
may be reported as real.
