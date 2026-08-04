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
import { LIFECYCLE_EVENT_STATE, quotaConfigSchema } from '../constants/brief-states';
import type {
  BriefBoard,
  BriefCard,
  BriefQuota,
  BriefState,
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
 * ⚠️ THE PRODUCTION FILTER, applied in EVERY query in this file.
 *
 * ⚠️ EVERY COLUMN IS QUALIFIED `ue.`, and every consumer MUST alias
 * `unified_event` as `ue`. Unqualified `source = 'vision'` looked fine in
 * isolation and threw `column reference "source" is ambiguous` the moment the
 * `person_identity` join landed — that table has its own `source` (and `email`)
 * column. A shared SQL fragment cannot rely on there being only one table in
 * scope.
 *
 * 12 of 186 Vision events are `development`. `control_center.test` is excluded by
 * requiring `subject_type = 'brief'` — the test envelope carries no brief
 * subject. `coalesce(...,'production')` treats a missing environment as
 * production so an older event predating the field is not silently dropped.
 */
const PRODUCTION_BRIEF = sql`
  ue.source = 'vision'
  and ue.subject_type = 'brief'
  and coalesce(ue.metadata->>'environment', 'production') = 'production'
`;

const LIFECYCLE_TYPES = sql.raw(
  `(${Object.keys(LIFECYCLE_EVENT_STATE)
    .map((t) => `'${t}'`)
    .join(',')})`
);

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

  const now = new Date();

  // ── A. Last LIFECYCLE event per brief → the derived state. ────────────────
  const stateRes = await db.execute(sql`
    select distinct on (ue.subject_id)
      ue.subject_id,
      ue.event_type,
      ue.occurred_at::text as state_entered_at,
      pi.person_id,
      coalesce(pi.editor_name, pi.display_name, pi.email) as actor_name
    from unified_event ue
    left join person_identity pi on pi.id = ue.person_identity_id
    where ${PRODUCTION_BRIEF} and ue.event_type in ${LIFECYCLE_TYPES}
    order by ue.subject_id, ue.occurred_at desc
  `);

  // ── B. Aggregates per brief, over ALL its events (comments included). ─────
  const aggRes = await db.execute(sql`
    select
      ue.subject_id,
      count(*)::int as event_count,
      min(ue.occurred_at)::text as first_observed_at,
      max(ue.occurred_at)::text as last_activity_at,
      (array_agg(ue.subject_label order by ue.occurred_at desc))[1] as label
    from unified_event ue
    where ${PRODUCTION_BRIEF}
    group by ue.subject_id
  `);

  type StateRow = {
    subject_id: string;
    event_type: string;
    state_entered_at: string;
    person_id: string | null;
    actor_name: string | null;
  };
  type AggRow = {
    subject_id: string;
    event_count: number;
    first_observed_at: string;
    last_activity_at: string;
    label: string | null;
  };

  const stateRows = rowsOf<StateRow>(stateRes);
  const aggByBrief = new Map(rowsOf<AggRow>(aggRes).map((r) => [r.subject_id, r]));

  const cards: BriefCard[] = [];
  for (const s of stateRows) {
    const agg = aggByBrief.get(s.subject_id);
    if (!agg) continue;

    cards.push({
      id: s.subject_id,
      label: agg.label,
      // Enough to tell colliding "#4 — Untitled brief" cards apart, short enough
      // to stay a secondary element rather than competing with the label.
      idFragment: s.subject_id.slice(0, 8),
      state: LIFECYCLE_EVENT_STATE[s.event_type] as BriefState,
      stateEnteredAt: new Date(s.state_entered_at).toISOString(),
      strategist: s.actor_name
        ? { personId: s.person_id, name: s.actor_name, linked: Boolean(s.person_id) }
        : null,
      firstObservedAt: new Date(agg.first_observed_at).toISOString(),
      lastActivityAt: new Date(agg.last_activity_at).toISOString(),
      eventCount: agg.event_count
    });
  }

  /**
   * ⚠️ A brief whose ONLY events are comments/script-saves has no lifecycle event
   * and so no derivable state — it is absent from query A and therefore from the
   * board. Not observed in current data (every brief has at least one lifecycle
   * event), but recorded because it would present as a missing card rather than
   * an error.
   */
  return { cards, total: aggByBrief.size, now: now.toISOString() };
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
 * Briefs created this week per person, against their role's quota.
 *
 * ⚠️ ONE query for the counts, one for the targets. Never per person.
 *
 * ⚠️ Counts `brief.created` ONLY — not updates. The quota is about how many
 * briefs someone STARTED; `brief.updated` fires 138 times across 17 briefs, so
 * counting it would measure editing volume and call it output.
 */
export async function getBriefQuota(): Promise<BriefQuota> {
  await requireUser();

  const weekStart = mondayOf(new Date());

  const createdRes = await db.execute(sql`
    select pi.person_id, count(*)::int as n
    from unified_event ue
    join person_identity pi on pi.id = ue.person_identity_id
    where ${PRODUCTION_BRIEF}
      and ue.event_type = 'brief.created'
      and ue.occurred_at >= ${weekStart.toISOString()}::timestamptz
      and pi.person_id is not null
    group by pi.person_id
  `);
  const createdRows = rowsOf<{ person_id: string; n: number }>(createdRes);

  const targetRes = await db.execute(sql`
    select p.id as person_id, rp.quota_config
    from person p
    join role_profile rp on rp.id = p.role_profile_id
  `);
  const targetRows = rowsOf<{ person_id: string; quota_config: unknown }>(targetRes);

  const createdBy = new Map(createdRows.map((r) => [r.person_id, r.n]));

  const rows: QuotaRow[] = [];
  let configured = false;
  for (const t of targetRows) {
    const target = quotaConfigSchema.parse(t.quota_config).briefsPerWeek ?? null;
    if (target && target > 0) configured = true;
    rows.push({ personId: t.person_id, created: createdBy.get(t.person_id) ?? 0, target });
  }

  return { rows, configured, weekStart: weekStart.toISOString() };
}
