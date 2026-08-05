/**
 * Seed script — `pnpm db:seed`
 *
 * IDEMPOTENT. Safe to re-run: every write is a lookup on a natural identifier
 * followed by an insert or update, never a blind insert. Re-running updates
 * existing rows in place and leaves row counts unchanged.
 *
 * `role_profile` and `person` have no UNIQUE constraint on their natural key
 * (name), so `onConflictDoUpdate` is not available for them — hence the explicit
 * lookup. If a UNIQUE index is added to `role_profile.name` later, those can be
 * simplified to real upserts.
 *
 * Scope: role, department, role_profile, person, recurring_task.
 *   - `role` is a REAL upsert: its ids are EXPLICIT and fixed, so
 *     `onConflictDoUpdate` targets the primary key directly. Fixed ids are what
 *     keep a role id meaning the same thing in dev, staging and production.
 *   - `department` HAS a unique key (`department_name_lower_idx`) but it is a
 *     FUNCTIONAL index on `lower(name)`, which Drizzle cannot name as a conflict
 *     target without raw SQL — so it keeps the explicit-lookup shape.
 *   - tracked_item and project ARE seeded, via ./seed-tracker. This changed
 *     when the tracker board shipped: the board must render populated on first
 *     demo. Rows are source_system='internal' with a NULL external_task_id, so
 *     nothing references a task that does not exist — the original objection
 *     (an invented clickup_task_id that 404s) still stands and is respected.
 *   - completion_event and raw_event are left empty; they are produced by
 *     ingestion, not by seeding.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from './index';
import {
  department,
  person,
  project,
  recurringTask,
  role,
  roleProfile,
  ROLE_CODES,
  ROLE_DISPLAY_NAMES,
  ROLE_IDS,
  trackedItem,
  type DeptType,
  type RoleCode
} from './schema';
import type { TrackedItemStatus } from './schema/tracked-item';
import { seedTracker } from './seed-tracker';

// ── Departments ──────────────────────────────────────────────────────────────
// Four, matching the dept_type CHECK. Names are display strings and are keyed
// case-insensitively by the seed, so renaming one here creates a new department
// rather than renaming the existing row — rename in the database instead.

const DEPARTMENTS: { name: string; deptType: DeptType }[] = [
  { name: 'Creative', deptType: 'creative' },
  // ⚠️ 'CX / Support', not 'CX' — the name the seed spec and the mockup's own
  // "My team — CX / Support" header use. Renamed while migration 0011 was still
  // unapplied, so no row existed to orphan; renaming it LATER would create a
  // second department (the unique key is on lower(name)) and silently strand
  // everyone assigned to the old one.
  { name: 'CX / Support', deptType: 'cx' },
  { name: 'Operations', deptType: 'ops' },
  { name: 'Engineering', deptType: 'engineering' }
];

// ── Role profiles (PRD §5.3) ─────────────────────────────────────────────────
// quota_config is left {} wherever the PRD states "vs quota" without giving a
// number. Inventing a quota here would silently drive a monitor off fabricated
// data — better to leave it empty and fail loudly when a real number is needed.

const ROLE_PROFILES = [
  {
    name: 'CX agent',
    trackedSignals: ['ticket_volume', 'comments', 'resolutions'],
    quotaConfig: {},
    sourceChannels: ['zendesk']
  },
  {
    name: 'Ops / leadership',
    trackedSignals: [
      'action_items',
      'recurring_daily_operational_tasks',
      'delivery_volume',
      'delivery_cadence'
    ],
    quotaConfig: {},
    sourceChannels: ['slack', 'clickup']
  },
  {
    name: 'Creative strategist',
    trackedSignals: ['briefs_submitted_per_week'],
    quotaConfig: {}, // PRD: "vs quota" — number TBD
    sourceChannels: ['brief_tracker']
  },
  {
    name: 'Video editor',
    trackedSignals: ['edits_submitted', 'videos_submitted'],
    quotaConfig: {}, // PRD: "vs quota" — number TBD
    sourceChannels: ['brief_tracker']
  },
  {
    name: 'Engineer',
    trackedSignals: [
      'assigned_projects',
      'assigned_tasks',
      'timelines',
      'progress',
      'work_in_flight'
    ],
    quotaConfig: {},
    sourceChannels: ['clickup', 'slack']
  },
  {
    name: 'Agency',
    trackedSignals: ['slack_updates', 'klaviyo_metrics'],
    quotaConfig: {},
    sourceChannels: ['slack', 'klaviyo']
  },
  {
    // Seventh profile — not in PRD §5.3. A founder is the consumer of these
    // signals rather than the subject of them, so measuring personal throughput
    // (as "Ops / leadership" does) would be the wrong model.
    name: 'Founder / Leadership',
    trackedSignals: ['escalations', 'at_risk_items', 'weekly_digest'],
    quotaConfig: {},
    sourceChannels: ['slack']
  }
] as const;

// ── Team roster (PRD §4) ─────────────────────────────────────────────────────
// External ids seed as NULL, not placeholders: the columns are nullable by
// design, `WHERE slack_id IS NULL` answers "who still needs mapping?", and a
// placeholder string is truthy — any `if (person.slackId)` would treat it as
// real and hand it to the Slack API.

// ⚠️ `roleProfileName` and `roleCode` are DIFFERENT AXES and are both listed on
// purpose — work config vs access. See the header on src/db/schema/role.ts. They
// correlate here only because a seven-person company has no reason for them to
// diverge yet; they are not derived from each other.
//
// ⚠️ NOBODY holds 'support_manager' or 'agency'. Both roles exist in `role`
// because the frontend contract's access matrix needs all seven, but the PRD §4
// roster contains no such person — inventing one would put a fictional colleague
// on the People screen and in every per-person metric. Assign them when a real
// support manager or agency contact is onboarded.

const PEOPLE: {
  name: string;
  roleProfileName: string;
  roleCode: RoleCode;
  departmentName: string;
}[] = [
  // Leadership sits with Operations: `dept_type` has no 'leadership' value, and
  // adding one would create a department of one that no mockup panel renders.
  {
    name: 'Damian',
    roleProfileName: 'Founder / Leadership',
    roleCode: 'founder',
    departmentName: 'Operations'
  },
  {
    name: 'Ardin',
    roleProfileName: 'Ops / leadership',
    roleCode: 'ops_lead',
    departmentName: 'Operations'
  },
  {
    name: 'Ronalyn',
    roleProfileName: 'CX agent',
    roleCode: 'cx_agent',
    departmentName: 'CX / Support'
  },
  {
    name: 'Diane',
    roleProfileName: 'CX agent',
    roleCode: 'cx_agent',
    departmentName: 'CX / Support'
  },
  {
    name: 'Hashim',
    roleProfileName: 'Creative strategist',
    roleCode: 'creative',
    departmentName: 'Creative'
  },
  { name: 'Usama', roleProfileName: 'Engineer', roleCode: 'coder', departmentName: 'Engineering' },
  // Not in PRD §4, which predates the engineer joining. Added so events from
  // this person resolve to somebody instead of sitting in the unresolved queue.
  { name: 'Sami', roleProfileName: 'Engineer', roleCode: 'coder', departmentName: 'Engineering' }
];

// ── Demo people ──────────────────────────────────────────────────────────────
//
// ⚠️ EVERY EMAIL ENDS `@demo.local`, and that is load-bearing rather than tidy.
// Email is the ONLY automatic cross-system join key, so a demo person carrying a
// plausible real address would start absorbing real Slack/ClickUp/UGC identities
// during resolution and quietly attribute a colleague's work to a fake row.
// `.local` is reserved by RFC 6762 and can never be a real mail domain.
//
// It is also the deletion manifest: `DELETE FROM person WHERE email LIKE
// '%@demo.local'` removes exactly these and nothing else.
//
// ⚠️ These four exist because the roles they hold are UNSTAFFED on the real
// roster and the team screens need rows. They are NOT a substitute for the real
// roster — see the note on Sami/'(you)' at DEPT_DEMO_ITEMS.

const DEMO_EMAIL_DOMAIN = '@demo.local';

const DEMO_PEOPLE: {
  name: string;
  roleProfileName: string;
  roleCode: RoleCode;
  departmentName: string;
}[] = [
  // Somebody to sign in as for §2.11 My team. PRD groups a support manager under
  // Ops/leadership for signals, which is why the work config and the access role
  // disagree here — the two axes are genuinely independent.
  {
    name: 'Demo Support Manager',
    roleProfileName: 'Ops / leadership',
    roleCode: 'support_manager',
    departmentName: 'CX / Support'
  },
  // My team's member list needs at least two agents to look like a team.
  {
    name: 'Demo Agent One',
    roleProfileName: 'CX agent',
    roleCode: 'cx_agent',
    departmentName: 'CX / Support'
  },
  {
    name: 'Demo Agent Two',
    roleProfileName: 'CX agent',
    roleCode: 'cx_agent',
    departmentName: 'CX / Support'
  },
  {
    name: 'Demo Editor',
    roleProfileName: 'Video editor',
    roleCode: 'creative',
    departmentName: 'Creative'
  }
];

/** `Demo Agent One` -> `demo-agent-one@demo.local`. Stable, so re-runs match. */
function demoEmailFor(name: string): string {
  return `${name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}${DEMO_EMAIL_DOMAIN}`;
}

