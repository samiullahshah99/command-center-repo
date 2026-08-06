// ============================================================
// Home (Overview) Service — Data Access Layer
// ============================================================
// 'use server' is REQUIRED: queries.ts is consumed on both sides of the SSR
// handoff, so this must be callable as RPC from the browser on navigation.
//
// READ-ONLY. This page observes; it has no mutations and must never gain one.
//
// ⚠️ REAL DATA, WITH EXACTLY ONE MARKED EXCEPTION. Every number returned here
// comes from a query against real rows except `weekly.autoCompleted`, which is
// invented because the completion engine does not exist — it carries
// `weekly.autoCompletedIsSample: true` and the UI renders a "preview" caption
// from that flag. See `sampleAutoCompleted` below and docs/gaps.md.
//
// Nothing else is sampled, defaulted-to-plausible, or filled in. A wrong number
// on this page either invents urgency or hides it. If you add a widget whose data
// does not exist yet, add a flag beside it — do not add an unlabelled number, and
// do not seed a table to make one look measured.
// ============================================================

'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/current-actor';
import { rolesForRoute } from '@/lib/route-access';
import { candidateActionItem } from '@/db/schema';
import { foldBriefs } from '@/lib/brief-fold';
import { TERMINAL_STATUSES } from '@/lib/dept-health';
import { getDeptNav } from '@/lib/dept-nav';
import { getNavCounts } from '@/lib/nav-counts';
// Constants may cross a feature boundary (CLAUDE.md); the THRESHOLD NUMBERS are
// not duplicated here — they are read from the briefs feature that owns them.
import { STALE_DAYS } from '@/features/briefs/constants/brief-states';
import type {
  ActivityDay,
  AttentionRow,
  DeptCard,
  HomeSnapshot,
  PipelineCounts,
  ProjectRow,
  WeeklyCapture
} from './types';

/** Rows shown in the hero before it collapses to "+N more". */
const ATTENTION_CAP = 7;
const ACTIVITY_WINDOW_DAYS = 7;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}

