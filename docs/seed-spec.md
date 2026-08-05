# Seed Spec — Demo Data for the Frontend Build

**Purpose.** Extend `src/db/seed.ts` so every buildable screen renders realistic
numbers matching the mockup, with the Control Tower provably showing one `bad`,
one `needs_attention`, and two `good` departments under health rule A.

**Health rule A (working decision 2026-08-06, team-lead confirmation pending):**
- `bad` = any open item overdue **> 3 days** OR **≥ 2 blocked** items
- `needs_attention` = any overdue / blocked / at-risk item
- `good` = otherwise
- Implemented as `computeDeptHealth(items) → { status, reasons[] }`; thresholds
  as named constants (`OVERDUE_BAD_DAYS = 3`, `BLOCKED_BAD_COUNT = 2`) so a
  team-lead tweak is a one-line change.

---

## 1. Hard rules (do not violate)

1. **Never seed:** `raw_event`, `unified_event`, `transcript`,
   `candidate_action_item`, `person_identity`, `completion_event`. The first
   three are the verbatim/derived record of real deliveries; the Capture queue
   already has **real** pending candidates (19 rows) — use them, seed nothing.
2. **Idempotent, same as the existing seed:** stable natural keys (title/name),
   upsert-or-update, row counts unchanged on re-run. Follow the three existing
   strategies in `seed.ts` (fixed-id upsert / functional-index lookup / keyed
   update).
3. **All dates RELATIVE to `now()`**, never hardcoded — `daysAgo(5)`,
   `daysFromNow(2)` helpers — so health states still fire whenever the seed
   runs.
4. **Demo rows are identifiable and bulk-deletable:** demo people get
   `email` ending `@demo.local` (never a real domain; also keeps them out of
   real identity resolution, which matches on email). Demo tracked items are
   whatever the seed's title list contains — the list IS the deletion manifest.
5. **Do not add columns.** Seed only what exists post-Phase-0. `project.due`
   and `progress` don't exist yet (audit §1.4) — do not fake them here.

---

## 2. Departments → target health states

| Department | dept_type | Target state | Trigger (rule A) |
|---|---|---|---|
| Creative | creative | 🔴 **bad** | 1 item overdue 5 days AND 2 blocked items (both triggers — robust to threshold tweaks) |
| CX / Support | cx | 🟠 **needs_attention** | 1 blocked item + 1 item overdue 1 day (≤ 3d, so not bad) + 1 at-risk |
| Engineering | engineering | 🟢 **good** | active items, all due in the future, none troubled |
| Operations | ops | 🟢 **good** | few items, none troubled |

## 3. People

**Existing 7** keep their Phase-0 role/department assignments — do not touch.

**Add demo people** (judgment call 5 — unstaffed roles + team tables need rows):

| Name | Role | Department | Why |
|---|---|---|---|
| Demo Support Manager | support_manager | CX / Support | someone to sign in as for §2.11 My team |
| Demo Agent One | cx_agent | CX / Support | My team member list needs ≥ 2 agents |
| Demo Agent Two | cx_agent | CX / Support | " |
| Demo Editor | creative | Creative | owns part of the Creative backlog |

Skip an `agency` person — Agency reporting is deferred (audit Phase 5) and
agencies aren't roster people anyway.

**⚠ One real person to verify, not seed:** for My day / My projects to show
anything, the *signed-in developer's* Clerk email must match a `person` row
(that's how D3 links). If your email isn't in the roster, add yourself as a
real person (role: coder, dept: Engineering) via `pnpm people:email` /
the roster — not as a demo row.

## 4. Tracked items (~22 new, all `source_system='internal'`, `source_type='manual'`)

Owners spread so Person profile, My team, and My day all populate.

### Creative — forces 🔴 bad
| Title | Owner | Status | Due | risk_flag |
|---|---|---|---|---|
| Q3 hero video brief revision | Hashim* | open | **daysAgo(5)** | — |
| Santos UGC batch 2 concepts | Demo Editor | **blocked** | daysFromNow(3) | — |
| Bron unboxing script rewrite | Demo Editor | **blocked** | daysFromNow(5) | — |
| August content calendar | Hashim* | in_progress | daysFromNow(7) | — |
| Brief template refresh | Hashim* | open | daysFromNow(10) | — |

### CX / Support — forces 🟠 needs_attention
| Title | Owner | Status | Due | risk_flag |
|---|---|---|---|---|
| Macro routing rules update | Demo Support Manager | **blocked** | daysFromNow(4) | — |
| Returns FAQ rewrite | Demo Agent One | open | **daysAgo(1)** | — |
| Escalation playbook v2 | Demo Agent Two | in_progress | daysFromNow(6) | **true** |
| Weekly CSAT digest setup | Demo Support Manager | open | daysFromNow(9) | — |
| Holiday coverage plan | Demo Agent One | open | daysFromNow(14) | — |

### Engineering — forces 🟢 good
| Title | Owner | Status | Due |
|---|---|---|---|
| Webhook retry dashboard | Usama* | in_progress | daysFromNow(5) |
| Identity backfill script | Usama* | open | daysFromNow(8) |
| Tracker board keyboard nav | (you) | in_progress | daysFromNow(4) |
| Seed idempotency test | (you) | open | **daysFromNow(0)** — due today, for My day |
| Rate-limit alerting | Usama* | done | daysAgo(2) |

### Operations — forces 🟢 good
| Title | Owner | Status | Due |
|---|---|---|---|
| Vendor contract review | Ardin* | in_progress | daysFromNow(12) |
| Hiring pipeline sync | Ardin* | open | daysFromNow(6) |
| Q3 tooling audit | Damian* | open | daysFromNow(20) |

\* Use whatever the actual seeded roster names are — match by the seed's
existing person keys, don't invent spellings.

**Project assignment:** distribute across the 4 existing projects
(`Command Center`, `Content Operations`, `Studio / UGC Platform`, `Inbox`) by
theme; every item MUST have a project (a null `project_id` is invisible on the
board — promotion-rule invariant).

## 5. Recurring tasks (Automations screen)

5 rows already exist. Align their names/cadences with the mockup's Automations
table rows (read the `data-screen-label="Automations"` section for the labels);
update in place by title key, don't add more. `fired` counts stay absent —
that's the unbuilt engine, mocked at the service layer.

## 6. What stays MOCKED in service.ts (not seeded — no tables)

Weekly quota history + 6-week charts · agent performance (Zendesk) · Founder
offload rows · Agency reporting · AI search answers · auto-completion ledger ·
copilot Q&A · org-chart recruiting panel.

## 7. Acceptance checks

```sql
-- Health inputs land as designed (run after seeding):
SELECT d.name,
  count(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.due_date < now() - interval '3 days') AS overdue_gt3,
  count(*) FILTER (WHERE t.status = 'blocked') AS blocked,
  count(*) FILTER (WHERE t.risk_flag) AS at_risk
FROM tracked_item t
JOIN person p ON p.id = t.owner_person_id
JOIN department d ON d.id = p.department_id
GROUP BY d.name ORDER BY d.name;
```
Expected: Creative (1, 2, 0) → bad · CX (0, 1, 1) → needs_attention ·
Engineering (0, 0, 0) → good · Operations (0, 0, 0) → good.

- Re-run `pnpm db:seed` twice → identical counts (idempotency).
- `person` count = 7 real + 4 demo + you = 12.
- My day for your login shows: 1 due-today item, tracker board shows all
  ~22 items across 4 projects, Capture queue shows the real pending candidates
  untouched.