// ── Department demo items ────────────────────────────────────────────────────
//
// Work sized so every department lands on a KNOWN health state under rule A
// (src/lib/dept-health.ts), giving the Control Tower one bad, one
// needs_attention and two good departments.
//
// ⚠️ HEALTH IS DERIVED FROM THE OWNER'S DEPARTMENT, not the project. An item's
// project is a board grouping; its contribution to health follows
// tracked_item.owner_person_id -> person.department_id. That is why the owner
// column below matters more than it looks, and why a re-owned item silently
// moves a department's health.
//
// ⚠️ DUE DATES ARE RELATIVE, always. `dueInDays` is applied to run time and
// anchored to UTC midnight — the same helper shape seed-tracker.ts uses. A
// hardcoded date stops triggering the state it was chosen for the day after it
// is written, and the failure looks like a broken health rule.
//
// ⚠️ THIS LIST IS THE DELETION MANIFEST for demo work, per hard rule 4. Items
// are keyed on (project_id, title), so removing a row here orphans rather than
// deletes it — delete by title if you prune the list.
//
// ⚠️ Every item HAS a project. A null project_id is invisible on the tracker
// board (it filters on project_id and the project list only counts items that
// have one), so an unfiled item is stored, correct, and impossible to find.

/**
 * The spec's "(you)" owner — the signed-in developer, so My day and My projects
 * render something on their login.
 *
 * ⚠️ A REAL ROSTER PERSON, deliberately NOT a demo row. D3 links a Clerk account
 * to a `person` by email, so the signed-in developer must exist on the real
 * roster with their real address. A `@demo.local` row could never match a Clerk
 * login, and these two items would be owned by somebody nobody can sign in as.
 *
 * ⚠️ If your Clerk email is not the roster address for this name, these two items
 * will not appear on YOUR My day. Add yourself to PEOPLE (role `coder`, dept
 * Engineering) and set the address via `PERSON_EMAILS=...  pnpm db:seed`, then
 * point this constant at your name.
 */