/** Monday 00:00 UTC of `now`'s week. Sunday counts as the previous week. */
function mondayOf(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

/**
 * TODO(backend): completion engine.
 *
 * ⚠️ RETURNS AN INVENTED NUMBER. `completion_event` has 0 rows and no writer, and
 * nothing evaluates `recurring_task.auto_complete_rule` — the PRD's
 * "evidenced, not self-declared" completion is unbuilt (audit §D5). The card
 * renders a "Preview" caption from `autoCompletedIsSample`, so the number can
 * never appear unlabelled.
 *
 * ⚠️ DERIVED FROM A REAL COUNT ON PURPOSE, so it moves with the data instead of
 * being a frozen "18" that stays put while everything around it changes — a
 * static number beside live ones is the version most likely to be believed.
 * It is still invented; the flag is what makes that legible, not the arithmetic.
 *
 * ⚠️ DO NOT "fix" this by seeding `completion_event`. A seeded row makes a
 * fabricated number indistinguishable from a measured one at the database level,
 * which is strictly worse than a labelled placeholder.
 */
function sampleAutoCompleted(capturedThisWeek: number): number {
  return Math.floor(capturedThisWeek / 2);
}

/**
 * Everything the Control Tower renders, in SEVEN aggregates plus three shared
 * helpers (`foldBriefs`, `getDeptNav`, `getNavCounts`).
 *
 * ⚠️ THE ONLY ROLLUP. The audit named this the compliant pre-aggregated endpoint
 * and the hard rule is that a new widget EXTENDS it rather than adding a second
 * one — two rollups mean two clocks, two definitions of "open", and two numbers
 * for the same thing on one screen.
 *
 * ⚠️ One aggregate per widget, never per entity. This re-runs in the BROWSER as
 * an RPC on navigation, so an N+1 here would be N+1 network round trips.
 *
 * ⚠️ THREE NUMBERS ARE SHARED WITH OTHER SURFACES BY CONSTRUCTION, not by
 * coincidence:
 *   • `getNavCounts`  — the same cached call as the sidebar's review badge
 *   • `getDeptNav`    — the same query AND the same `computeDeptHealth` call as
 *                       the sidebar's department health dots
 *   • `foldBriefs`    — one fold feeding both the attention rows and the pipeline
 * Each of those could have been a local query. Each would then have been free to
 * drift from the surface it is supposed to agree with.
 *
 * ⚠️ ROLE GATE, INSIDE THE SERVICE — defence in depth, not the UX.
 *
 * The page guard (`requireRouteAccess`) already redirects an unauthorised reader.
 * It does NOT protect this function: `'use server'` publishes every export as its
 * own POST endpoint, reachable without ever loading the page. For the Control Tower rollup the
 * RETURN VALUE is the thing worth protecting, so the check belongs here too.
 *
 * ⚠️ Roles come from `ROUTE_ACCESS`, so this list cannot drift from the page's.
 */
export async function getHomeSnapshot(): Promise<HomeSnapshot> {
  await requireRole(rolesForRoute('/dashboard/overview'), 'the Control Tower rollup');

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600_000);
  const windowStart = new Date(now.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * 86_400_000);

  // ── Briefs: the SHARED fold. Feeds both the attention hero and the pipeline
  //    strip, so one call serves two widgets and they cannot diverge. ─────────
  const folded = await foldBriefs();

  // ── Candidates needing an owner decision. One GROUP-free scan, capped. ─────
  const unowned = await db
    .select({
      id: candidateActionItem.id,
      description: candidateActionItem.description,
      ownerConfidence: candidateActionItem.ownerConfidence,
      unifiedEventId: candidateActionItem.unifiedEventId
    })
    .from(candidateActionItem)
    .where(
      and(
        eq(candidateActionItem.reviewStatus, 'pending'),
        sql`${candidateActionItem.ownerConfidence} in ('fuzzy','unresolved')`
      )
    )
    .orderBy(asc(candidateActionItem.createdAt))
    // Capped in SQL, not in JS: the hero shows at most ATTENTION_CAP rows and the
    // uncapped total comes from getNavCounts, so fetching every row to throw most
    // away would be waste.
    .limit(ATTENTION_CAP + 1);

  const [oldestPending] = await db
    .select({ at: candidateActionItem.createdAt })
    .from(candidateActionItem)
    .where(eq(candidateActionItem.reviewStatus, 'pending'))
    .orderBy(asc(candidateActionItem.createdAt))
    .limit(1);

  // ── Activity: one GROUP BY over the 7-day window. Production Vision events
  //    are filtered; other sources carry no environment field. ───────────────
  const activityRes = await db.execute(sql`
    select to_char(date_trunc('day', ue.occurred_at), 'YYYY-MM-DD') as day,
           count(*)::int as n
    from unified_event ue
    where ue.occurred_at >= ${windowStart.toISOString()}::timestamptz
      and coalesce(ue.metadata->>'environment', 'production') = 'production'
    group by 1
  `);
  const activityRows = rowsOf<{ day: string; n: number }>(activityRes);

  const lastEventRes = await db.execute(sql`
    select ue.source, ue.occurred_at::text as at
    from unified_event ue
    where coalesce(ue.metadata->>'environment', 'production') = 'production'
    order by ue.occurred_at desc
    limit 1
  `);
  const lastEventRow = rowsOf<{ source: string; at: string }>(lastEventRes)[0];

  /**
   * ── Team presence. One LEFT JOIN aggregate over the roster.
   *
   * ⚠️ Presence only — no counts, no ranking. Event volume measures how chatty
   * someone's tools are, not their contribution, and a seven-person leaderboard
   * is a surveillance artefact.
   *
   * ⚠️ Attribution goes through `person_identity`, NOT `unified_event.person_id`
   * — the denormalised column is null on most events until `pnpm
   * events:attribute` runs. Reading it directly would show the whole team grey.
   */
  const teamRes = await db.execute(sql`
    select p.id, p.name,
           count(ue.id) filter (
             where ue.occurred_at >= ${since24h.toISOString()}::timestamptz
           )::int as recent
    from person p
    left join person_identity pi on pi.person_id = p.id
    left join unified_event ue on ue.person_identity_id = pi.id
      and coalesce(ue.metadata->>'environment', 'production') = 'production'
    group by p.id, p.name
    order by p.name
  `);
  const teamRows = rowsOf<{ id: string; name: string; recent: number }>(teamRes);

  /**
   * ── This week's capture. ONE aggregate, split by the originating source.
   *
   * ⚠️ INNER JOIN to `unified_event`, not LEFT: `candidate_action_item.
   * unified_event_id` is NOT NULL with an ON DELETE CASCADE, so every candidate
   * has an event. A LEFT join would imply otherwise and invite a null branch that
   * can never be reached.
   *
   * `captured` is the true total; the two splits are the only sources that
   * currently produce candidates. They are reported separately rather than as
   * "other" so a third source appearing shows up as total > meetings + slack
   * instead of being silently absorbed.
   */
  const weekStart = mondayOf(now);

  const weeklyRes = await db.execute(sql`
    select count(*)::int                                              as captured,
           count(*) filter (where ue.source = 'fireflies')::int        as from_meetings,
           count(*) filter (where ue.source = 'slack')::int            as from_slack
    from candidate_action_item c
    join unified_event ue on ue.id = c.unified_event_id
    where c.created_at >= ${weekStart.toISOString()}::timestamptz
  `);
  const weeklyRow = rowsOf<{ captured: number; from_meetings: number; from_slack: number }>(
    weeklyRes
  )[0];

  /**
   * ── Active projects with progress.
   *
   * ⚠️ QUERIED HERE rather than by calling the tracker's `getProjects()`.
   * CLAUDE.md forbids one feature importing another's service — "services,
   * queries and mutations may not [cross a boundary]" — and that rule is what
   * stops two features' data layers becoming mutually dependent. What IS shared
   * is the part that could drift: `TERMINAL_STATUSES`, imported rather than
   * retyped, so "open" means the same thing here, on the tracker board, and in
   * department health.
   *
   * ⚠️ `archived` is excluded in SQL. The Control Tower answers "what is in
   * flight"; an archived project is neither in flight nor a risk, and listing it
   * would push live work down the card.
   */
  const terminal = sql.join(
    TERMINAL_STATUSES.map((s) => sql`${s}`),
    sql`, `
  );

  const projectRes = await db.execute(sql`
    select p.id,
           p.name,
           p.status,
           owner.name                                                  as owner_name,
           count(t.id)::int                                            as total_count,
           count(t.id) filter (where t.status not in (${terminal}))::int as open_count
    from project p
    left join person owner on owner.id = p.lead_person_id
    left join tracked_item t on t.project_id = p.id
    where p.status <> 'archived'
    group by p.id, p.name, p.status, owner.name
    order by p.name
  `);
  const projectRows = rowsOf<{
    id: string;
    name: string;
    status: string;
    owner_name: string | null;
    total_count: number;
    open_count: number;
  }>(projectRes);

  /**
   * ── Department health.
   *
   * ⚠️ THE SAME CALL THE SIDEBAR MAKES. `getDeptNav` shares one query
   * (`getDeptItems`, memoised per request with no arguments) and one
   * `computeDeptHealth` invocation path with the rail's health dots, so a card and
   * a dot cannot report different states for the same department. That was the
   * explicit requirement — see the header on @/lib/dept-nav.
   */
  const deptRows = await getDeptNav(now);

  // Shared with the sidebar badge — one cached call, not a second query.
  const navCounts = await getNavCounts();

  // ── Assemble ──────────────────────────────────────────────────────────────

  const pipeline: PipelineCounts = {
    in_progress: 0,
    in_review: 0,
    sent_back: 0,
    approved: 0
  };
  for (const b of folded) pipeline[b.state] += 1;

  const attention: AttentionRow[] = [];

  for (const b of folded) {
    if (b.state !== 'sent_back' && b.state !== 'in_review') continue;
    const t = STALE_DAYS[b.state];
    if (!t) continue;

    const days = Math.floor((now.getTime() - new Date(b.stateEnteredAt).getTime()) / 86_400_000);
    // Below amber is not a problem — a brief in review for a day is just in review.
    if (days < t.amber) continue;

    attention.push({
      key: `brief:${b.id}`,
      kind: b.state === 'sent_back' ? 'brief_sent_back' : 'brief_in_review',
      severity: days >= t.red ? 'red' : 'amber',
      title: b.label ?? 'Untitled brief',
      detail: b.id.slice(0, 8),
      days,
      actorName: b.actorName,
      actorLinked: Boolean(b.actorPersonId),
      href: '/dashboard/briefs'
    });
  }

  for (const c of unowned) {
    attention.push({
      key: `cand:${c.id}`,
      kind: 'candidate_unowned',
      severity: 'unowned',
      title: c.description.length > 90 ? `${c.description.slice(0, 90)}…` : c.description,
      detail: c.ownerConfidence,
      days: null,
      actorName: null,
      actorLinked: false,
      // The extraction detail page for the meeting this came from.
      href: `/dashboard/extraction/${c.unifiedEventId}`
    });
  }

  /*
   * TODO — two further row types slot in HERE, deliberately not stubbed:
   *   • overdue `tracked_item` rows (Day 2): non-terminal, due_date < now,
   *     severity red past a threshold. Needs the tracker's own thresholds.
   *   • aged review items (Day 4): pending candidates older than a review SLA,
   *     which needs the review queue to exist to link to.
   * No placeholder cards for either — a card showing a number we cannot compute
   * is exactly what the REAL-DATA-ONLY rule forbids.
   */

  // Severity first, then longest-waiting within a severity.
  const RANK: Record<AttentionRow['severity'], number> = { red: 0, amber: 1, unowned: 2 };
  attention.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.days ?? 0) - (a.days ?? 0));

  const dayKeys: string[] = [];
  for (let i = 0; i < ACTIVITY_WINDOW_DAYS; i++) {
    dayKeys.push(dayKey(new Date(windowStart.getTime() + i * 86_400_000)));
  }
  const byDay = new Map(activityRows.map((r) => [r.day, r.n]));
  const activity: ActivityDay[] = dayKeys.map((day) => ({ day, count: byDay.get(day) ?? 0 }));

  const captured = weeklyRow?.captured ?? 0;
  const weekly: WeeklyCapture = {
    captured,
    fromMeetings: weeklyRow?.from_meetings ?? 0,
    fromSlack: weeklyRow?.from_slack ?? 0,
    // ⚠️ The one invented number on this page. See sampleAutoCompleted.
    autoCompleted: sampleAutoCompleted(captured),
    autoCompletedIsSample: true,
    weekStart: weekStart.toISOString()
  };

  const departments: DeptCard[] = deptRows.map((d) => ({
    id: d.id,
    name: d.name,
    accentVar: d.accentVar,
    health: d.health,
    healthReasons: d.healthReasons,
    // `activeItems` IS the open count — non-terminal items. Renamed at the DTO
    // because "open" is the word the card uses.
    openCount: d.activeItems,
    peopleCount: d.peopleCount
  }));

  const projects: ProjectRow[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    ownerName: p.owner_name,
    /**
     * ⚠️ TERMINAL over total, which counts `cancelled` alongside `done`. The
     * available aggregate does not split them, and a cancelled item genuinely is
     * no longer outstanding — but this bar is therefore "resolved", not strictly
     * "done". Null rather than 0 when a project has no items: an empty project is
     * not 0% complete, and a 0% bar reads as failure.
     */
    progressPct:
      p.total_count > 0 ? Math.round(((p.total_count - p.open_count) / p.total_count) * 100) : null,
    openCount: p.open_count,
    totalCount: p.total_count,
    status: p.status as ProjectRow['status']
  }));

  return {
    attention: attention.slice(0, ATTENTION_CAP),
    attentionTotal: attention.length,
    reviewPending: navCounts.reviewPending,
    reviewOldestAt: oldestPending?.at ? new Date(oldestPending.at).toISOString() : null,
    activity,
    activityTotal: activity.reduce((s, d) => s + d.count, 0),
    lastEvent: lastEventRow
      ? { source: lastEventRow.source, at: new Date(lastEventRow.at).toISOString() }
      : null,
    pipeline,
    weekly,
    departments,
    projects,
    team: teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      initials: initialsOf(t.name),
      active24h: t.recent > 0
    })),
    identitiesUnlinked: navCounts.identitiesUnlinked,
    now: now.toISOString()
  };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
