// ============================================================
// My day Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
//
// READ-ONLY. This page observes; it has no mutations and must never gain one.
//
// ⚠️ THREE SURFACES ON THIS PAGE ARE INVENTED and each carries an `isSample`
// flag its renderer reads: the "Today" timeline (no calendar integration), the
// recurring tasks' state + evidence (no completion engine — the ROWS are real),
// and the latest meeting (0% Fireflies attribution). Everything else is a real
// query. See the per-function notes and docs/gaps.md.
//
// ⚠️ ONE PRE-AGGREGATED CALL. Audit §2.10 names this endpoint shape as a
// requirement: `getMyDay(personId, now)` returns everything the page renders. Do
// not add a second call for a new widget — extend this one.
// ============================================================

'use server';

import { asc, eq, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { person, project, recurringTask, roleProfile, trackedItem } from '@/db/schema';
import type { Cadence } from '@/db/schema/recurring-task';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { formatDateOnly, formatMeetingDate } from '@/lib/format-date';
import { TERMINAL_STATUSES } from '@/lib/dept-health';
import { recurringLabel, watchedSignalLabel } from '@/lib/recurring-label';
import type {
  Greeting,
  MyAlert,
  MyDay,
  MyItem,
  MyLatestMeeting,
  MyRecurring,
  MyRecurringTask,
  MySignals,
  MyToday,
  RecurringState
} from './types';

/** Resource-based check on every export — a Server Action is its own endpoint. */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/** Alerts shown before the strip stops being a glance. */
const ALERT_CAP = 3;

const TERMINAL: readonly TrackedItemStatus[] = TERMINAL_STATUSES;

/**
 * Human labels for `tracked_item.source_type`. Matches the person profile's map —
 * both derive the same four strings from the same Postgres enum.
 */
const SOURCE_LABEL: Record<string, string> = {
  meeting: 'Meeting',
  slack: 'Slack',
  manual: 'Manual',
  system: 'System'
};

/** UTC day, for whole-day comparisons. */
function utcDay(x: Date): number {
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/** Monday 00:00 UTC of `now`'s week. Sunday counts as the previous week. */
function mondayOf(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

/**
 * Greeting band, from the SERVER's `now`.
 *
 * ⚠️ Computed here and shipped in the DTO rather than in the component. A
 * component reading the clock would resolve a different hour on the server than in
 * the browser for anyone near a boundary, and React discards the mismatched
 * subtree — the same failure documented under "PIN THE LOCALE" in CLAUDE.md.
 *
 * ⚠️ UTC, like every other time on this page. That means the greeting follows the
 * pinned zone rather than the reader's local morning; a per-viewer greeting needs a
 * stored timezone preference, which does not exist yet.
 */
function greetingFor(now: Date): Greeting {
  const h = now.getUTCHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

// ── Sample data ─────────────────────────────────────────────────────────────
//
// ⚠️ THE THREE FUNCTIONS BELOW RETURN INVENTED DATA. Each surface they feed is
// flagged `isSample` / `stateIsSample`, and the UI renders a caption from that
// flag — the flag travels with the data precisely so a renderer cannot show one
// without the other.
//
// They live here, behind the service seam, rather than in the components: this is
// the ONLY file that changes when the backends arrive. Mock data inside a
// component means the component is rewritten too, and the fake shape becomes what
// the real shape gets bent to fit.
//
// ⚠️ CONTENT IS DELIBERATELY GENERIC — no real meeting titles, no transcript
// prose, no colleague names beyond the page's own subject. This repo is PUBLIC and
// a captured ClickUp response leaked a real work address once already.
//
// ⚠️ EVERY TIME IS RELATIVE TO `now`. A hardcoded day stops being "today"
// tomorrow, and a timeline showing last week reads as a broken integration rather
// than as sample data.

/**
 * TODO(backend): calendar.
 *
 * Confirmed in scope (frontend contract §4.1) but NO CODE EXISTS — no provider
 * client, no credentials, no `calendar_event` table. Audit §2.5 scopes it. Replace
 * the body with a real query and set `isSample: false`; nothing else changes.
 */
function sampleToday(): MyToday {
  return {
    isSample: true,
    blocks: [
      { id: 'today-1', time: '09:30', title: 'Team standup', accentVar: 'var(--chart-2)' },
      { id: 'today-2', time: '11:00', title: 'Focus block', accentVar: 'var(--chart-4)' },
      { id: 'today-3', time: '15:00', title: 'Review session', accentVar: 'var(--chart-1)' }
    ]
  };
}

/**
 * TODO(backend): completion engine (audit D5).
 *
 * ⚠️ ONLY the state and the evidence are invented — the task rows, their owner,
 * cadence and watched signal are real. `completion_event` has 0 rows and NO
 * WRITER, and nothing evaluates `recurring_task.auto_complete_rule`.
 *
 * ⚠️ NEVER "fix" this by seeding `completion_event`. A seeded row makes a
 * fabricated state indistinguishable from a measured one at the database level,
 * which is strictly worse than a labelled placeholder. The seed spec's hard rules
 * forbid it for the same reason.
 *
 * ⚠️ DERIVED FROM REAL FIELDS so it is stable per task rather than reshuffling on
 * every reload — a state that changes on refresh reads as live data. `index` keys
 * it, and `fallbackManual` genuinely does mean "there is no reliable signal here",
 * which is exactly what `manual_required` would mean once the engine exists.
 */
function sampleRecurringState(
  index: number,
  fallbackManual: boolean
): {
  state: RecurringState;
  evidence: string;
} {
  if (fallbackManual) {
    return {
      state: 'manual_required',
      evidence: 'No reliable signal for this task — needs a manual check-off.'
    };
  }
  return index % 2 === 0
    ? { state: 'auto_completed', evidence: 'Signal seen this period — would auto-complete.' }
    : { state: 'pending', evidence: 'No signal yet this period.' };
}

/**
 * TODO(backend): fireflies attribution.
 *
 * The transcripts are REAL and stored — six of them — but "my meetings" cannot be
 * queried: Fireflies webhooks carry a `meeting_id` and no actor, so attribution
 * sits at 0% of 10 events (audit D4). `speakers[]` is `{id, name}` with no email,
 * nothing links a speaker to a `participants[]` entry, and name matching is never
 * an auto-match at any confidence level — so there is no honest join from a
 * transcript to a person yet.
 *
 * When attribution lands, query `transcript` joined through this person's Fireflies
 * `unified_event`s and set `isSample: false`.
 */
function sampleLatestMeeting(now: Date, firstName: string): MyLatestMeeting {
  const when = new Date(now);
  when.setUTCDate(when.getUTCDate() - 1);
  when.setUTCHours(10, 0, 0, 0);

  return {
    isSample: true,
    meeting: {
      id: 'sample-latest-meeting',
      title: 'Weekly sync',
      tool: 'Fireflies',
      when: formatMeetingDate(when.toISOString()),
      attendees: [firstName, 'Ops lead', 'Support manager'],
      aiSummary:
        'Sample summary. The team reviewed open work, agreed two follow-ups and flagged one dependency as blocking. Replace when Fireflies attribution lands.',
      actions: [
        {
          id: 'sample-latest-action-1',
          text: 'Write up the dependency and who owns it',
          ownerName: firstName,
          state: 'open'
        },
        {
          id: 'sample-latest-action-2',
          text: 'Circulate the revised timeline',
          ownerName: 'Ops lead',
          state: 'in_progress'
        }
      ]
    }
  };
}

/**
 * Everything My day renders, in THREE queries.
 *
 * ⚠️ `now` is a PARAMETER, resolved once by the caller and threaded through. Every
 * due-date comparison, the greeting and the week boundary derive from it, so the
 * page cannot disagree with itself about what "today" is.
 *
 * ⚠️ Scoped by `personId`, which the caller resolves through
 * `requirePersonId()` — the Clerk→person link. This function never reads the
 * session to decide WHOSE day it is: taking the id explicitly keeps it testable
 * and makes the scoping visible at the call site.
 */
export async function getMyDay(personId: string, now: Date): Promise<MyDay> {
  await requireUser();

  const weekStart = mondayOf(now);

  // ── 1. My items, with their project. One query; sorting happens below, where
  //    "worst first" needs the overdue comparison against `now`. ──────────────
  const itemRows = await db
    .select({
      id: trackedItem.id,
      title: trackedItem.title,
      projectId: trackedItem.projectId,
      projectName: project.name,
      status: trackedItem.status,
      sourceType: trackedItem.sourceType,
      dueDate: trackedItem.dueDate,
      riskFlag: trackedItem.riskFlag,
      // Not in the DTO — used only for the "done this week" count below.
      lastUpdateAt: trackedItem.lastUpdateAt
    })
    .from(trackedItem)
    .leftJoin(project, eq(project.id, trackedItem.projectId))
    .where(eq(trackedItem.ownerPersonId, personId))
    .orderBy(sql`${trackedItem.dueDate} asc nulls last`);

  // ── 2. Person + role profile. Query builder rather than raw SQL: no result
  //    cast, and `role_profile` is LEFT joined because the link is nullable. ──
  const [personRow] = await db
    .select({ name: person.name, roleProfileName: roleProfile.name })
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(eq(person.id, personId))
    .limit(1);

  // ── 3. My recurring tasks. REAL rows; state is mocked below. ──────────────
  const recurringRows = await db
    .select({
      id: recurringTask.id,
      cadence: recurringTask.cadence,
      autoCompleteRule: recurringTask.autoCompleteRule,
      fallbackManual: recurringTask.fallbackManual
    })
    .from(recurringTask)
    .where(eq(recurringTask.ownerPersonId, personId))
    .orderBy(asc(recurringTask.createdAt));

  // ── Assemble ──────────────────────────────────────────────────────────────

  const items: MyItem[] = itemRows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: r.projectName,
    status: r.status as TrackedItemStatus,
    sourceLabel: SOURCE_LABEL[r.sourceType] ?? r.sourceType,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    riskFlag: r.riskFlag
  }));

  const today = utcDay(now);
  const isTerminal = (s: TrackedItemStatus) => TERMINAL.includes(s);
  const isOverdue = (i: MyItem) =>
    !isTerminal(i.status) && i.dueDate !== null && utcDay(new Date(i.dueDate)) < today;

  const live = items.filter((i) => !isTerminal(i.status));

  const signals: MySignals = {
    open: live.length,
    overdue: live.filter(isOverdue).length,
    dueToday: live.filter((i) => i.dueDate !== null && utcDay(new Date(i.dueDate)) === today)
      .length,
    /**
     * ⚠️ Counted from `last_update_at`, NOT from a completion timestamp — there is
     * no `done_at` column on `tracked_item`. So this reads "items in `done` whose
     * last recorded movement was this week", which is the closest honest answer
     * available. It over-counts if a long-done item is touched again this week, and
     * under-counts an item completed this week whose row was never re-touched.
     *
     * ⚠️ Computed from `itemRows`, not from the mapped `items`, because it needs
     * `last_update_at` — which the DTO deliberately does not carry, since nothing
     * on this page renders it.
     *
     * A real answer needs a completion timestamp, which is the same gap the
     * completion engine leaves (audit D5).
     */
    doneThisWeek: itemRows.filter(
      (r) => r.status === 'done' && r.lastUpdateAt !== null && r.lastUpdateAt >= weekStart
    ).length
  };

  /**
   * ── Alerts: my troubled open items, worst first.
   *
   * ⚠️ Derived from the SAME `items` array the list below renders, not from a
   * second query. A separate query would be free to disagree with the list — an
   * alert about an item the list does not show is the kind of thing that reads as
   * a ghost.
   */
  const alerts: MyAlert[] = live
    .filter((i) => isOverdue(i) || i.status === 'blocked' || i.riskFlag)
    .map((i) => {
      const overdue = isOverdue(i);
      const tag = overdue ? 'Overdue' : i.status === 'blocked' ? 'Blocked' : 'At risk';

      return {
        id: i.id,
        // Overdue and blocked both mean "this is stuck now"; at-risk is a warning.
        severity: (overdue || i.status === 'blocked'
          ? 'destructive'
          : 'warning') as MyAlert['severity'],
        text: i.title ?? 'Title held in the source system',
        meta: [
          i.projectName ?? 'Unfiled',
          i.dueDate ? `due ${formatDateOnly(i.dueDate)}` : 'no due date'
        ].join(' · '),
        tag,
        href: i.projectId ? `/dashboard/tracker/${i.projectId}` : '/dashboard/tracker'
      };
    })
    // destructive before warning; equal severities keep the SQL's due-date order.
    // toSorted, not sort: the rule is about not mutating, and stating that here
    // costs nothing even though this array is already a fresh .map() result.
    .toSorted((a, b) => (a.severity === b.severity ? 0 : a.severity === 'destructive' ? -1 : 1))
    .slice(0, ALERT_CAP);

  /**
   * ── Item order: non-terminal first, then worst (overdue) → soonest due.
   *
   * The SQL already ordered by due date with nulls last; this is a stable
   * re-sort on top of that, so items with equal rank keep the SQL order.
   */
  const rank = (i: MyItem) => {
    if (isTerminal(i.status)) return 3;
    if (isOverdue(i)) return 0;
    if (i.status === 'blocked' || i.riskFlag) return 1;
    return 2;
  };
  const ordered = items.toSorted((a, b) => rank(a) - rank(b));

  const recurringTasks: MyRecurringTask[] = recurringRows.map((r, index) => {
    const rule = (r.autoCompleteRule ?? {}) as { source?: string; event?: string };
    const mocked = sampleRecurringState(index, r.fallbackManual);

    return {
      id: r.id,
      name: recurringLabel(rule.event),
      cadence: r.cadence as Cadence,
      watchedSignal: watchedSignalLabel(rule.source, rule.event),
      fallbackManual: r.fallbackManual,
      state: mocked.state,
      evidence: mocked.evidence
    };
  });

  const recurring: MyRecurring = {
    // ⚠️ Applies to state + evidence only. The rows above are real.
    stateIsSample: true,
    tasks: recurringTasks
  };

  const fullName = personRow?.name ?? 'there';
  const firstName = fullName.trim().split(/\s+/)[0] || fullName;

  return {
    person: {
      id: personId,
      firstName,
      roleProfileName: personRow?.roleProfileName ?? null
    },
    greeting: greetingFor(now),
    now: now.toISOString(),
    signals,
    alerts,
    items: ordered,
    today: sampleToday(),
    recurring,
    latestMeeting: sampleLatestMeeting(now, firstName)
  };
}