const SIGNED_IN_DEV_NAME = 'Sami';

type DemoItem = {
  title: string;
  ownerName: string;
  status: TrackedItemStatus;
  /** Days from run time. Negative = overdue. 0 = due today. */
  dueInDays: number;
  riskFlag?: boolean;
  projectName: string;
  description?: string;
};

const DEPT_DEMO_ITEMS: DemoItem[] = [
  // ── Creative -> bad ───────────────────────────────────────────────────────
  // Two independent triggers on purpose: 1 item overdue past the limit AND
  // BLOCKED_BAD_COUNT blocked items. Either alone would do it, so the state
  // survives a team-lead tweak to either threshold.
  {
    title: 'Q3 hero video brief revision',
    ownerName: 'Hashim',
    status: 'open',
    dueInDays: -5,
    projectName: 'Content Operations'
  },
  {
    title: 'Santos UGC batch 2 concepts',
    ownerName: 'Demo Editor',
    status: 'blocked',
    dueInDays: 3,
    projectName: 'Studio / UGC Platform',
    description: 'Waiting on product samples before concepting can start.'
  },
  {
    title: 'Bron unboxing script rewrite',
    ownerName: 'Demo Editor',
    status: 'blocked',
    dueInDays: 5,
    projectName: 'Studio / UGC Platform',
    description: 'Blocked on the revised positioning doc.'
  },
  {
    title: 'August content calendar',
    ownerName: 'Hashim',
    status: 'in_progress',
    dueInDays: 7,
    projectName: 'Content Operations'
  },
  {
    title: 'Brief template refresh',
    ownerName: 'Hashim',
    status: 'open',
    dueInDays: 10,
    projectName: 'Content Operations'
  },

  // ── CX / Support -> needs_attention ───────────────────────────────────────
  // One of each trigger, and the overdue item is only 1 day late — inside
  // OVERDUE_BAD_DAYS, so it must NOT tip the department to bad.
  {
    title: 'Macro routing rules update',
    ownerName: 'Demo Support Manager',
    status: 'blocked',
    dueInDays: 4,
    projectName: 'Inbox',
    description: 'Needs the new taxonomy signed off first.'
  },
  {
    title: 'Returns FAQ rewrite',
    ownerName: 'Demo Agent One',
    status: 'open',
    dueInDays: -1,
    projectName: 'Content Operations'
  },
  {
    title: 'Escalation playbook v2',
    ownerName: 'Demo Agent Two',
    status: 'in_progress',
    dueInDays: 6,
    riskFlag: true,
    projectName: 'Inbox'
  },
  {
    title: 'Weekly CSAT digest setup',
    ownerName: 'Demo Support Manager',
    status: 'open',
    dueInDays: 9,
    projectName: 'Command Center'
  },
  {
    title: 'Holiday coverage plan',
    ownerName: 'Demo Agent One',
    status: 'open',
    dueInDays: 14,
    projectName: 'Inbox'
  },

  // ── Engineering -> good ───────────────────────────────────────────────────
  // Nothing overdue, nothing blocked, nothing at risk. The `done` item is
  // deliberately in the past: terminal statuses are excluded from health, so it
  // proves the exclusion works rather than weakening the state.
  {
    title: 'Webhook retry dashboard',
    ownerName: 'Usama',
    status: 'in_progress',
    dueInDays: 5,
    projectName: 'Command Center'
  },
  {
    title: 'Identity backfill script',
    ownerName: 'Usama',
    status: 'open',
    dueInDays: 8,
    projectName: 'Command Center'
  },
  {
    title: 'Tracker board keyboard nav',
    ownerName: SIGNED_IN_DEV_NAME,
    status: 'in_progress',
    dueInDays: 4,
    projectName: 'Command Center'
  },
  {
    // ⚠️ dueInDays 0 = due TODAY, which is what makes My day show something.
    // Due-today must read as NOT overdue — see the day-boundary note in
    // src/lib/dept-health.ts, and the test that pins it.
    title: 'Seed idempotency test',
    ownerName: SIGNED_IN_DEV_NAME,
    status: 'open',
    dueInDays: 0,
    projectName: 'Command Center'
  },
  {
    title: 'Rate-limit alerting',
    ownerName: 'Usama',
    status: 'done',
    dueInDays: -2,
    projectName: 'Command Center'
  },

  // ── Operations -> good ────────────────────────────────────────────────────
  {
    title: 'Vendor contract review',
    ownerName: 'Ardin',
    status: 'in_progress',
    dueInDays: 12,
    projectName: 'Inbox'
  },
  {
    title: 'Hiring pipeline sync',
    ownerName: 'Ardin',
    status: 'open',
    dueInDays: 6,
    projectName: 'Inbox'
  },
  {
    title: 'Q3 tooling audit',
    ownerName: 'Damian',
    status: 'open',
    dueInDays: 20,
    projectName: 'Command Center'
  }
];

