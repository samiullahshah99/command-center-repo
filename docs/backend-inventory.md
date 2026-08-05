# Backend Inventory

**Purpose.** This backend is being rebuilt. This document inventories what exists
so the rebuild can decide, per component, whether to **port**, **rebuild**, or
**drop**.

**Method.** Written by reading every schema, connector, route handler and service
in the repo, and by querying the live database read-only for row counts and
distributions. Nothing was changed. Claims marked **⚠️ MEASURED** were verified
against the live system on 2026-08-05; claims marked _(per code comment)_ are
reported from in-repo documentation and were not independently re-verified.

**No PII in this file.** Person names, email addresses and meeting identifiers are
deliberately described by shape and count only — this repo is public, and
`fixtures/*/api-*.json` has leaked a real work email once already.

---

## 0. The thing to settle before anything else: there is real production data

**⚠️ MEASURED.** The database is not a sandbox. It holds 578 real inbound events
spanning 2026-07-29 → 2026-08-04, six real meeting transcripts, and a small
amount of human review work that cannot be regenerated.

| Table                   | Rows    | Origin                                                       | Reproducible?                                                        |
| ----------------------- | ------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `raw_event`             | **578** | 🔴 **REAL** — live webhook deliveries                        | ❌ **NO.** Senders got their 2xx and will never redeliver            |
| `unified_event`         | **578** | 🟡 Derived from `raw_event`                                  | ✅ Yes — `pnpm renormalise`                                          |
| `transcript`            | **6**   | 🔴 **REAL** — fetched from Fireflies, 13–1060 sentences each | ⚠️ Only while Fireflies retains them, and refetch costs quota        |
| `candidate_action_item` | **19**  | 🟡 LLM output over real transcripts                          | ⚠️ Regenerable at ~$0.04/run, but **wording will differ** (see §6.3) |
| `person_identity`       | **21**  | 🟠 Mixed — 4 human-confirmed links, 17 automatic/unresolved  | ⚠️ The 4 `manual` links are human decisions; the rest replay         |
| `tracked_item`          | **26**  | 🟠 25 seeded + **1 promoted from a real human approval**     | ⚠️ The promoted row is a real review decision                        |
| `ai_summary`            | 2       | 🟢 Cache                                                     | ✅ Regenerates on demand                                             |
| `person`                | 7       | 🟢 Seeded roster                                             | ✅ `pnpm db:seed`                                                    |
| `role_profile`          | 7       | 🟢 Seeded                                                    | ✅ `pnpm db:seed`                                                    |
| `project`               | 4       | 🟢 Seeded + auto-created `Inbox`                             | ✅                                                                   |
| `recurring_task`        | 5       | 🟢 Seeded                                                    | ✅                                                                   |
| `completion_event`      | **0**   | —                                                            | Never written by anything                                            |

### What is genuinely irreplaceable

1. **`raw_event` (578 rows).** This is the only copy. The whole architecture is
   built on "store verbatim, parse later" precisely so payloads survive parser
   bugs — but that guarantee is void if the table itself is dropped. **Export
   this before the rebuild starts**, independent of whether the new backend keeps
   the schema. It is a JSONB blob plus five scalar columns; a `COPY … TO` is
   enough.
2. **`transcript` (6 rows).** Real meeting content. Refetchable in principle,
   but the Fireflies API is **500 requests/day** and transcripts are only
   retrievable while Fireflies retains them.
3. **The 4 human-confirmed `person_identity` links and the 1 approved
   candidate.** Small, but they are the only human decisions in the system. Every
   other row is machine-generated or seeded.

> ⚠️ **`raw_event` and `transcript` payloads contain real names, real email
> addresses and real meeting speech.** Any export is a PII artifact — it must not
> land in this repo, in a fixture, or in a public bucket.

### The attribution gap, measured

**⚠️ MEASURED.** Identity resolution is working for some sources and not at all
for others:

| Source      | Events | Attributed to a person | Rate      |
| ----------- | ------ | ---------------------- | --------- |
| `slack`     | 11     | 10                     | **90.9%** |
| `clickup`   | 2      | 1                      | 50.0%     |
| `vision`    | 427    | 182                    | **42.6%** |
| `ugc`       | 128    | 0                      | **0.0%**  |
| `fireflies` | 10     | 0                      | **0.0%**  |

The two zeroes are the finding. UGC delivers 128 events — including 81
`creator.rejected`, 18 `creator.approved`, 11 `order.placed` — and **not one is
attributed to anybody.** Per the schema's own documentation, UGC and Vision both
send `actor.email` as nullable and Vision sends `null` routinely, so this is the
designed-for case rather than a bug — but it means any UGC-derived per-person
metric currently reports zero and looks like "no activity" rather than "no
attribution". Fireflies is 0/10 for the same reason: the webhook envelope carries
a `meeting_id` and no actor at all.

**For the rebuild:** whatever replaces this needs a deliberate answer for
identity on sources that do not send an email. The current answer is "persist
unresolved and wait for a human", which is defensible but has produced a 0% rate
on 24% of all traffic.

### Queue state

**⚠️ MEASURED** — `pgboss.job`:

| Queue                  | completed | failed / other         |
| ---------------------- | --------- | ---------------------- |
| `parse.vision`         | 435       | —                      |
| `parse.ugc`            | 137       | —                      |
| `parse.slack`          | 17        | —                      |
| `parse.clickup`        | 6         | —                      |
| `parse.fireflies`      | 5         | **2 failed**           |
| `extract.action-items` | 1         | **1 failed**           |
| `parse.dead-letter`    | —         | 3 created (unconsumed) |

Three dead-lettered jobs are sitting unconsumed. The pipeline is otherwise clean.

---

## 1. Stack and topology

| Layer      | Choice                                                                            |
| ---------- | --------------------------------------------------------------------------------- |
| Runtime    | Next.js 16.2.6, React 19.2.4, Node (`output: 'standalone'`), long-lived container |
| Host       | Railway; Postgres 18                                                              |
| ORM        | Drizzle 0.45 + `node-postgres`, connection `Pool`                                 |
| Queue      | pg-boss 12.26 **in the same Postgres**, dedicated `pgboss` schema                 |
| Workers    | **In-process**, booted from `src/instrumentation.ts`                              |
| Auth       | Clerk (authentication only — Organizations and Billing removed)                   |
| Validation | Zod 4 + `drizzle-zod`                                                             |
| LLM        | OpenRouter (OpenAI SDK shape) → Anthropic models                                  |
| Errors     | Sentry                                                                            |
| Migrations | 11 files, `drizzle/0000_*` → `0010_*`, applied **manually from a laptop**         |

**Two database URLs, deliberately:** `DATABASE_URL` (private network, used by the
app) and `DATABASE_PUBLIC_URL` (proxy host, used by drizzle-kit and the tsx
scripts, which run from a laptop and cannot reach `*.railway.internal`).

**SSL is `{ rejectUnauthorized: false }`** because Railway's proxy presents a
certificate that does not chain to a public root. The connection is genuinely
TLS 1.3; this protects confidentiality but not against an active MITM.

### The one architectural constraint that shaped everything

Workers run **in-process** inside the Next.js server, started by
`register()` in `src/instrumentation.ts` — fire-and-forget, never awaited, so a
bad `DATABASE_URL` cannot stop the web tier from serving health checks.
`src/lib/queue/registry.ts` is the single source→handler map, and its header
states the intent plainly: workers are isolated behind it so moving them to a
separate service later is a change to the entrypoint, not to any handler.

**Port verdict: ✅ the seam, not the mechanism.** If the rebuild is a separate
Python/FastAPI service, the registry indirection has already done its job. Take
the boundary; drop pg-boss.

---

## 2. Data model

12 tables, all `snake_case`, singular entity names. Timestamps are
`timestamptz` throughout, `updated_at` maintained by Drizzle's `$onUpdate`.

### 2.1 The spine: `raw_event` → `unified_event`

```
webhook → verify HMAC (401 on failure, before anything else)
        → persist raw_event VERBATIM
        → enqueue parse job IN THE SAME TRANSACTION
        → 2xx
worker  → normalise → unified_event + resolve identity
```

