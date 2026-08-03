# PRD Amendments

**This file amends the PRD. If `docs/prd.md` is absent, this file is the
authoritative record of superseded decisions; commit the PRD alongside it when
repository privacy is confirmed.**

Amendments are listed newest first. Each names the PRD sections it supersedes,
so a later reader of the PRD can tell which of its statements no longer hold.

> ⚠️ **Why this file exists separately.** `docs/prd.md` is not in the repository.
> Without a written amendment record, decisions that override the PRD live only
> in chat history and in prose scattered through `CLAUDE.md` — and the sections
> being superseded sit in a document nobody can open to annotate. Anyone who
> later commits the PRD needs to know, before they read §3.2, that §3.2 is dead.
>
> Deliberately free of individual names so it is safe to commit regardless of
> repository visibility.

---

## 2026-08-04 — Task System of Record

**Supersedes:**

| Section | Superseded statement |
| --- | --- |
| **§3.2** | ClickUp is authoritative for tasks / system of record |
| **§5.1** | Meeting action items sync into ClickUp |
| **§5.8** | *(partially)* Notion's role — it is not the task destination; it remains the company AI-search source |

Also supersedes the intermediate Week 2 position that **Notion (Ocean) is the
task destination**. That position was never built: no Notion write path, client,
or sync ever existed.

### The decision

1. **The Command Centre is the task system of record.** Approved action items
   become native `tracked_item` rows, surfaced on the in-platform tracker board
   at `/dashboard/tracker`.
2. **Slack is the notification and update surface** — where people are told
   something changed, never where the task itself lives.
3. **No external task tool is written to.**
4. **ClickUp:** read-only, transitional, unchanged. A source of content-team
   events only.
5. **Notion:** not integrated for tasks. A read-only mirror into Ocean is an
   explicitly possible phase-2 add-on; the schema already supports it via
   `source_system` plus the external reference columns.

### Rationale

Monday-model product direction raised by leadership. Eliminates two-way-sync
loop risk, external rate limits, and member-mapping work ahead of the
**Aug 13** delivery. Makes the Command Centre the single source of truth
**structurally rather than by convention**.

### What changed in the codebase

- `tracked_item.source_system` accepts `internal` / `notion` / `clickup`;
  promoted items are `internal` with `external_task_id` NULL, enforced by
  `tracked_item_external_ref_ck`.
- The external reference columns are **INBOUND only** — they mean "this row
  mirrors an external system", never "this row was pushed out".
- `ownerIsPushable()` was deleted. It existed solely to pre-check Notion
  workspace membership before a write that no longer happens.
- No connector, client, or job writes to any external task system.

**Engineering detail lives in `CLAUDE.md`** under *Task system of record: THE
COMMAND CENTRE*, *Where a destination is recorded — `external_task_id`
semantics*, and *Phase 2: read-only Notion mirror (NOT BUILT)*.
