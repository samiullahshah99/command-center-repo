// ============================================================
// Home (Overview) Service — Data Access Layer
// ============================================================
// 'use server' is REQUIRED: queries.ts is consumed on both sides of the SSR
// handoff, so this must be callable as RPC from the browser on navigation.
//
// READ-ONLY. This page observes; it has no mutations and must never gain one.
//
// ⚠️ REAL DATA ONLY. Every number returned here comes from a query against real
// rows. Nothing is sampled, defaulted-to-plausible, or filled in. A wrong number
// on this page either invents urgency or hides it.
// ============================================================

'use server';

import { auth } from '@clerk/nextjs/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidateActionItem } from '@/db/schema';
import { foldBriefs } from '@/lib/brief-fold';
import { getNavCounts } from '@/lib/nav-counts';
// Constants may cross a feature boundary (CLAUDE.md); the THRESHOLD NUMBERS are
// not duplicated here — they are read from the briefs feature that owns them.
import { STALE_DAYS } from '@/features/briefs/constants/brief-states';
import type { ActivityDay, AttentionRow, HomeSnapshot, PipelineCounts } from './types';

async function requireUser(): Promise<void> {
  // Resource-based check, not a reliance on src/proxy.ts: a Server Action is its
  // own POST endpoint and `createRouteMatcher` is deprecated because its path
  // matching can diverge from how Next.js routes.
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/** Rows shown in the hero before it collapses to "+N more". */
const ATTENTION_CAP = 7;
const ACTIVITY_WINDOW_DAYS = 7;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}

/**
 * Everything the landing page renders, in FIVE queries plus the shared fold.
 *
 * ⚠️ One aggregate per widget, never per entity. This re-runs in the BROWSER as
 * an RPC on navigation, so an N+1 here would be N+1 network round trips.
 *
 * ⚠️ `getNavCounts` is the SAME cached function the sidebar badge uses, so the
 * Review count on this page and the badge in the rail cannot disagree, and the
 * count is queried once per 60s rather than once per surface.
 */
export async function getHomeSnapshot(): Promise<HomeSnapshot> {
  await requireUser();

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