**`raw_event`** — the landing zone and the source of truth.

| Column        | Notes                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| `source`      | `text` + app-level list, **not** a PG enum — adding a source needs no migration |
| `payload`     | `jsonb`, verbatim. Zod is deliberately `z.unknown()`                            |
| `external_id` | The provider's own id. **Nullable**                                             |
| `processed`   | Means "mapped into `unified_event`"                                             |

Idempotency is a **partial unique index** on `(source, external_id) WHERE
external_id IS NOT NULL`, combined with `ON CONFLICT DO NOTHING` in a single
statement — not select-then-insert, which is what makes concurrent duplicate
deliveries safe.

> ⚠️ **The deliberate gap:** events with a NULL `external_id` are **not**
> deduplicated, because Postgres treats NULLs as distinct in a unique index. That
> covers setup test pings (intentional — a constant id would make the second ping
> vanish, which during setup looks exactly like a broken handler), ClickUp
> `taskDeleted`, and off-contract payloads. **⚠️ MEASURED:** 15 of 578 rows have
> a null `external_id`.

**`unified_event`** — derived and disposable, one row per thing that happened.

Key design points worth porting verbatim:

- **`(raw_event_id, source_seq)` unique key** makes re-normalisation an
  **upsert**. It must never delete-and-reinsert: `candidate_action_item` holds
  FKs to `unified_event.id`.
- **`source_seq` is always 0 today** and exists anyway, because widening a UNIQUE
  constraint later on a table the extraction pipeline references is a far worse
  migration than carrying an integer that is currently always zero. (ClickUp's
  `history_items` is an array and may eventually batch.)
- **`normaliser_version`** (currently `1`) records which mapping logic produced a
  row, so `renormalise --stale` can target `WHERE normaliser_version < n`.
- **`occurred_at_source`** (`'payload' | 'received_at'`) records whether the
  timestamp was real or a fallback. A silently substituted timestamp skews every
  time-series query with no way to notice.
- **`event_type` is NOT constrained to a known set.** Every sender's contract
  says their catalog is additive; an unknown type must be stored, not rejected.
- **`person_identity_id` is stored alongside `person_id`** so linking an identity
  later back-fills the whole history in **one UPDATE** rather than a
  re-normalisation.

**Port verdict: ✅✅ port the design as-is.** This two-table split, the upsert
key, the version column and the `occurred_at_source` honesty flag are the most
valuable thing in the schema and are framework-independent.

### 2.2 Identity: `person` + `person_identity`

Identity is the **pair `(source, external_id)`**, never an id alone, because
**Vision, UGC and the Command Centre are three separate Clerk instances** — ids
are not comparable between them and may collide.

`person_identity` enforces this with a unique index on `(source, external_id)`,
which doubles as the `ON CONFLICT` target that makes recording an identity
idempotent.

Resolution order — `src/features/identity/resolve.ts`:

1. **EXACT** — a `person_identity` row already exists for the pair
2. **EMAIL** — case-insensitive match on `person.email`; creates the link so
   later events short-circuit at step 1
3. **UNRESOLVED** — persisted with a null `person_id`, never dropped

Details that are easy to lose and expensive to rediscover:

- **`person.email` is the ONLY automatic cross-system join key.** Case-insensitive
  uniqueness is a **functional partial index** on `lower(email) WHERE email IS
NOT NULL` rather than the `citext` extension — no `CREATE EXTENSION` needed on
  Railway, the stored value stays exactly as entered for display, and the index
  is the same expression the resolver matches on.
- **The upsert uses `COALESCE`, not assignment.** A later event carrying
  `email: null` must not erase an address an earlier event supplied — that would
  un-resolve an already-linked account, and Vision sends null routinely.
- **There is deliberately NO `'name'` confidence tier.** Two people can share a
  display name and a wrong auto-link silently attributes one person's work to
  another. Allowed values are `exact | email | manual` only, CHECK-enforced.
- **`person_identity_link_provenance_ck`** makes a link and its provenance travel
  together: either all of (`person_id`, `confidence`, `linked_at`) are set or all
  are null. "How did this link get made?" is the first question asked when an
  event is attributed to the wrong person.
- **`ON DELETE SET NULL`, not CASCADE** — deleting a person must not erase the
  record that these accounts were seen; the rows fall back to the unresolved
  queue.
- `IDENTITY_SOURCES` is a **superset** of `RAW_EVENT_SOURCES`: it adds `'portal'`
  (our own Clerk instance, which issues identities but never delivers webhooks).

> ⚠️ **`person.slack_id` / `clickup_id` / `portal_id` are deprecated and NULL for
> every row.** They cannot express three Clerk instances — one column per system
> with no `source` discriminator is exactly the shape that invites cross-system
> id comparison. **Drop them in the rebuild; do not port.**

**Port verdict: ✅✅ port the model and the resolver logic.** This is the second
most valuable component. See §0 for the caveat that it currently resolves 0% of
UGC and Fireflies traffic.

### 2.3 Extraction: `transcript` + `candidate_action_item`

**`transcript`** is separate from `raw_event` because a transcript is **pulled**,
not pushed: the webhook carries only `{ event, meeting_id, timestamp }`, and the
content is fetched over GraphQL. Keeping them apart means `raw_event` stays a
faithful record of what _arrived_ while a transcript can be re-fetched
independently. `fireflies_id` is UNIQUE, which is what makes the fetch idempotent.
The full GraphQL response is stored whole in `payload` — Postgres TOASTs it out of
the main row, so it costs nothing until read.

**`candidate_action_item`** is the review queue — LLM output that is explicitly
**not** the system of record. Every row lands `review_status='pending'`.

Constraints worth porting individually:

| Constraint                                 | What it prevents                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `source_span` NOT NULL, min 10 chars (Zod) | A reviewer with no quote cannot verify the item, so they approve on vibes and review becomes a rubber stamp                                |
| `content_hash` UNIQUE (global)             | Re-extraction upserts instead of duplicating                                                                                               |
| `owner_coherent_ck`                        | `owner_confidence='unresolved'` ⟺ `owner_person_id IS NULL`                                                                                |
| `review_provenance_ck`                     | `pending` has no reviewer; `approved`/`rejected` require both `reviewed_by` and `reviewed_at`; `auto_approved` requires `reviewed_at` only |
| `external_pair_ck`                         | `external_task_id` and `external_system` are set together or not at all                                                                    |
| `confidence_range_ck`                      | `0 ≤ confidence ≤ 1`                                                                                                                       |

- **`owner_confidence` allows `'fuzzy'` — and this is the ONLY table where it
  exists.** `person_identity`'s CHECK rejects it. A name match is tolerable on a
  review queue because it can never auto-approve; on approval the identity link
  is written as `'manual'`, because by then a human really did confirm it.
- **`content_hash` is sha256 over `owner_name` + `source_span`, NOT the
  description.** Models paraphrase; hashing the description would file the same
  commitment twice on every re-run.
- **`edited_fields` is the live precision metric**, and there is deliberately **no
  `'edited'` review status** — editing is not a different decision, so it is a
  qualifier on the approval rather than a state. That keeps every "was this
  approved?" query as `review_status = 'approved'` with no `IN (…)` to forget.
- **Candidate rows are immutable after extraction.** Reviewer corrections go onto
  the `tracked_item`; nothing is written back. Overwriting the model's output
  makes "how often was the model right?" unanswerable.

**Port verdict: ✅ port the table and every constraint.** The immutability rule and
`edited_fields` are what make model quality measurable at all.

> ⚠️⚠️ **Port the `content_hash` idempotency with a known defect, documented in
> CLAUDE.md and confirmed by the data.** The model does not return an identical
> `source_span` across runs even at temperature 0 — one item's span was observed
> widening from a single sentence to two. Different span → different hash →
> `ON CONFLICT` does not fire → **a duplicate pending row**. The existing
> idempotency test mocks the model with a fixed response, so it proves Postgres
> upserts correctly and proves nothing about whether the input is stable.
>
> **⚠️ MEASURED, consistent with the defect being latent rather than active:** all
> 19 candidate rows are distinct commitments; no duplicate pair is currently
> visible. The pipeline has only run a handful of times.
>
> **The rebuild should fix this rather than port it.** Do _not_ hash the
> description (it varies far more). Match on span **overlap** against existing
> candidates for the same `unified_event_id` — which is what the eval scorer
> already does.

