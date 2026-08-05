// ============================================================
// Briefs Service — Data Access Layer
// ============================================================
// 'use server' is REQUIRED: queries.ts is consumed on both sides of the SSR
// handoff, so these must be callable as RPC from the browser.
//
// READ-ONLY, structurally. Vision is the system of record for briefs; CC
// observes. There are no mutations in this file and there must never be one.
// ============================================================

'use server';

import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { foldBriefs, PRODUCTION_BRIEF } from '@/lib/brief-fold';
import { buildBriefBacklog, buildWeeklySeries } from '@/lib/brief-view';
import { quotaConfigSchema } from '../constants/brief-states';
import type {
  AdTesting,
  BriefBoard,
  BriefCard,
  BriefQuota,
  BriefsQuotaScreen,
  BriefTimeline,
  QuotaRow
} from './types';

/**
 * `db.execute` returns a result object on node-postgres and a bare array on some
 * drivers. Normalised once here rather than at each call site.
 *
 * Not exported: `'use server'` requires every export to be an async function.
 */
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}

async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/**
 * The board.
 *
 * ⚠️ TWO QUERIES FOR THE WHOLE BOARD, never one per brief. Query A folds each
 * brief's LAST lifecycle event via `DISTINCT ON`; query B aggregates counts,
 * label, first-observed and last-activity across all events. Merged in JS.
 *
 * `DISTINCT ON (subject_id) … ORDER BY subject_id, occurred_at DESC` is the
 * index-friendly fold: Postgres walks each brief's events newest-first and stops
 * at the first row. It is also exactly the "last lifecycle event wins" rule,
 * expressed once, in SQL — no state machine to keep in sync.
 */
export async function getBriefBoard(): Promise<BriefBoard> {
  await requireUser();

  // The SHARED fold — the same function the overview page calls, so the two
  // surfaces can never disagree about a brief's state.
  const folded = await foldBriefs();

  const cards: BriefCard[] = folded.map((b) => ({
    id: b.id,
    label: b.label,
    // Enough to tell colliding "#4 — Untitled brief" cards apart, short enough to
    // stay secondary to the label it disambiguates.
    idFragment: b.id.slice(0, 8),
    state: b.state,
    stateEnteredAt: b.stateEnteredAt,
    strategist: b.actorName
      ? { personId: b.actorPersonId, name: b.actorName, linked: Boolean(b.actorPersonId) }
      : null,
    firstObservedAt: b.firstObservedAt,
    lastActivityAt: b.lastActivityAt,
    eventCount: b.eventCount
  }));

  return { cards, total: cards.length, now: new Date().toISOString() };
}

/** Full event timeline for one brief — comments and script saves included. */
export async function getBriefTimeline(briefId: string): Promise<BriefTimeline> {
  await requireUser();

  const res = await db.execute(sql`
    select
      ue.id,
      ue.event_type,
      ue.occurred_at::text as occurred_at,
      ue.subject_label,
      ue.metadata->'fields' as fields,
      pi.person_id,
      coalesce(pi.editor_name, pi.display_name, pi.email) as actor_name
    from unified_event ue
    left join person_identity pi on pi.id = ue.person_identity_id
    where ${PRODUCTION_BRIEF} and ue.subject_id = ${briefId}
    order by ue.occurred_at desc
  `);

  type Row = {
    id: string;
    event_type: string;
    occurred_at: string;
    subject_label: string | null;
    fields: unknown;
    person_id: string | null;
    actor_name: string | null;
  };
  const rows = rowsOf<Row>(res);

  return {
    briefId,
    label: rows[0]?.subject_label ?? null,
    entries: rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      occurredAt: new Date(r.occurred_at).toISOString(),
      actor: r.actor_name
        ? { personId: r.person_id, name: r.actor_name, linked: Boolean(r.person_id) }
        : null,
      // Defensive: `fields` is free-form jsonb. Anything non-array becomes [].
      fields: Array.isArray(r.fields)
        ? r.fields.filter((f): f is string => typeof f === 'string')
        : []
    })),
    now: new Date().toISOString()
  };
}

// ── Step 5: weekly brief quota ───────────────────────────────────────────────

/** Monday 00:00 UTC of the week containing `d`. */
function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  // Sunday counts as the END of the week, so it maps back six days, not forward.
  const delta = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - delta));
}