/**
 * Roster email addresses, read from the environment — NEVER hardcoded.
 *
 * ⚠️ THIS REPO IS PUBLIC (verified: api.github.com returns 200 unauthenticated).
 * Names are already committed above and are low-risk; work email addresses are
 * not, and CLAUDE.md forbids committing real identities — we already had to
 * scrub one out of the ClickUp fixtures.
 *
 * Email is the ONLY automatic cross-system join key, so seeding it is what makes
 * ClickUp and UGC events resolve without a human. Supply it at run time:
 *
 *   PERSON_EMAILS='Sami=sami@example.com,Usama=usama@example.com' pnpm db:seed
 *
 * Anyone not listed keeps whatever email they already have — a re-seed with the
 * variable unset must not wipe addresses that were set through the admin UI.
 */
function rosterEmails(): Map<string, string> {
  const raw = process.env.PERSON_EMAILS?.trim();
  if (!raw) return new Map();

  const entries: [string, string][] = [];
  for (const pair of raw.split(',')) {
    // split with a limit of 2 would drop anything after a second '=' — emails
    // cannot contain one, but a malformed value should be skipped, not mangled.
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim().toLowerCase();
    const email = pair.slice(idx + 1).trim();
    if (name && email) entries.push([name, email]);
  }
  return new Map(entries);
}