### 2.4 Tracker: `project` + `tracked_item`

`tracked_item` is the board at `/dashboard/tracker`, and the Command Centre is
the task system of record (amendment 2026-08-04). Its central rule is enforced by
CHECK constraints rather than convention:

| `source_system`     | Owns content?        | `external_task_id` | `title`/`description` |
| ------------------- | -------------------- | ------------------ | --------------------- |
| `internal`          | ✅ Command Centre    | must be NULL       | populated             |
| `notion`, `clickup` | ❌ the source system | **required**       | **must be NULL**      |

- **`tracked_item_content_by_source_ck` is an ALLOW-list**
  (`source_system = 'internal' OR (title IS NULL AND description IS NULL)`), not
  a deny-list. It was `source_system <> 'clickup' OR …` — a deny-list of one,
  which silently started permitting mirrored Notion titles the moment `'notion'`
  joined the set, while still existing under the same name and passing review.
  **Port it as an allow-list.**
- **`tracked_item_candidate_key`** is a partial unique index on
  `candidate_action_item_id WHERE NOT NULL` — one tracked item per candidate. The
  promotion path also guards with `SELECT … FOR UPDATE`; the index is the
  backstop, because procedural guards have to be remembered by the next caller
  and a constraint cannot be forgotten.
- **`status` is TEXT + Zod, not a PG enum**, on purpose: these values churn and
  `ALTER TYPE` cannot run in a transaction and can never remove a value.
  `source_system` was converted from an enum for exactly this reason, while the
  table was empty.

**⚠️ MEASURED:** all 26 rows are `source_system='internal'`. 25 are
`source_type='manual'` (seeded); 1 is `source_type='meeting'` and carries a
`candidate_action_item_id` — the single real promotion.

#### `external_task_id` means "mirrors an external system", never "was pushed to"

Three columns share the `EXTERNAL_SYSTEMS` set and **do not mean the same thing**:

| Column                                                        | Meaning                                  |
| ------------------------------------------------------------- | ---------------------------------------- |
| `tracked_item.source_system` / `.external_task_id`            | where the row **CAME FROM**              |
| `candidate_action_item.external_system` / `.external_task_id` | where an approved item was **PUSHED TO** |
| `project.external_system` / `.external_id`                    | where the project **MIRRORS FROM**       |

**There is no outbound sync and these columns are not for one.** Field naming is
vendor-neutral because a full day of ClickUp-shaped work had to be retargeted
when the destination changed mid-project — a column called `clickup_task_id` is a
migration, a backfill and a rename across every query the day the vendor changes.

**Port verdict: ✅ port the constraints and the vendor-neutral naming.** ⚠️ **Known
accepted gap:** a _manually created_ `tracked_item` has no candidate, so it has
**no destination slot at all**. Fine while manual items are not synced outward;
if that changes, add a destination pair to `tracked_item` rather than overloading
`external_task_id`.

### 2.5 Supporting tables

| Table              | Shape                                                                                                          | Verdict                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `role_profile`     | `name` + three JSONB columns (`tracked_signals`, `quota_config`, `source_channels`)                            | 🟡 **Rebuild.** All three JSONB columns are effectively untyped; the shape has not settled                                    |
| `recurring_task`   | `owner_person_id`, `cadence`, `auto_complete_rule` JSONB, `fallback_manual`                                    | 🟡 **Rebuild.** 5 seeded rows, no consumer writes to it                                                                       |
| `completion_event` | FK to `recurring_task`, `completed_at`, `evidence_source`/`evidence_ref`                                       | 🔴 **Drop or redesign.** **0 rows, never written by any code path.** The auto-completion feature it exists for does not exist |
| `ai_summary`       | Per-`person_id` cache: `summary`, `input_hash`, `item_count`, `event_count`, `model`, token counts, `cost_usd` | ✅ **Port the caching design** — see §6.4                                                                                     |

> `completion_event` being empty with no writer is worth calling out: PRD
> auto-completion is unbuilt, and the table is a schema placeholder rather than a
> working feature. Do not port it as though it works.

---

## 3. Integrations

Five inbound webhook sources, **five different signature schemes**, three
outbound API clients, and two deliberately-unimplemented stubs.

### 3.1 The five inbound signature schemes

| Source    | Header                   | Prefix    | Basestring       | Replay window |
| --------- | ------------------------ | --------- | ---------------- | ------------- |
| Slack     | `X-Slack-Signature`      | `v0=`     | `v0:{ts}:{body}` | ✅ ±300s      |
| UGC       | `X-LuckyFours-Signature` | `sha256=` | `{ts}.{body}`    | ✅ ±300s      |
| Vision    | `X-Vision-Signature`     | `sha256=` | `{body}`         | ❌ none       |
| ClickUp   | `X-Signature`            | _(none)_  | `{body}`         | ❌ none       |
| Fireflies | `X-Hub-Signature`        | `sha256=` | `{body}`         | ❌ none       |

`src/features/connectors/verify-hmac.ts` exposes **two** functions —
`verifyWithTimestamp()` and `verifyBodyOnly()` — rather than one with an optional
timestamp parameter. A security control must not be silently disabled by omitting
a config field; two functions make the absence visible at the call site.

Traps, each of which fails as something else:

- **UGC's separator is a literal DOT** (`{ts}.{body}`), not Slack's
  `v0:{ts}:{body}`. Copying the Slack verifier yields a valid-looking hex
  signature that never matches — reads exactly like a wrong secret.
- **Fireflies is `x-hub-signature` with NO `-256` suffix.** GitHub's convention is
  `x-hub-signature-256` and most examples online show that form. Reading the wrong
  header means every request 401s as "missing signature header", which looks like
  the sender not signing at all.
- **ClickUp sends `Authorization: <token>` RAW, with no `Bearer ` prefix.** Adding
  it returns `OAUTH_025`; omitting the header returns `OAUTH_017`. Neither message
  mentions a prefix.
- **UGC and Vision use different keys for the event type** — UGC sends `type`,
  Vision sends `event`. Both also send it as a header, which the handler prefers
  because it needs no payload-shape assumption.
- **The replay window uses `Math.abs`.** A one-sided check would let a forged
  _future_ timestamp replay indefinitely.
- **`timingSafeEqual` sits behind a length guard** — it throws on length mismatch.

> ⚠️⚠️ **Vision, ClickUp and Fireflies have NO replay protection.** None sends a
> timestamp header, so a captured request stays valid forever. **Idempotency is
> the sole defence on those three** — do not add side effects to those paths that
> are unsafe to repeat.
>
> Fireflies' v2 body _does_ carry a millisecond `timestamp`, and because the
> signature covers the body an attacker cannot alter it, so it _could_ bound
> replay. It deliberately does not: the payoff of a replay is an idempotent
> re-fetch, while a wrong window permanently drops a delayed retry from a sender
> whose retry behaviour is undocumented.

**Port verdict: ✅✅ port `verify-hmac.ts` and the scheme table directly.** This is
pure, dependency-free crypto logic with a test proving a re-serialised body fails
verification. It is the single highest-value-per-line file in the repo. Every
scheme is documented in `docs/webhook-contract.md`.

### 3.2 The mandatory handler pattern

Four rules, each of which exists because breaking it fails as a different problem:

1. **Verify the signature against the RAW body.** Read `await req.text()` once,
   then `JSON.parse` it yourself. Never `req.json()` first — it consumes the
   stream, and re-serialising changes the bytes.
2. **Write to `raw_event` BEFORE responding 2xx.** Senders do not retry after a
   success. Persist first and return **500** on failure so the sender retries and
   idempotency absorbs the duplicate.
3. **Idempotent on the sender's own event id.**
4. **`timingSafeEqual` behind a length guard.**