/**
 * Briefs SUBMITTED this week per person, against their role's quota.
 *
 * ⚠️ ONE query for the counts, one for the targets. Never per person.
 *
 * ⚠️ THE EVENT CHANGED ON 2026-08-06: `brief.created` → `brief.submitted`. See the
 * full reasoning on the query below and on `QuotaRow.submitted`. Every consumer was
 * updated in the same change — there are two: this feature's own
 * `BriefQuotaBar` (rendered as the People page's quota column) and the Briefs &
 * quota hero card.
 */
export async function getBriefQuota(): Promise<BriefQuota> {
  await requireUser();

  const weekStart = mondayOf(new Date());

  /**
   * ⚠️ COUNTS `brief.submitted`, CHANGED FROM `brief.created` on 2026-08-06.
   *
   * Decision 6 says the quota counts APPROVED briefs. The live Vision catalogue
   * emits **no `brief.approved` event at all** — created, updated, submitted,
   * sent_back, commented and script_saved only — so approvals cannot be counted at
   * all. Submissions are the closest measurable proxy to the decision, and every
   * surface rendering this number captions the substitution.
   *
   * ⚠️ THIS CHANGES A NUMBER PEOPLE HAVE ALREADY SEEN, and NOT PREDICTABLY IN ONE
   * DIRECTION. The People page's quota column previously showed briefs STARTED; it
   * now shows briefs SUBMITTED. Measured on live data for the current week: created
   * = Usama 6 / Ardin 5, submitted = Usama 10 / Ardin 0 — submissions can EXCEED
   * creations because a brief submitted this week may have been started in an
   * earlier one. It is a different measure, not a smaller one. Audit D9 flagged
   * "created" as measuring the wrong thing.
   *
   * ⚠️ Still never `brief.updated`: updates fire 278 times across 19 briefs, so
   * counting them would measure editing volume and present it as output.
   */
  const submittedRes = await db.execute(sql`
    select pi.person_id, count(*)::int as n
    from unified_event ue
    join person_identity pi on pi.id = ue.person_identity_id
    where ${PRODUCTION_BRIEF}
      and ue.event_type = 'brief.submitted'
      and ue.occurred_at >= ${weekStart.toISOString()}::timestamptz
      and pi.person_id is not null
    group by pi.person_id
  `);
  const submittedRows = rowsOf<{ person_id: string; n: number }>(submittedRes);

  const targetRes = await db.execute(sql`
    select p.id as person_id, rp.quota_config
    from person p
    join role_profile rp on rp.id = p.role_profile_id
  `);
  const targetRows = rowsOf<{ person_id: string; quota_config: unknown }>(targetRes);

  const submittedBy = new Map(submittedRows.map((r) => [r.person_id, r.n]));

  const rows: QuotaRow[] = [];
  let configured = false;
  for (const t of targetRows) {
    const target = quotaConfigSchema.parse(t.quota_config).briefsPerWeek ?? null;
    if (target && target > 0) configured = true;
    rows.push({ personId: t.person_id, submitted: submittedBy.get(t.person_id) ?? 0, target });
  }

  return { rows, configured, weekStart: weekStart.toISOString() };
}

// ── Briefs & quota (the creative persona's home screen) ─────────────────────
//
// ⚠️ TWO surfaces below are invented and each carries its own flag: the calendar
// -aware nudge and the ad-testing card. The quota count, the week and the
// turnaround are real queries. See docs/gaps.md.

const TURNAROUND_WINDOW_DAYS = 30;

/** ISO week label — "W32". Shared shape with @/lib/brief-view. */
function weekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `W${Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)}`;
}

/**
 * TODO(backend): calendar-aware nudge.
 *
 * ⚠️ INVENTED COPY. The mockup's nudge names the writer's calendar blocks ("writing
 * blocks Mon & Wed"); Calendar has no client, no credentials and no table (audit
 * §2.12). The remaining-count IS real — it is target minus submitted — but the
 * scheduling advice around it is not, so the whole line is flagged.
 *
 * ⚠️ Returns null when there is no target. A nudge toward a quota nobody configured
 * is noise, and inventing urgency is worse than saying nothing.
 */