// ── Recurring tasks (Automations screen) ─────────────────────────────────────
//
// Aligned with the mockup's `autoRules` rows (Command Center Roles.dc.html,
// data-screen-label="Automations"), so the Automations table renders the labels
// the design shows:
//
//   Daily returns review — Diane      Portal · awaiting-review tab acknowledged
//   Weekly brief quota — Hashim       Brief Tracker · submission count vs quota
//   Standup notes — Usama             Slack · #eng-standup message detected
//   CX metrics recap — Ronalyn        Fireflies · recap delivered in meeting
//   Returns-tab event emitter (v2)    Portal v2 — blocked, migration overdue
//
// ⚠️ THE MOCKUP'S TASK LABEL CANNOT BE STORED. `recurring_task` has no
// title/label column and the spec forbids adding one, so the visible label is a
// service-layer concern — derive it from the owner plus the rule. Only `cadence`,
// `auto_complete_rule` and `fallback_manual` are seeded here.
//
// ⚠️ THE FIFTH MOCKUP ROW HAS NO OWNER and cannot be represented at all:
// `recurring_task.owner_person_id` is NOT NULL. Ardin's ops-review row is
// retained in its place so the table still has five rows, which is also what
// keeps the count unchanged per hard rule 2.
//
// ⚠️ KEYED ON owner_person_id ALONE, changed from (owner, rule.event). Aligning
// to the mockup CHANGES the event for three of the four owners, so the old
// composite key would match nothing and insert duplicates instead of updating in
// place — breaking both idempotency and "don't add more". One row per owner holds
// today and the loop throws if it ever stops holding, rather than silently
// picking one.

