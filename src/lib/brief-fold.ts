import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * THE brief state fold. One implementation, app-wide.
 *
 * ⚠️ Lives in `src/lib`, NOT in `src/features/briefs`, because two features need
 * it: the briefs board and the overview page. CLAUDE.md is explicit — "if two
 * features need the same behaviour, it belongs in src/lib or the DB layer, not in
 * an import between them". Overview calling briefs' service would be exactly the
 * cross-feature service import that rule forbids.
 *
 * ⚠️ NOT `'use server'`. This is a plain module called BY Server Actions, not a
 * Server Action itself — it has no auth check of its own, so every caller must
 * do its own `auth()` before invoking it.
 *
 * ⚠️ Vision has NO status field. State is derived by folding events, and nothing
 * stores the result: a stored state is a second source of truth that can
 * disagree with the log it came from, and the only way to check would be
 * re-deriving it — which is this function.
 */

/** Column/lifecycle order. Not alphabetical. */
export const BRIEF_STATES = ['in_progress', 'in_review', 'sent_back', 'approved'] as const;
export type BriefState = (typeof BRIEF_STATES)[number];

/**
 * Events that MOVE a brief. Last one wins.
 *
 * ⚠️ `brief.commented` and `brief.script_saved` are deliberately absent — they
 * update last-activity only. Verified against real data: `#2 — Ronin Launch` is
 * `submitted > commented > commented > sent_back > commented` and its state is
 * "Sent back". The trailing comment must not drag it back to In review.
 *
 * ⚠️ `brief.updated → in_progress` is what makes RESUBMISSION work with no
 * special-casing: a sent-back brief that gets edited returns to In progress, and
 * a later submit puts it back in review. The fold only ever asks "what was the
 * last lifecycle event".
 *
 * ⚠️ `brief.approved` has never been observed (0 of 165 events) but is mapped so
 * the day it arrives the board just works instead of filing it as In progress.
 */
export const LIFECYCLE_EVENT_STATE: Record<string, BriefState> = {
  'brief.created': 'in_progress',
  'brief.updated': 'in_progress',
  'brief.submitted': 'in_review',
  'brief.sent_back': 'sent_back',
  'brief.approved': 'approved'
};

/**
 * ⚠️ THE PRODUCTION FILTER. Every brief query must use it.
 *
 * 12 of 186 Vision events are `development`. `control_center.test` is excluded by
 * requiring `subject_type = 'brief'` — the test envelope carries no brief
 * subject. `coalesce(..., 'production')` treats a missing environment as
 * production so an event predating the field is not silently dropped.
 *
 * ⚠️ EVERY COLUMN IS QUALIFIED `ue.`, and every consumer MUST alias
 * `unified_event` as `ue`. Unqualified `source = 'vision'` read fine in isolation
 * and threw `column reference "source" is ambiguous` the moment a
 * `person_identity` join landed — that table has its own `source` and `email`.
 * A shared SQL fragment cannot assume one table is in scope.
 */
export const PRODUCTION_BRIEF = sql`
  ue.source = 'vision'
  and ue.subject_type = 'brief'
  and coalesce(ue.metadata->>'environment', 'production') = 'production'
`;

const LIFECYCLE_TYPES = sql.raw(
  `(${Object.keys(LIFECYCLE_EVENT_STATE)
    .map((t) => `'${t}'`)
    .join(',')})`
);

export type FoldedBrief = {
  id: string;
  label: string | null;
  state: BriefState;
  /** When the event that set the CURRENT state occurred. */
  stateEnteredAt: string;
  /**
   * `min(occurred_at)` — FIRST OBSERVED, not true creation. Two briefs have no
   * `brief.created` event at all, so this must never be presented as "created".
   */
  firstObservedAt: string;
  lastActivityAt: string;
  eventCount: number;
  /** Resolved through person_identity. Null when the actor has no identity row. */
  actorName: string | null;
  /** person.id when the identity is LINKED, else null — the name still resolves. */
  actorPersonId: string | null;
};

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}

/**
 * Every production brief with its derived state.
 *
 * ⚠️ TWO QUERIES TOTAL regardless of brief count — never one per brief.
 * `DISTINCT ON (subject_id) … ORDER BY subject_id, occurred_at DESC` is the
 * index-friendly fold: Postgres walks each brief's events newest-first and stops
 * at the first row. It is also exactly "last lifecycle event wins", expressed
 * once, in SQL — no state machine to keep in sync.
 *
 * ⚠️ Attribution joins `person_identity`, NOT `unified_event.person_id`. The
 * denormalised column is null on all brief events until `pnpm events:attribute`
 * runs; the join resolves regardless.
 */
export async function foldBriefs(): Promise<FoldedBrief[]> {
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

  const aggByBrief = new Map(rowsOf<AggRow>(aggRes).map((r) => [r.subject_id, r]));

  const out: FoldedBrief[] = [];
  for (const s of rowsOf<StateRow>(stateRes)) {
    const agg = aggByBrief.get(s.subject_id);
    /**
     * ⚠️ A brief whose ONLY events are comments/script-saves has no lifecycle
     * event, so no derivable state, so it is absent here. Not present in current
     * data (every brief has at least one lifecycle event) — recorded because it
     * would present as a missing row rather than an error.
     */
    if (!agg) continue;

    out.push({
      id: s.subject_id,
      label: agg.label,
      state: LIFECYCLE_EVENT_STATE[s.event_type],
      stateEnteredAt: new Date(s.state_entered_at).toISOString(),
      firstObservedAt: new Date(agg.first_observed_at).toISOString(),
      lastActivityAt: new Date(agg.last_activity_at).toISOString(),
      eventCount: agg.event_count,
      actorName: s.actor_name,
      actorPersonId: s.person_id
    });
  }
  return out;
}