**Handlers never parse.** They verify, store verbatim, enqueue, and answer. A
parser bug in the request path loses the event permanently; with the payload
stored, it is a re-run.

**Insert and enqueue share ONE transaction** via pg-boss's `fromDrizzle(tx, sql)`
adapter, so a job can never reference a rolled-back row. **The enqueue is gated
on `inserted`, not on success** — a duplicate delivery queues nothing, or every
provider retry would redo the work.

> ⚠️ **Fireflies deliberately does NOT use `ingestAndEnqueue`.** A queue failure
> there rolls back the insert and returns 500, which is right for Slack, ClickUp,
> UGC and Vision (all retry on non-2xx) and wrong for Fireflies, whose retry
> behaviour is undocumented. That handler keeps a store-then-best-effort-enqueue
> shape on purpose.

**`ingestRawEvent()` is the ONLY write path into `raw_event`**, and
`src/features/connectors/ingest.ts` is deliberately **not** marked `'use server'`
— that would publish it as a Server Action, giving any browser an endpoint to
inject rows.

**Port verdict: ✅✅ port the pattern.** Framework-independent and load-bearing.

### 3.3 Slack

**Auth:** `Authorization: Bearer xoxb-…` (`SLACK_BOT_TOKEN`). No OAuth flow is
implemented — the app uses a single long-lived bot token from a manual install.

**Scopes in use:** `channels/groups read+history`, `chat:write`, `users:read`,
`app_mentions:read`, `users:read.email`.

**The `users:read.email` finding is the most valuable operational lesson here.**
Slack event envelopes carry a user id and nothing else, so resolving a Slack
account needs `users.info`/`users.list`, which return `profile.email` only with
that scope.

> ⚠️ **A missing scope is NOT an error.** `users.list` returns HTTP 200, `ok:
true`, and silently **omits** `profile.email` — measured at 30 humans / 0 emails
> while the scope was absent. A backfill reports success and links nobody.
> `requireEmailScope()` turns that silence into an actionable error by asserting
> that zero-out-of-N humans having an email is a scope problem, not data. It stays
> quiet when there are no humans at all, so an empty workspace is not blamed on
> the scope.
>
> **New scopes do not apply to an existing installation** — a reinstall was
> required, which cost a round trip.

Other Slack specifics:

- **Event subscriptions are workspace-wide.** Channel scoping happens by **bot
  invitation**, not config. Do not add channel-prefix filtering — persist
  everything and filter downstream on `payload->>'channel'`.
- **DMs work with `chat:write` alone; `im:write` is NOT needed** (verified).
- **The bot user id is the loop guard.** Every message the bot posts comes back as
  an `event_callback`; without the guard a replying bot replies to its own reply.
  Compare against the bot **user id**, not the app id or display name.
- **`users.list` follows cursor pagination.** Reading only the first page silently
  under-reports, which for a backfill means quietly leaving people unlinked.
- **Slack's `ok` field is checked BEFORE `res.ok`** — a missing scope is a 200, so
  an HTTP-first check misreports it as success.
- **The `url_verification` handshake** echoes the raw `challenge` within 3s.

**Port verdict: ✅ port `requireEmailScope` and the pagination + `ok`-ordering
logic.** The client itself is thin and rewriting it in another language is trivial;
the _knowledge_ is the asset.

### 3.4 Fireflies

**Auth:** `Authorization: Bearer <FIREFLIES_API_KEY>`, GraphQL only, at
`https://api.fireflies.ai/graphql`. No OAuth.

> ⚠️ **The published docs at `docs.fireflies.ai/graphql-api/webhooks` describe a
> DEPRECATED v1 webhook.** The live v2 payload is **snake_case** and differs on
> every field. Confirmed from `Fireflies-Webhook/2.0` deliveries.

| v1 — docs, deprecated | v2 — actual                          |
| --------------------- | ------------------------------------ |
| `meetingId`           | `meeting_id`                         |
| `eventType`           | `event`                              |
| `clientReferenceId`   | _does not exist_                     |
| _not mentioned_       | `timestamp` — epoch **milliseconds** |

The handler was originally built against v1 and silently mis-parsed everything:
three stored rows all had a null `external_id` and `processed=false`. The schema
now targets **v2 only** — the v1 shape is deliberately not accepted, so a future
shape change fails loudly instead of looking healthy.

- **Real event value is `meeting.transcribed`** (lowercase, dotted).
- **Idempotency key is the composite `event:meeting_id`**, not `meeting_id` alone.
  One meeting emits several events; keying on the meeting alone makes
  `ON CONFLICT DO NOTHING` swallow the second with no error anywhere. Both halves
  come from the body, so a `raw_event` replay can reconstruct the key — the
  `x-webhook-delivery-id` header cannot.
- **Setup test pings arrive UNSIGNED and are correctly rejected 401. Real events
  ARE signed.** A temporary bypass for the test pings **has been removed — do not
  reintroduce it**; both of its conditions were attacker-controlled on a public
  endpoint.
- **The test `meeting_id` is the constant `test_00000000`**, stored with a null
  `external_id` and short-circuited by the worker. Fetching it would burn 4 calls
  from a 500/day budget.

> ⚠️ **`audio_url` and `video_url` are the ONLY paid-gated fields**, and GraphQL
> fails the **whole operation** for one unauthorised field. Requesting them
> returned "You need to be subscribed to a paid plan" for _every_ fetch, which
> reads exactly like the entire API being unavailable. It is not. With those two
> removed, `sentences`, `speakers`, `summary`, `participants`, `host_email` and
> `transcript_url` all work on the current plan — **including other people's
> meetings within the workspace** (verified on three meetings hosted by another
> user). Both media URLs are excluded from `TRANSCRIPT_FIELDS`; **do not add them
> back** without re-checking the plan.

**Rate limit: 500 requests per DAY**, with no headroom headers. This drives the
error classification:

`classifyTranscriptFetchError()` splits permanent from transient, and a permanent
failure throws `PermanentJobError`, which the worker turns into pg-boss
`deadletter` on the **first** attempt rather than burning the retry ladder.

| Permanent                             | Transient                                    |
| ------------------------------------- | -------------------------------------------- |
| plan / subscription (`paid_required`) | 429 rate limit                               |
| auth failure, 401/403                 | 5xx                                          |
| response shape changed                | network error                                |
| non-429 4xx                           | "not found" **within** 30 min of the webhook |

> ⚠️ **"Transcript not found" is ambiguous and is resolved by AGE, not message.**
> Fireflies can announce a meeting before the transcript is queryable. Inside
> `FIREFLIES_NOT_FOUND_GRACE_MINUTES` (30) it is transient; older, permanent. 30
> minutes clears the ~7-minute retry ladder while making a backfill of old rows
> fail fast instead of burning a per-day budget.

**Retry budget is deliberately different from the global policy:** 3 retries at
60s → ~2m → ~4m (jittered, capped 30m) = at most 4 API calls per meeting. Six
attempts per meeting would let ~80 troubled meetings exhaust a day's quota.

**Port verdict: ✅✅ port the v2 contract, the field-gating discovery, the error
classification and the retry budget.** This connector cost the most to get right
and every lesson is provider-specific knowledge that survives a rewrite. **⚠️ MEASURED:
`parse.fireflies` has 2 failed jobs** — worth inspecting before porting.

### 3.5 ClickUp — read-only and transitional

**Auth:** `Authorization: <CLICKUP_API_TOKEN>` **raw, no `Bearer`**. Personal API
token; no OAuth flow.

**Rate limits:** the only provider that exposes real headroom —
`x-ratelimit-limit` / `-remaining` / `-reset` on every response, 100/min on this
plan. **`-reset` is epoch SECONDS.** `src/features/connectors/rate-limit.ts` logs
headroom per call and warns below 20% or 10 remaining. It deliberately does _not_
try to do the same for Slack: one shared "log remaining quota" helper would
silently log nothing for Slack while looking like it worked.

