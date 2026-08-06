// ============================================================
// Founder Offload Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
//
// ⚠️⚠️ THIS SERVICE TOUCHES NO TABLE. It imports no schema and issues no query,
// because there is nothing to query: the offload model does not exist. This is
// the build's FIRST fully sample-backed screen — every other mocked surface so
// far has been one widget on a page of real data.
// ============================================================

'use server';

import { requireRole } from '@/lib/current-actor';
import { rolesForRoute } from '@/lib/route-access';
import type { FounderOffload, OffloadRow, OffloadStats } from './types';

/**
 * TODO(backend): founder offload model — design its verification concept
 * TOGETHER with the completion engine's evidence model (audit D5: one evidence
 * model, two surfaces).
 *
 * ⚠️⚠️ EVERY ROW BELOW IS INVENTED. There is no `founder_offload` table, no
 * offload column on any existing table, and `source_type` is a pgEnum with the
 * values `meeting | slack | manual | system` — no `founder_offload` member
 * (audit §2.8).
 *
 * ⚠️ DO NOT "fix" this by adding the enum value or a table. The enum is a
 * Postgres `pgEnum`, so `ALTER TYPE ... ADD VALUE` cannot run inside a
 * transaction and a value can never be removed — adding one speculatively is
 * expensive to undo. More importantly the model's hard part is not its columns:
 * it is what counts as PROOF that a task actually left the founder's plate, and
 * that concept has to be designed once and shared with the completion engine, not
 * invented twice.
 *
 * ⚠️ OWNERS ARE DEMO PEOPLE (`@demo.local`) PLUS ARDIN, deliberately.
 *
 * Ardin appears because the workflow names him — "Ardin assigns an owner" — so
 * omitting him would obscure what the screen is depicting. No OTHER real
 * colleague appears, because every row here carries an invented weekly-hour
 * commitment, and a fabricated "5h/wk" beside a real person's name is the kind of
 * number that gets screenshotted into a workload conversation. Demo people cannot
 * be misread that way.
 */
async function sampleOffload(): Promise<OffloadRow[]> {
  return [
    {
      id: 'sample-1',
      task: 'Monthly inventory reconciliation',
      note: 'Surfaced by Damian — no owner named yet',
      ownerName: null,
      hoursPerWeek: 2,
      status: 'proposed'
    },
    {
      id: 'sample-2',
      task: 'Supplier check-in calls',
      note: 'Owner named; first call still sitting with Damian',
      ownerName: 'Demo Agent One',
      hoursPerWeek: 2,
      status: 'assigned'
    },
    {
      id: 'sample-3',
      task: 'Weekly ad-spend review',
      note: 'Ardin shadowing for two cycles before full handover',
      ownerName: 'Ardin',
      hoursPerWeek: 3,
      status: 'in_transition'
    },
    {
      id: 'sample-4',
      task: 'Creative approvals before publish',
      note: 'Damian removed from the approval path',
      ownerName: 'Demo Editor',
      hoursPerWeek: 4,
      status: 'handed_off'
    },
    {
      id: 'sample-5',
      task: 'Support escalation triage',
      note: 'Running unassisted for six weeks',
      ownerName: 'Demo Support Manager',
      hoursPerWeek: 5,
      status: 'handed_off'
    }
  ];
}

/**
 * The three headline counts, COMPUTED FROM THE ROWS THE TABLE RENDERS.
 *
 * ⚠️ THE NO-GHOST RULE APPLIES TO SAMPLE SURFACES TOO. Authoring the stats as
 * literals beside the rows would let them drift the moment a row is added or its
 * status edited — and a stat that disagrees with the table under it is read as a
 * data bug, not as a stale constant. Deriving them makes disagreement impossible.
 *
 * ⚠️ `assigned` AND `in_transition` BOTH COUNT AS "in transition". The workflow
 * has four stages and the mockup shows three stats, so one bucket spans two
 * stages. That fold lives HERE, once — the table still renders the two stages
 * distinctly, which is the honest arrangement: the summary is coarser than the
 * detail, rather than the detail being lost.
 */
function deriveStats(rows: OffloadRow[]): OffloadStats {
  return {
    proposed: rows.filter((r) => r.status === 'proposed').length,
    inTransition: rows.filter((r) => r.status === 'assigned' || r.status === 'in_transition')
      .length,
    handedOff: rows.filter((r) => r.status === 'handed_off').length
  };
}

/**
 * Everything the Founder offload page renders.
 *
 * ⚠️ NO `now` PARAMETER and no date on any row. Nothing here is time-dependent,
 * so there is no clock to thread and no hydration surface — same call as
 * `getPeopleOrg`. Do not add one "for consistency": an unused instant in a query
 * key is a cache that misses on the hour.
 *
 * ⚠️ ROLE GATE, INSIDE THE SERVICE — defence in depth, not the UX.
 *
 * The page guard (`requireRouteAccess`) already redirects an unauthorised reader.
 * It does NOT protect this function: `'use server'` publishes every export as its
 * own POST endpoint, reachable without ever loading the page. For the founder offload queue the
 * RETURN VALUE is the thing worth protecting, so the check belongs here too.
 *
 * ⚠️ Roles come from `ROUTE_ACCESS`, so this list cannot drift from the page's.
 */
export async function getFounderOffload(): Promise<FounderOffload> {
  await requireRole(rolesForRoute('/dashboard/founder-offload'), 'the founder offload queue');

  const rows = await sampleOffload();

  return {
    rows,
    stats: deriveStats(rows),
    isSample: true
  };
}
