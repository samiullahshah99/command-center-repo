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
import { quotaConfigSchema } from '../constants/brief-states';
import type { BriefBoard, BriefCard, BriefQuota, BriefTimeline, QuotaRow } from './types';

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