**Status: transitional and read-only.** Per the 2026-08-04 amendment, ClickUp is
only a source of content-team events. Person→ClickUp-user mapping, list selection
and status taxonomy mapping are deliberately absent and TODO-marked; those TODOs
are **dead**, not a backlog.

ClickUp is the only source that carries the actor email inline
(`history_items[].user.email`), so it resolves automatically with no backfill call.
Its `user.id` is a JSON **number** while `external_id` is text everywhere else.

> ⚠️ **FINDING — a dormant write path exists, contradicting the stated rule.**
> `src/features/connectors/clickup/client.ts` exports **`createTask()`** (POST
> `/list/{id}/task`) and **`updateTaskStatus()`** (PUT `/task/{id}`).
> CLAUDE.md states "no ClickUp write path exists and none is to be built."
>
> **⚠️ MEASURED: the only callers are `client.test.ts`.** No production code path
> reaches either function, so nothing writes to ClickUp today — the rule holds in
> practice. But the capability is present, tested, and one import away from being
> used.
>
> **Do not port these two functions.** Their existence is the strongest argument
> for the rebuild dropping the ClickUp client to genuinely read-only methods.

**Webhook registration is manual (`pnpm clickup:register`) and must never run on
boot: ClickUp does not deduplicate registrations**, so running it twice creates
two webhooks and every event arrives twice.

**Port verdict: 🟡 port the read methods and the rate-limit logic; drop the write
methods.**

### 3.6 UGC and Vision — internal platforms

Both contracts are **owned by the backend engineer**, already live and stable. The
repo conforms to them; `docs/webhook-contract.md` notes an earlier
self-designed spec (`X-CC-Signature`) that was **never adopted and dropped**.

Shared handler factory: `createInternalWebhookHandler(platform)` +
`createInternalWebhookGet(platform)`.

|                       | UGC                         | Vision                             |
| --------------------- | --------------------------- | ---------------------------------- |
| Signature             | `x-luckyfours-signature`    | `x-vision-signature`               |
| Timestamp header      | `x-luckyfours-timestamp` ✅ | _(none)_                           |
| Basestring            | `{ts}.{body}`               | `{body}`                           |
| Replay window         | ±300s                       | ❌ none                            |
| Event-type field      | `type`                      | `event`                            |
| Sender timeout budget | 10s                         | 15s                                |
| Test event            | `test.ping`, id `evt_test`  | `control_center.test`, all-zero id |

Both test events are stored with a **null `external_id`** so repeated setup pings
all land and stay visible, and are logged as `TEST EVENT`.

**Store everything, filter later.** Vision sends an `environment` field
(`production` | `preview` | `development`) and **all of it is stored** —
production filtering happens at query time. **⚠️ MEASURED:** 12 of 428 stored
Vision events carry `environment: 'development'`; the other 416 are
`production`. `src/lib/brief-fold.ts` carries the production filter with
`coalesce(…, 'production')` so an event predating the field is not silently
dropped.

**Port verdict: ✅ port the contracts as documented.** These are internal and the
senders are not changing. The `environment` filter belongs in the new backend
from day one.

### 3.7 Not built — and deliberately so

| Integration                                           | State                                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shopify**                                           | ❌ **No client, and none is to be built.** PRD §5.5/§7 list it, but per the team lead direct Shopify access is out; internal backend endpoints replace it. `SHOPIFY_*` must not reappear in `.env.example` |
| **Internal backend** (`connectors/backend/client.ts`) | Typed stub, **5 methods all throwing `NotImplementedError`**. Point-lookup by design (order by number, inventory by SKU) — orders/inventory are never mirrored locally. Auth scheme unconfirmed            |
| **Studio** (`connectors/studio/client.ts`)            | Typed stub, **3 methods throwing**                                                                                                                                                                         |
| **Notion**                                            | **No client exists.** Pull-only (no webhook API for internal integrations), so it does not fit the `raw_event` pattern. `pnpm verify:notion` is a read-only credential check, not a client                 |

The stubs throw rather than returning plausible data on purpose: a stub that
compiles and is wrong survives review; one that throws cannot be mistaken for a
working integration.

**Notion API knowledge worth keeping** (from a phase-2 read-only Ocean mirror that
was scoped and not built): `Notion-Version` is **mandatory** on every request
(omitting it returns `400 validation_error`, there is no default); access is
**deny-by-default per page** and a `404 object_not_found` almost always means "not
shared", not "wrong ID"; rate limit ≈ **3 req/s**; **every list endpoint is
cursor-paginated** and reading page one silently under-reports; a `people`
property accepts **only Notion workspace members**.

> ⚠️ `ownerIsPushable()` — which existed to catch a non-member owner before a
> write — **has been deleted** along with the push path. A helper encoding a
> superseded decision is worse than no helper.

### 3.8 Env vars

Required to boot: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`DATABASE_URL`.

Integration secrets: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_ID`,
`SLACK_CHANNEL_ID`, `CLICKUP_API_TOKEN`, `CLICKUP_TEAM_ID`,
`CLICKUP_WEBHOOK_SECRET`, `FIREFLIES_API_KEY`, `FIREFLIES_WEBHOOK_SECRET`,
`UGC_WEBHOOK_SECRET`, `VISION_WEBHOOK_SECRET`, `NOTION_API_KEY`,
`NOTION_DATABASE_ID`, `OPENROUTER_API_KEY`, `BACKEND_API_URL`/`_TOKEN`.

> ⚠️ **`KLAVIYO_API_KEY`, `MIRO_ACCESS_TOKEN`, `ZENDESK_API_TOKEN`,
> `ZENDESK_SUBDOMAIN` are reserved in `.env.example` but there is NO integration
> code for any of them.** Grep confirms those names appear only as _tool labels_
> in `role-profile-form.tsx` and `seed.ts`, never as clients. Do not carry them
> into the rebuild's config as though integrations exist.

> ⚠️ **`OPENROUTER_API_KEY` is server-side only.** Never prefix `NEXT_PUBLIC_` —
> that inlines it into the client bundle.

> ⚠️ **Do not use `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `AFTER_SIGN_UP_URL`.**
> Those names do not exist in `@clerk/nextjs` v7 and are silently ignored.

---

## 4. Endpoints

### 4.1 Inbound webhooks — the real backend surface

| Endpoint                       | Methods   | Notes                                             |
| ------------------------------ | --------- | ------------------------------------------------- |
| `POST /api/webhooks/slack`     | POST      | HMAC + replay ±300s; `url_verification` handshake |
| `POST /api/webhooks/clickup`   | POST      | HMAC body-only, no replay protection              |
| `POST /api/webhooks/fireflies` | POST      | HMAC body-only; store-then-best-effort-enqueue    |
| `POST /api/webhooks/ugc`       | POST, GET | HMAC + replay; GET is a reachability probe        |
| `POST /api/webhooks/vision`    | POST, GET | HMAC body-only, no replay; GET probe              |

All are `runtime = 'nodejs'` + `dynamic = 'force-dynamic'` (the HMAC needs
`node:crypto`) and **publicly reachable by design** — `src/proxy.ts` protects
`/dashboard(.*)` only.

**Port verdict: ✅✅ these five are the backend.** Everything else is UI plumbing.

### 4.2 Application endpoints