function sampleNudge(submitted: number, target: number | null): string | null {
  if (target === null) return null;
  const remaining = Math.max(0, target - submitted);
  if (remaining === 0) return 'Quota met for this week.';
  return `${remaining} to go before Friday — writing blocks Mon & Wed on your calendar.`;
}

/**
 * TODO(backend): ad-testing pipeline.
 *
 * ⚠️ WHOLLY INVENTED — there is no model, no table and no source. `BRIEF_STATES` is
 * `in_progress | in_review | sent_back | approved`: no `in_testing`, no `winner`
 * (audit §2.12). Fixed values rather than derived ones, precisely because there is
 * no real signal to derive from; the caption is what makes that legible.
 */
function sampleAdTesting(): AdTesting {
  return { inTesting: 1, winners: ['Sample winner'], isSample: true };
}

/**
 * Everything the Briefs & quota screen adds beyond the shared brief views.
 *
 * ⚠️ ME-SCOPED. `personId` is resolved by the caller through `getCurrentActor()`;
 * this function never reads the session to decide whose quota it is, which keeps
 * the scoping visible at the call site.
 *
 * ⚠️ `now` is a PARAMETER, resolved once by the caller.
 */
export async function getBriefsQuotaScreen(
  personId: string,
  now: Date
): Promise<BriefsQuotaScreen> {
  await requireUser();

  // ── The quota, me-scoped. Reuses the SAME function the People column reads, so
  //    the two cannot disagree about the count or the target. ─────────────────
  const quota = await getBriefQuota();
  const mine = quota.rows.find((r) => r.personId === personId);

  const submitted = mine?.submitted ?? 0;
  const target = mine?.target ?? null;

  /**
   * ── Average turnaround: created → submitted, over the last 30 days.
   *
   * ⚠️ REAL, and paired IN SQL per brief rather than by folding. The fold carries
   * only a brief's CURRENT state, so it cannot supply both timestamps; this needs
   * the created event and the submitted event for the same subject.
   *
   * ⚠️ Only briefs with BOTH events count. A brief created before the webhook
   * existed has no create event (see the note on FoldedBrief), and pairing a
   * missing timestamp with a present one would invent a turnaround.
   */
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - TURNAROUND_WINDOW_DAYS);

  const turnaroundRes = await db.execute(sql`
    with pairs as (
      select ue.subject_id,
             min(ue.occurred_at) filter (where ue.event_type = 'brief.created')   as created_at,
             min(ue.occurred_at) filter (where ue.event_type = 'brief.submitted') as submitted_at
      from unified_event ue
      where ${PRODUCTION_BRIEF}
        and ue.event_type in ('brief.created', 'brief.submitted')
      group by ue.subject_id
    )
    select count(*)::int as n,
           avg(extract(epoch from (submitted_at - created_at)) / 86400.0)::float as avg_days
    from pairs
    where created_at is not null
      and submitted_at is not null
      and submitted_at >= created_at
      and submitted_at >= ${windowStart.toISOString()}::timestamptz
  `);
  const t = rowsOf<{ n: number; avg_days: number | null }>(turnaroundRes)[0];

  /**
   * ⚠️ THE SHARED FOLD AND THE SHARED BUILDERS — the same ones the creative
   * department panel uses, so a creative and an ops lead looking at the same week
   * cannot see different backlogs or different bars.
   */
  const folded = await foldBriefs();

  let quotaTotal: number | null = null;
  for (const r of quota.rows) {
    if (r.target && r.target > 0) quotaTotal = (quotaTotal ?? 0) + r.target;
  }

  return {
    backlog: buildBriefBacklog(folded, now),
    performance: buildWeeklySeries(folded, now, quotaTotal),
    quota: {
      submitted,
      target,
      week: weekLabel(now),
      weekStart: quota.weekStart,
      // ⚠️ Invented — see sampleNudge. Null (and no caption) when unconfigured.
      nudge: sampleNudge(submitted, target),
      nudgeIsSample: target !== null
    },
    turnaround: {
      avgDays: t && t.n > 0 && t.avg_days !== null ? Number(t.avg_days.toFixed(1)) : null,
      sampleSize: t?.n ?? 0
    },
    adTesting: sampleAdTesting(),
    now: now.toISOString()
  };
}