const RECURRING_TASKS = [
  {
    // Mockup: "CX metrics recap — Ronalyn"
    ownerName: 'Ronalyn',
    cadence: 'weekly',
    autoCompleteRule: { source: 'fireflies', event: 'recap_delivered', within: '7d' },
    fallbackManual: true
  },
  {
    // Mockup: "Daily returns review — Diane"
    ownerName: 'Diane',
    cadence: 'daily',
    autoCompleteRule: { source: 'portal', event: 'awaiting_review_acknowledged', within: '24h' },
    fallbackManual: true
  },
  {
    // No mockup counterpart — stands in for the unowned fifth row. See above.
    ownerName: 'Ardin',
    cadence: 'weekly',
    autoCompleteRule: { source: 'slack', event: 'ops_review_posted', within: '7d' },
    fallbackManual: false
  },
  {
    // Mockup: "Weekly brief quota — Hashim". Unchanged — it already matched.
    ownerName: 'Hashim',
    cadence: 'weekly',
    autoCompleteRule: { source: 'brief_tracker', event: 'briefs_submitted', within: '7d' },
    fallbackManual: false
  },
  {
    // Mockup: "Standup notes — Usama"
    ownerName: 'Usama',
    cadence: 'daily',
    autoCompleteRule: { source: 'slack', event: 'standup_message', within: '24h' },
    fallbackManual: false
  }
] as const;

/** UTC midnight, `days` from `now`. Matches seed-tracker.ts's helper exactly. */
function dueDateFrom(days: number, now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Seed the department demo items.
 *
 * ⚠️ RUNS AFTER seedTracker(), which owns the projects. Two of the four projects
 * these items reference (`Command Center`, `Content Operations`,
 * `Studio / UGC Platform`) are created there; `Inbox` is created by
 * `approveCandidate()` in production and is get-or-created here so a fresh
 * database does not fail on it.
 *
 * Idempotent on (project_id, title) — the same key seed-tracker uses, so the two
 * seeds cannot collide on a shared title within a project.
 */
async function seedDepartmentDemoItems(now: Date): Promise<{ items: number }> {
  const people = await db.select({ id: person.id, name: person.name }).from(person);
  const byName = new Map(people.map((p) => [p.name, p.id]));

  const projectIds = new Map<string, string>();

  for (const projectName of new Set(DEPT_DEMO_ITEMS.map((i) => i.projectName))) {
    const [existing] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.name, projectName))
      .limit(1);

    if (existing) {
      projectIds.set(projectName, existing.id);
      continue;
    }

    // Only `Inbox` should ever reach here — the other three are seedTracker's.
    // Creating it rather than throwing keeps a fresh database seedable in one
    // pass, and matches how approveCandidate() get-or-creates it.
    const [created] = await db
      .insert(project)
      .values({
        name: projectName,
        description:
          projectName === 'Inbox'
            ? 'Triage bucket. Approved action items land here until they are filed to a real project.'
            : null,
        status: 'active'
      })
      .returning({ id: project.id });
    projectIds.set(projectName, created.id);
  }

  let count = 0;

  for (const it of DEPT_DEMO_ITEMS) {
    const ownerPersonId = byName.get(it.ownerName);
    if (!ownerPersonId) {
      // Hard failure, same as seedTracker. A department seeded against a partial
      // roster still renders a health state — the WRONG one — and nothing looks
      // broken.
      throw new Error(
        `Seed roster mismatch: no person named "${it.ownerName}" for item "${it.title}". ` +
          `Demo people are created earlier in this same seed; run pnpm db:seed as a whole.`
      );
    }

    const projectId = projectIds.get(it.projectName);
    if (!projectId) throw new Error(`No project named "${it.projectName}" for "${it.title}"`);

    const values = {
      projectId,
      // 'internal' + NULL external_task_id, per tracked_item_external_ref_ck.
      sourceSystem: 'internal' as const,
      externalTaskId: null,
      sourceType: 'manual' as const,
      title: it.title,
      description: it.description ?? null,
      ownerPersonId,
      status: it.status,
      dueDate: dueDateFrom(it.dueInDays, now),
      riskFlag: it.riskFlag ?? false,
      lastUpdateAt: now
    };

    const [row] = await db
      .select({ id: trackedItem.id })
      .from(trackedItem)
      .where(and(eq(trackedItem.projectId, projectId), eq(trackedItem.title, it.title)))
      .limit(1);

    if (row) await db.update(trackedItem).set(values).where(eq(trackedItem.id, row.id));
    else await db.insert(trackedItem).values(values);

    count += 1;
  }

  return { items: count };
}