| Endpoint                                                        | Methods | Verdict                                                                                                                                                            |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/nav-badges`                                           | GET     | 🟡 Sidebar counts; 60s `unstable_cache`. UI concern                                                                                                                |
| `POST /api/extraction/[id]/fetch`                               | POST    | ✅ Triggers a transcript fetch + extraction for one meeting                                                                                                        |
| `GET/POST /api/products`, `/api/products/[id]` (GET/PUT/DELETE) |         | 🔴 **Template leftover, mock data. Drop.**                                                                                                                         |
| `GET/POST /api/users`, `/api/users/[id]` (PUT/DELETE)           |         | 🔴 **Template leftover, mock data. Drop.**                                                                                                                         |
| `GET /api/sentry-check`                                         | GET     | 🔴 **DELETE THIS.** Temporary public throw-route, still deployed. Anyone with the URL can trigger a 500 and consume Sentry quota. Its own header says to remove it |

### 4.3 Server Actions — the primary read path

**The settled pattern is Server Actions + ORM, not route handlers.** Eight
features have `'use server'` service modules importing `@/db` directly:
`tracker`, `extraction`, `people`, `person-profile`, `briefs`, `home`,
`connector-health`, `role-profiles`, `identities`.

Consequences that matter for a rebuild:

- **Every export in a `'use server'` file must be an async function** — that is
  the Server Actions contract, and it is why types live in `./types.ts`.
- **Resource-based auth on EVERY export** (`const { userId } = await auth()`),
  never a reliance on the route matcher. A Server Action is its own reachable
  endpoint.
- `queries.ts` runs on **both** sides of the SSR handoff, which is _why_ the
  indirection exists: the server prefetches through it and the browser re-runs
  the same `queryFn` on invalidation, where Drizzle and `pg` cannot run.

> ⚠️ `src/proxy.ts` uses Clerk's **deprecated** `createRouteMatcher`, which will be
> removed in the next major. Path matching can diverge from how Next.js actually
> routes. **The rebuild should do resource-based checks only.**

**Port verdict: 🔴 do not port the mechanism** — Server Actions are a Next.js
concept. **✅ Port the two invariants:** auth at every entry point, and one
data-access module per feature that is the only thing touching the DB.

---

## 5. The client/server boundary

Not portable to a non-Next backend, but records a genuinely expensive lesson.

**A client component may NEVER import `@/db`.** A client component once imported
a _constant_ from a module that also imported `db`, dragging `pg` into the
browser bundle. The build failed with **seven** Turbopack errors naming `dns`,
`net`, `tls`, `fs` and `util/types` **inside pg internals** — not one of which
mentions the import that caused it. It reads as a broken dependency, so the search
starts in `node_modules` instead of at the boundary.

Two guards covering different halves:

1. **`import 'server-only'`** on shared modules that touch the DB — currently
   `src/lib/brief-fold.ts` and `src/lib/nav-counts.ts`.
2. **`pnpm lint:boundaries`** (`scripts/check-client-boundaries.ts`) scans every
   `'use client'` file for forbidden specifiers. **⚠️ MEASURED: 131 client
   components, clean.**

> ⚠️ **`server-only` CANNOT be applied to `src/db/index.ts`** — it resolves to a
> module that throws under Node's default condition, and 14 tsx scripts plus the
> node-env vitest suites import `@/db` directly. That gap is what
> `lint:boundaries` exists to cover.
>
> ⚠️ **`@/db/schema/*` IS client-safe and must stay allowed.** Schema modules pull
> in `drizzle-orm/pg-core` — a query builder with no driver. A first version of
> the check forbade all of `@/db/*` and flagged two working files. **A gate that
> fails on working code gets switched off**, so the rule is scoped to `@/db`
> exactly and `drizzle-orm/node-postgres`.

**Splitting pattern:** keep the client-safe half in its own file with no DB
import. `src/lib/brief-states.ts` is the client-safe half of `brief-fold.ts`.

**Port verdict: ✅ port the _principle_ of a mechanically enforced boundary,
scoped precisely enough that it never fires on working code.**

---

## 6. Business logic

### 6.1 Normalisation — `src/features/normalise/`

Five per-source mappers (`vision`, `ugc`, `slack`, `clickup`, `fireflies`) behind
one `normaliseRawEvent(rawEventId)` entry point. Each maps a payload to
`{ eventType, occurredAt, subjectType, subjectId, subjectLabel, metadata }` and an
actor to resolve.

- `NORMALISER_VERSION = 1`; bump it when mapping changes, then re-normalise
  `WHERE normaliser_version < n`.
- **Five different wire time formats** collapse in `time.ts`, recording
  `occurred_at_source` when it has to fall back.
- **An unmappable payload leaves `processed = false`** and is _not_ an error — it
  stays visible in the unprocessed queue for replay after the mapping is fixed.
- Subject types observed: `channel` (Slack), `task` (ClickUp), `meeting`
  (Fireflies), `brief`/`moodboard` (Vision).

**Port verdict: ✅✅ port the per-source mappers and the version column.** This is
where provider-shape knowledge lives.

### 6.2 Owner resolution — `src/features/extraction/owner.ts`

Order: **exact → email → fuzzy → unresolved.**

| Confidence                                                        | Auto-linkable                   |
| ----------------------------------------------------------------- | ------------------------------- |
| `exact` — already-linked identity for this display name           | ✅                              |
| `email` — roster email whose local part resembles the spoken name | ✅                              |
| `fuzzy` — a name **suggestion**                                   | ❌ mandatory human confirmation |
| `unresolved` — no confident answer, **including ties**            | ❌                              |

Two tuned constants: `FUZZY_THRESHOLD = 0.72`, `AMBIGUITY_MARGIN = 0.08`.

> ⚠️ **Ambiguity resolves to `unresolved`, NOT to the better score.** Two roster
> names within 0.08 produce no suggestion at all. A reviewer skimming a queue
> tends to accept whatever is pre-filled, so a coin-flip suggestion launders a
> guess into an approval.

> ⚠️ **An email is only trusted when its local part resembles the spoken name**,
> never by position in `participants[]`. Fireflies' `speakers[]` is `{id, name}`
> with no email, and nothing links a speaker to a participant entry.

**⚠️ MEASURED** across the 19 candidates: 9 `unresolved`, 5 `email`, 5 `fuzzy`.
**47% unresolved** — consistent with the deliberate refusal to guess, and a real
indication of how much reviewer work the current design implies.

**Port verdict: ✅✅ port the ordering, both constants, and the tie rule.**

### 6.3 Extraction — `src/features/extraction/`

One path shared by meetings and Slack. Queue `extract.action-items` (not a
`parse.*` queue — it runs after normalisation and belongs to no connector).
Input: a `unified_event` id. Output: `candidate_action_item` rows, all `pending`.

Flow: load transcript → build prompt → call LLM → strip fences → Zod-validate →
resolve owners → upsert on `content_hash`.

- **Extraction runs per MEETING, and Slack batches per THREAD**, never per
  message. Cost and quality both scale with the unit: `"I'll take that one"` is
  unresolvable alone and obvious in a thread.
- **`MAX_TRANSCRIPT_CHARS = 400_000` refuses rather than truncates.** A real
  57-minute meeting is ~8,200 tokens against a 200k context, so **chunking is
  deliberately not implemented** — it would be dead code guarding a case that does
  not occur. Silently truncating would drop items from the end of a meeting with
  no indication.
- **`extractFromTranscript()` is a separate function because it is the seam the
  eval harness uses.** An eval that builds its own prompt measures a pipeline that
  does not exist and would go on reporting a good score after a real regression.

> ⚠️ **A second extraction path is a design failure, not a shortcut.** Two paths
> means two prompts to keep in sync, two incomparable sets of scores, two
> idempotency stories, and a review queue whose rows mean different things
> depending on origin — while the eval measures only one of them.

**Port verdict: ✅✅ port the single-path rule, the per-meeting/per-thread unit, the
refuse-don't-truncate guard, and the eval seam.**

### 6.4 LLM access — `src/lib/ai/`

**Every call goes through `complete()` in `client.ts`. No inline `fetch`,
anywhere.** The vendor is named in exactly **one** file, `provider.ts`, which owns
the base URL, slugs, pricing table and `PROVIDER_NAME`. Callers ask for a **tier**
(`fast` | `default` | `heavy`), never a slug.

| Tier      | Slug                         | $/M in | $/M out |
| --------- | ---------------------------- | ------ | ------- |
| `fast`    | `anthropic/claude-haiku-4.5` | 1.00   | 5.00    |
| `default` | `anthropic/claude-sonnet-5`  | 2.00   | 10.00   |
| `heavy`   | `anthropic/claude-opus-5`    | 5.00   | 25.00   |

`provider.ts` documents the swap to a direct Anthropic key as a three-step edit to
that one file. `createProviderClient()` is a **function, not a constant** — a
constant is evaluated at import time, which during `next build` means no env vars.

**Slugs are PINNED, never a floating alias.** A moved alias changes prompt
behaviour with no code change, on a deploy nobody made; git blame shows nothing
and the regression looks like data drift.

**`temperature: 0` on every call — and that is NOT determinism.**

> ⚠️ **MEASURED and uncomfortable:** temperature 0 is necessary but not
> sufficient. The parameter _is_ honoured (the distribution collapses), it is not
> greedy, OpenRouter is not routing between backends (4 identical calls all served
> by Amazon Bedrock, output still differed), and `seed` does nothing (Anthropic
> models have no seed parameter). **The variance is in the serving stack. There is
> no configuration that fixes this — stop looking for one.**
>
> Stable across runs: item count, `owner_name`, `due_date` (except genuinely
> ambiguous ones). **Unstable: `description` (reworded every run), `confidence`
> (0.70/0.55/0.65 for the same item), `source_span` (same line, but the quoted
> window widens or narrows), `follow_ups`.**
>
> **The design rule that follows: never key anything on model wording.** The eval
> harness is already safe (anchors on the `source_span` line). **`content_hash` is
> not** — see §2.3.

**JSON mode is NOT reliable through OpenRouter.** Do not pass `response_format`:
support varies by model _and_ by which upstream provider the request is routed to,
and the flag is accepted and silently ignored on some routes. Instead: ask for
bare JSON in the prompt, **strip fences defensively anyway**, and let **Zod be the
actual guarantee** — a malformed response throws.

**Port verdict: ✅✅ port the tier abstraction, the one-file vendor confinement, the
pinned slugs, and every temperature/JSON-mode finding.** These are the most
transferable lessons in the repo and each one cost real measurement.

### 6.5 AI summaries — the two-gate cache

`ai_summary` is a **cache**, one row per person, upserted, no history.

| Condition                      | Action                                    |
| ------------------------------ | ----------------------------------------- |
| `input_hash` unchanged         | serve cache, **whatever its age**         |
| hash changed, younger than TTL | serve cache — the rate cap wins           |
| hash changed, at or past TTL   | regenerate                                |
| manual regenerate              | bypass both, **but still write the hash** |

**Both gates are load-bearing and do different jobs.** The TTL (1 hour)
_guarantees_ at most one call per subject per hour — without it a refresh loop is
a billing incident. The `input_hash` stops a _pointless_ call when the hour lapses
and nothing moved, which on a seven-person roster is the common case. A manual
regenerate that skipped writing the hash would leave the next automatic check
comparing against a stale fingerprint and regenerate immediately.

Hash only fields a summary could legitimately change on — **not `updated_at`**.

Three more rules:

- **Failure never takes the page down.** `getOrCreateSummary()` does not throw; it
  returns `unavailable`, and prefers a **stale cached summary** over nothing.
- **⚠️ The zero-data guard is in CODE, not only the prompt.** When
  `item_count + event_count === 0` the model is **not called at all**. A "write a
  summary" instruction against empty lists is an invitation to invent one, and a
  fabricated summary about a real colleague is the worst output this feature can
  produce. Prompt rules are a request; code is a guarantee.
- **Trust our counts, not the model's.** The schema asks for `generated_from`
  counts so the model has to look at the lists, but the **persisted** values are
  ours — a model that miscounts must not make the footer lie.
- **Prompt rules:** describe **work, never the worker**; never advise. Send only
  that subject's own data.

**Port verdict: ✅✅ port the two-gate cache, the zero-data code guard, and the
prompt constraints.** Directly reusable.

### 6.6 Promotion — `constants/promotion.ts` + `approveCandidate()`

Approval and promotion happen in **one transaction**: the two writes are a single
fact ("a human accepted this, and here is the work it became"). Split apart, a
crash leaves either an approved candidate that produced nothing — invisible, and
the reviewer believes it is done — or an orphan tracked item whose candidate waits
to be approved again.

- **`SELECT … FOR UPDATE`** turns a double-click into a clean "already decided"
  rather than a constraint violation the UI has to interpret.
- **Everything lands in a project called `Inbox`, and that is the point.** The
  alternative — mapping `fireflies → 'Command Center'` — would file a content-ops
  meeting's items under an engineering project with nobody able to tell the filing
  was arbitrary. **A visible triage bucket beats invisible mis-filing.**
- **A promoted item MUST get a project**, because the board is project-scoped: a
  null `project_id` means approved, stored, and impossible to find.
- The candidate keeps the **model's** values; corrections go on the tracked item
  and `edited_fields` names what changed.

**Port verdict: ✅✅ port the transaction boundary, the lock, and the Inbox rule.**

### 6.7 Brief state folding — `src/lib/brief-fold.ts`

**Vision has no status field.** Brief state is **derived by folding events**, and
nothing stores the result: a stored state is a second source of truth that can
disagree with the log it came from, and the only way to check would be
re-deriving it — which is the function.

Lives in `src/lib` rather than a feature folder because two features need it
(briefs board + overview), and one feature calling another's service is forbidden.

> ⚠️ **THE PRODUCTION FILTER — every brief query must use it.** 12 of 186 Vision
> events are `development`. `control_center.test` is excluded by requiring
> `subject_type = 'brief'`. `coalesce(…, 'production')` treats a missing
> environment as production so events predating the field are not dropped.
>
> ⚠️ Every column is qualified `ue.` — unqualified `source = 'vision'` read fine
> in isolation and threw `column reference "source" is ambiguous` as soon as a
> join was added.

**Port verdict: ✅✅ port the derive-don't-store decision and the production
filter.** The event-fold approach is the right call and the reasoning is sound.

### 6.8 Rendering rules that are actually data-contract rules

Included because they bit hard and the cause is invisible from the symptom.

**Never pass `undefined` as the locale to `toLocale*`, and pin the timezone.**
`undefined` resolves to the _host's_ locale — Node's during SSR, the browser's
during hydration. The same timestamp rendered `31 Jul 2026, 20:55` server-side and
`Jul 31, 2026, 08:55 PM` client-side; React declared a hydration mismatch and
**discarded the whole subtree**. The symptom was a data table showing its toolbar
and its "5 row(s) total" footer with **no rows** — which reads exactly like a
failed fetch, and sent the investigation into the query layer, the API client and
the error handling before the real cause surfaced. **The data had been correct the
entire time.**

`Date.now()` in a render is the same class of bug: server and browser clocks are
never the same instant, so a relative timestamp mismatches by construction.

`src/lib/format-date.ts` is the one implementation. **`formatDueDate` takes `now`
as a parameter** for exactly this reason — resolve it once above the tree.

**Port verdict: ✅ if the rebuild serves rendered output, this is a real
constraint.** If it becomes a pure JSON API, it dissolves — **return ISO-8601 UTC
and let the client format.** That is arguably the cleaner outcome and worth
choosing deliberately.

---

## 7. Testing

**⚠️ MEASURED:** 30 test files, 452 tests. `pnpm test` → **383 passed, 69 skipped,
~3s.**

`vitest.config.ts` sets `env: {}` deliberately so the suite does **not** load
`.env.local`. Nine files are DB-gated and become `describe.skip` without a
connection string — a bare `pnpm test` exits 0 while every test touching
Postgres, pg-boss, identity resolution and extraction runs nothing. Use
`pnpm test:db` / `pnpm test:queue`.

Strongest coverage — **port these tests, not just the code**:

- **Signature verification per connector**, each with a test proving a
  re-serialised body fails.
- **Idempotency and transactional rollback** (`ingest.test.ts`,
  `ingest-rollback.test.ts`) against a real Postgres and real pg-boss, because the
  properties under test belong to Postgres, not to us.
- **Per-job batch isolation** — `batchSize: 2` means `work()` receives an array
  and by default one throw fails the whole batch; `perJobResults: true` plus a
  per-job try/catch keeps a poison event from taking its neighbour down.
- **Owner resolution**, including the ambiguity-means-unresolved case.
- **`temperature: 0` is the default** — asserted.

### The eval harness — and its honest limits

`pnpm eval:extraction` scores owner accuracy, recall, precision and hallucination
against hand-labelled fixtures, exits non-zero below threshold, ~$0.04/run.
It anchors on `source_span` and tolerates description drift, so the **score is
stable run to run even though the model output is not**.

> ⚠️ **The synthetic fixtures test the HARNESS, not real-world accuracy.** They
> were authored knowing what the prompt says, they are far cleaner than real
> Fireflies output (no crosstalk, no ASR errors, correct speaker attribution), and
> **n = 3**. `fixtures/extraction-eval/real/` is **empty** and real accuracy is
> **unmeasured**. **Never report a synthetic score as a real one.**
>
> ⚠️ **Measured weakness:** deleting rule 1 from the prompt, inverting it, and
> removing the entire `Do NOT extract:` block each changed the score by
> **nothing**. Forcing a wrong `owner_name` or a fabricated `source_span` _does_
> fail the gate — so the harness works, but **a green run means "the pipeline is
> intact", not "the prompt is good".**
>
> ⚠️ Stability was measured at a **100% ceiling**, where variance is least visible.
> Do not assume a mid-range score is equally stable: run the eval twice on an
> unchanged prompt before believing a two-point move.

**Port verdict: ✅✅ port the harness design and the `source_span` anchoring.**
⚠️ **And fix the root cause: get real transcripts into `real/`.** Real accuracy has
never been measured. The reason is documented — a dedicated test account has no
meeting history, and Fireflies returns a paid-plan error for transcripts the token
holder does not own — but there are now **6 real transcripts in the database**, so
the raw material for a real eval set exists (scrubbing required).

---

## 8. Port priority

### ✅✅ Port — high value, framework-independent

1. **`verify-hmac.ts` + the five-scheme table.** Highest value per line.
2. **The webhook handler pattern** — verify → persist verbatim → enqueue in the
   same transaction → 2xx. Plus the partial-unique-index idempotency.
3. **`raw_event` → `unified_event`** two-table split, upsert key,
   `normaliser_version`, `occurred_at_source`.
4. **Identity resolution** — `(source, external_id)` pairing, exact→email→
   unresolved, no name tier, COALESCE-on-upsert, provenance CHECK.
5. **Owner resolution** — the four tiers, `0.72`/`0.08`, ambiguity → unresolved.
6. **Extraction contract** — one path, mandatory `source_span`, immutable
   candidates, `edited_fields` as the precision metric.
7. **LLM access** — tier abstraction, one-file vendor confinement, pinned slugs,
   and every temperature/JSON-mode finding.
8. **The two-gate AI-summary cache** + the zero-data code guard.
9. **Fireflies v2 contract**, field-gating discovery, permanent/transient
   classification, per-day-budget retry ladder.
10. **The eval harness design** and `source_span` anchoring.
11. **Promotion transaction** — one transaction, `FOR UPDATE`, the Inbox rule.
12. **Brief state folding** — derive, don't store; the production filter.

### 🟡 Rebuild — the idea is right, this implementation is not

- **`role_profile`, `recurring_task`** — three untyped JSONB columns; shape unsettled.
- **`content_hash` idempotency** — port the intent, fix it to span _overlap_.
- **ClickUp client** — keep read methods and the rate-limit logging, **drop
  `createTask`/`updateTaskStatus`**.
- **Queue** — the registry _seam_ is good; pg-boss-in-app-Postgres and in-process
  workers are a small-team compromise worth revisiting.
- **Migrations** — manual-from-a-laptop was a deliberate one-week single-developer
  choice, and its stated tradeoff (schema/code drift) applies from the second
  developer onward.

### 🔴 Drop

- `products` / `users` features and their four route handlers — template mock data.
- **`/api/sentry-check`** — public throw-route, still deployed.
- `person.slack_id` / `clickup_id` / `portal_id` — deprecated, NULL everywhere.
- **`completion_event`** — 0 rows, no writer, feature unbuilt.
- **`src/config/env.ts` / `TASK_SOURCE_OF_RECORD`** — see §9.
- `KLAVIYO_*`, `MIRO_*`, `ZENDESK_*` env vars — no code exists.
- ClickUp write methods; any notion of an outbound task sync.

---

## 9. Discrepancies found during this audit

Five places where documented intent and actual code have drifted. None is
breaking today; all are worth resolving deliberately rather than porting.

1. **`TASK_SOURCE_OF_RECORD` is dead config, and its default contradicts the
   architecture.** `src/config/env.ts` exposes `taskSourceOfRecord()`,
   `isClickUpSourceOfRecord()` and `isInternalSourceOfRecord()`, defaulting to
   **`'clickup'`**. **⚠️ MEASURED: grep finds zero consumers outside the file
   itself and its own test.** The 2026-08-04 amendment made the Command Centre the
   task system of record, so the default now asserts the opposite of the decision
   while influencing nothing. CLAUDE.md's instruction to "read it only via
   `src/config/env.ts`" is moot. **Delete the module, or reduce it to what is
   actually read.**

2. **A dormant ClickUp write path exists.** `createTask()` and
   `updateTaskStatus()` are implemented and tested, while CLAUDE.md states "no
   ClickUp write path exists and none is to be built." No production caller
   reaches them, so the rule holds in practice — but the capability is one import
   from being used. See §3.5.

3. **`candidate_action_item`'s header comment is superseded.** It states "⚠️ THE
   DESTINATION IS NOTION (Ocean)" and "nothing reaches Notion before that". The
   2026-08-04 amendment made the Command Centre the system of record with no
   external task tool written to. The _code_ is correct — `approveCandidate()`
   writes `source_system='internal'` with a null `external_task_id` — only the
   comment is stale.

4. **`tracked_item.ts` carries pre-amendment reasoning too**, describing ClickUp
   as system of record per PRD §3.2 and Notion as "the now-mandated task
   destination". Same situation: constraints are right, prose is stale.

5. **Three known locale/`Date.now()` violations remain unfixed** (listed in
   CLAUDE.md with a checklist). All three sit in `'use client'` components, which
   are still server-rendered on first paint. The `Date.now()` one in
   `identity-tables/columns.tsx` mismatches **by construction**. If the rebuild
   returns ISO-8601 UTC from a JSON API, this class of bug disappears — see §6.8.

**Also worth knowing:** `pnpm lint:fix` is broken — the script body is
`oxlint --fix && bun format`, and bun is not installed. And `docs/prd.md` is still
absent, so `docs/prd-amendments.md` is the authoritative record of product
decisions.

---

## 10. Immediate actions before the rebuild starts

1. **Export `raw_event` (578 rows) and `transcript` (6 rows).** Irreplaceable; the
   senders will never redeliver. Treat the export as a PII artifact — not in this
   repo, not in a fixture, not in a public bucket.
2. **Record the 4 human-confirmed `person_identity` links and the 1 approved
   candidate + its promoted `tracked_item`.** The only human decisions in the
   system.
3. **Decide the identity story for email-less sources.** 0% attribution on UGC
   (128 events) and Fireflies (10) is the largest functional gap.
4. **Delete `/api/sentry-check`** — public throw-route, currently deployed.
5. **Inspect the 2 failed `parse.fireflies` jobs, the 1 failed
   `extract.action-items` job, and the 3 unconsumed dead-letter jobs** before the
   queue is discarded; they are the only evidence of what breaks in production.
6. **Scrub 2–3 real transcripts into `fixtures/extraction-eval/real/`** while the
   database still holds them. Real extraction accuracy has never been measured,
   and the rebuild will want a baseline it can compare against.

7. **Delete `/api/sentry-check`** — public throw-route, currently deployed.
   **STATUS 2026-08-05: deleted locally, NOT yet pushed/deployed — local deletion
   protects nothing in production; the route is still live and publicly
   reachable on Railway until this deploys. Push this deletion at the next
   deploy, or sooner.**

8. **Export `raw_event` and `transcript`** — ✅ DONE 2026-08-05 (584 + 6 rows,
   custom-format dump, stored outside the repo as a PII artifact).
9. **Record the human decisions** — ✅ DONE 2026-08-05 (4 identity links,
   1 approved candidate, 1 promoted item, CSVs alongside the dump).