async function seed() {
  const profileIds = new Map<string, string>();

  await db.transaction(async (tx) => {
    // role — keyed on its EXPLICIT primary key, so this is a genuine upsert.
    // Fixed ids are the whole point: they must be identical in dev, staging and
    // production so a role id can never mean different things per environment.
    for (const code of ROLE_CODES) {
      await tx
        .insert(role)
        .values({ id: ROLE_IDS[code], code, displayName: ROLE_DISPLAY_NAMES[code] })
        .onConflictDoUpdate({
          target: role.id,
          // `code` is included so a corrected id→code mapping propagates. It is
          // also UNIQUE, so a genuine collision fails loudly rather than
          // silently rewriting a different role.
          set: { code, displayName: ROLE_DISPLAY_NAMES[code] }
        });
    }

    // department — keyed case-insensitively on name, matching
    // department_name_lower_idx. Explicit lookup rather than onConflictDoUpdate:
    // the unique index is FUNCTIONAL (lower(name)), which Drizzle cannot express
    // as a conflict target without raw SQL.
    const departmentIds = new Map<string, string>();

    for (const d of DEPARTMENTS) {
      const [existing] = await tx
        .select({ id: department.id })
        .from(department)
        .where(eq(sql`lower(${department.name})`, d.name.toLowerCase()))
        .limit(1);

      if (existing) {
        await tx
          .update(department)
          .set({ deptType: d.deptType })
          .where(eq(department.id, existing.id));
        departmentIds.set(d.name, existing.id);
      } else {
        const [created] = await tx
          .insert(department)
          .values({ name: d.name, deptType: d.deptType })
          .returning({ id: department.id });
        departmentIds.set(d.name, created.id);
      }
    }

    // role_profile — keyed on name
    for (const p of ROLE_PROFILES) {
      const [existing] = await tx
        .select({ id: roleProfile.id })
        .from(roleProfile)
        .where(eq(roleProfile.name, p.name))
        .limit(1);

      if (existing) {
        await tx
          .update(roleProfile)
          .set({
            trackedSignals: [...p.trackedSignals],
            quotaConfig: p.quotaConfig,
            sourceChannels: [...p.sourceChannels]
          })
          .where(eq(roleProfile.id, existing.id));
        profileIds.set(p.name, existing.id);
      } else {
        const [created] = await tx
          .insert(roleProfile)
          .values({
            name: p.name,
            trackedSignals: [...p.trackedSignals],
            quotaConfig: p.quotaConfig,
            sourceChannels: [...p.sourceChannels]
          })
          .returning({ id: roleProfile.id });
        profileIds.set(p.name, created.id);
      }
    }

    // person — keyed on name
    const personIds = new Map<string, string>();

    const emails = rosterEmails();

    // Real roster first, then demo rows. One loop so both get identical
    // role/department/profile handling — a second loop would drift.
    const allPeople = [
      ...PEOPLE.map((p) => ({ ...p, demo: false })),
      ...DEMO_PEOPLE.map((p) => ({ ...p, demo: true }))
    ];

    for (const pr of allPeople) {
      const roleProfileId = profileIds.get(pr.roleProfileName);
      if (!roleProfileId) {
        throw new Error(`No role_profile named "${pr.roleProfileName}" for ${pr.name}`);
      }

      const departmentId = departmentIds.get(pr.departmentName);
      if (!departmentId) {
        throw new Error(`No department named "${pr.departmentName}" for ${pr.name}`);
      }

      const roleId = ROLE_IDS[pr.roleCode];

      const [existing] = await tx
        .select({ id: person.id })
        .from(person)
        .where(eq(person.name, pr.name))
        .limit(1);

      // Undefined (not null) when absent, so the update below omits the column
      // entirely rather than overwriting a real address with NULL.
      //
      // ⚠️ A demo person's address is DERIVED and always written, never read from
      // PERSON_EMAILS. Letting a demo row take a real address would defeat the
      // whole point of the @demo.local rule — see the note on DEMO_PEOPLE.
      const seededEmail = pr.demo ? demoEmailFor(pr.name) : emails.get(pr.name.toLowerCase());

      if (existing) {
        // Only the profile link and a supplied email are managed here. External
        // ids are left exactly as they are, so a real slack_id added by hand is
        // never clobbered.
        await tx
          .update(person)
          .set({
            roleProfileId,
            roleId,
            departmentId,
            ...(seededEmail ? { email: seededEmail } : {})
          })
          .where(eq(person.id, existing.id));
        personIds.set(pr.name, existing.id);
      } else {
        const [created] = await tx
          .insert(person)
          .values({
            name: pr.name,
            email: seededEmail ?? null,
            roleProfileId,
            roleId,
            departmentId,
            slackId: null,
            clickupId: null,
            portalId: null
          })
          .returning({ id: person.id });
        personIds.set(pr.name, created.id);
      }
    }

    // recurring_task — keyed on owner_person_id alone. See the note above
    // RECURRING_TASKS for why this is no longer keyed on the rule event too.
    for (const rt of RECURRING_TASKS) {
      const ownerPersonId = personIds.get(rt.ownerName);
      if (!ownerPersonId) throw new Error(`No person named "${rt.ownerName}"`);

      const owned = await tx
        .select({ id: recurringTask.id })
        .from(recurringTask)
        .where(eq(recurringTask.ownerPersonId, ownerPersonId));

      // ⚠️ Hard failure rather than picking the first. Owner-only keying is valid
      // ONLY while each person has at most one recurring task; the moment that
      // stops being true, an arbitrary choice here would silently rewrite the
      // wrong row on every re-seed. Whoever adds a second one needs a real key
      // (a title column, or an explicit id) and should see this message.
      if (owned.length > 1) {
        throw new Error(
          `${rt.ownerName} has ${owned.length} recurring_task rows. This seed keys them on owner ` +
            `alone, which is now ambiguous — give recurring_task a stable natural key before ` +
            `seeding more than one per person.`
        );
      }

      const match = owned[0];

      if (match) {
        await tx
          .update(recurringTask)
          .set({
            cadence: rt.cadence,
            autoCompleteRule: rt.autoCompleteRule,
            fallbackManual: rt.fallbackManual
          })
          .where(eq(recurringTask.id, match.id));
      } else {
        await tx.insert(recurringTask).values({
          ownerPersonId,
          cadence: rt.cadence,
          autoCompleteRule: rt.autoCompleteRule,
          fallbackManual: rt.fallbackManual
        });
      }
    }
  });

  // Report
  // ⚠️ AFTER the transaction above commits — seedTracker looks people up by
  // name, so the person rows must be visible to it.
  const now = new Date();
  const tracker = await seedTracker(now);
  console.log(`\n  Tracker: ${tracker.projects} projects, ${tracker.items} tracked items`);

  // ⚠️ AFTER seedTracker — it owns three of the four projects these reference.
  const demo = await seedDepartmentDemoItems(now);
  console.log(`  Department demo items: ${demo.items}`);

  const counts = await Promise.all(
    [
      ['role', role],
      ['department', department],
      ['role_profile', roleProfile],
      ['person', person],
      ['recurring_task', recurringTask],
      ['project', project],
      ['tracked_item', trackedItem]
    ].map(async ([label, table]) => {
      const rows = await db.select({ id: (table as typeof roleProfile).id }).from(table as never);
      return [label as string, rows.length] as const;
    })
  );

  console.log('\n  Seed complete:');
  for (const [label, n] of counts) {
    console.log(`    ${label.padEnd(16)} ${n} rows`);
  }
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n  Seed failed:', err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
