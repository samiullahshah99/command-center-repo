// ============================================================
// My projects Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
//
// READ-ONLY. This page observes; it has no mutations and must never gain one.
//
// ⚠️ NOTHING ON THIS PAGE IS MOCKED. Every number is a real query. The one
// non-data element is the Slack-nudge STATUS NOTE in the UI, which states that an
// integration is missing rather than rendering invented activity — see the note in
// ../components/my-projects-body.tsx and docs/gaps.md.
// ============================================================

'use server';

import { and, eq, notInArray, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { project, trackedItem } from '@/db/schema';
import type { ProjectStatus } from '@/db/schema/project';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { TERMINAL_STATUSES } from '@/lib/dept-health';
import { formatDateOnly } from '@/lib/format-date';
import type { MyProject, MyProjectItem, MyProjectRisk, MyProjects } from './types';

/** Resource-based check on every export — a Server Action is its own endpoint. */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

const RISK_CAP = 6;

/** Drizzle's execute() returns a driver result; both shapes are handled here. */
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}

function utcDay(x: Date): number {
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/**
 * Human labels for `tracked_item.source_type`. Matches the person profile's and My
 * day's maps — all three derive the same four strings from the same Postgres enum.
 */
const SOURCE_LABEL: Record<string, string> = {
  meeting: 'Meeting',
  slack: 'Slack',
  manual: 'Manual',
  system: 'System'
};

/**
 * Everything My projects renders, in TWO queries.
 *
 * ⚠️ "MY PROJECTS" HAS TWO ARMS, and the second is easy to forget:
 *   1. projects where I own at least one NON-TERMINAL item, and
 *   2. projects where I am `lead_person_id`, even holding no items at all.
 *
 * Without arm 2 a lead who has delegated everything would see an empty page and
 * conclude the tracker had lost their project. Without arm 1 a contributor would
 * see nothing. The union is the honest answer to "what am I involved in".
 *
 * ⚠️ `now` is a PARAMETER, resolved once by the caller and threaded through, so
 * every overdue decision derives from one instant.
 *
 * ⚠️ Scoped by `personId`, which the caller resolves through `getCurrentActor()`.
 * This function never reads the session to decide whose projects these are —
 * taking the id explicitly keeps the scoping visible at the call site.
 */
export async function getMyProjects(personId: string, now: Date): Promise<MyProjects> {
  await requireUser();

  /**
   * ── 1. My items, with their project. Non-terminal only: the page is about
   *    what is outstanding, and a closed item is neither in flight nor at risk.
   *
   * ⚠️ `TERMINAL_STATUSES` is IMPORTED, not retyped — the same constant department
   * health, the tracker board and My day filter on. A hand-written
   * `not in ('done','cancelled')` here would drift the day a terminal status is
   * added, and drift silently.
   */
  const itemRows = await db
    .select({
      id: trackedItem.id,
      title: trackedItem.title,
      projectId: trackedItem.projectId,
      projectName: project.name,
      status: trackedItem.status,
      sourceType: trackedItem.sourceType,
      dueDate: trackedItem.dueDate,
      riskFlag: trackedItem.riskFlag
    })
    .from(trackedItem)
    .leftJoin(project, eq(project.id, trackedItem.projectId))
    .where(
      and(
        eq(trackedItem.ownerPersonId, personId),
        notInArray(trackedItem.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(sql`${trackedItem.dueDate} asc nulls last`);

  /**
   * ── 2. My projects and MY per-project totals.
   *
   * ⚠️ THE PROGRESS DENOMINATOR IS ME-SCOPED. "Resolved / total" counts only items
   * OWNED BY ME in that project — terminal ones included, which is why this cannot
   * be derived from query 1 above. So the same project shows a DIFFERENT bar here
   * than on a department page or the Control Tower, and that is intended: this
   * screen answers "how far along is *my* work in that project", following the
   * precedent set by the department page's dept-scoped denominator.
   *
   * ⚠️ `resolved` counts terminal items — `done` AND `cancelled`. A cancelled item
   * genuinely is no longer outstanding, so the bar reads "resolved", not strictly
   * "done".
   *
   * ⚠️ The WHERE clause'''s `p.lead_person_id = … OR EXISTS (…)` is what implements
   * arm 2, and the LEFT JOIN is what lets it survive: a project I lead with no items
   * of mine still produces a row, with zero counts and therefore a null bar.
   */
  const projectRes = await db.execute(sql`
    select p.id,
           p.name,
           p.status,
           lead.name                                                     as lead_name,
           count(t.id)::int                                              as total_count,
           count(t.id) filter (
             where t.status not in ('done','cancelled')
           )::int                                                         as open_count
    from project p
    left join person lead on lead.id = p.lead_person_id
    left join tracked_item t
      on t.project_id = p.id
     and t.owner_person_id = ${personId}
    where p.status <> 'archived'
      and (
        p.lead_person_id = ${personId}
        or exists (
          select 1 from tracked_item ti
          where ti.project_id = p.id
            and ti.owner_person_id = ${personId}
            and ti.status not in ('done','cancelled')
        )
      )
    group by p.id, p.name, p.status, lead.name
    order by p.name
  `);
  const projectAgg = rowsOf<{
    id: string;
    name: string;
    status: string;
    lead_name: string | null;
    total_count: number;
    open_count: number;
  }>(projectRes);

  const projects: MyProject[] = projectAgg.map((p) => ({
    id: p.id,
    name: p.name,
    leadName: p.lead_name,
    status: p.status as ProjectStatus,
    // Null, not 0, when I hold nothing here — see the note on MyProject.
    progressPct:
      p.total_count > 0 ? Math.round(((p.total_count - p.open_count) / p.total_count) * 100) : null,
    openCount: p.open_count,
    totalCount: p.total_count
  }));

  const today = utcDay(now);

  const items: MyProjectItem[] = itemRows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: r.projectName,
    status: r.status as TrackedItemStatus,
    // Unknown enum values fall back to the raw string rather than a blank pill — a
    // missing label is a mapping gap worth seeing.
    sourceLabel: SOURCE_LABEL[r.sourceType] ?? r.sourceType,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    riskFlag: r.riskFlag
  }));

  const isOverdue = (i: MyProjectItem) => i.dueDate !== null && utcDay(new Date(i.dueDate)) < today;

  /**
   * Worst first: overdue, then blocked or at-risk, then the rest. The sort is
   * stable, so the SQL's due-date order survives within a rank.
   */
  const rank = (i: MyProjectItem) => {
    if (isOverdue(i)) return 0;
    if (i.status === 'blocked' || i.riskFlag) return 1;
    return 2;
  };
  const ordered = items.toSorted((a, b) => rank(a) - rank(b));

  /**
   * ⚠️ Risks are the troubled subset of the SAME array the In-flight list renders,
   * not a second query. A risk panel that disagrees with the list beside it reads
   * as a ghost row.
   */
  const risks: MyProjectRisk[] = ordered
    .filter((i) => isOverdue(i) || i.status === 'blocked' || i.riskFlag)
    .slice(0, RISK_CAP)
    .map((i) => {
      const overdue = isOverdue(i);
      const days = overdue
        ? Math.round((today - utcDay(new Date(i.dueDate as string))) / 86_400_000)
        : null;

      return {
        id: i.id,
        // Overdue and blocked both mean "stuck now"; at-risk is a warning.
        severity: (overdue || i.status === 'blocked' ? 'destructive' : 'warning') as
          | 'destructive'
          | 'warning',
        text: i.title ?? 'Title held in the source system',
        meta: [
          i.projectName ?? 'Unfiled',
          overdue
            ? `${days} day${days === 1 ? '' : 's'} overdue`
            : i.status === 'blocked'
              ? 'blocked'
              : 'flagged at risk',
          i.dueDate && !overdue ? `due ${formatDateOnly(i.dueDate)}` : null
        ]
          .filter(Boolean)
          .join(' · '),
        href: i.projectId ? `/dashboard/tracker/${i.projectId}` : '/dashboard/tracker'
      };
    });

  return {
    stats: {
      projects: projects.length,
      open: items.length,
      overdue: items.filter(isOverdue).length,
      inFlight: items.filter((i) => i.status === 'in_progress').length,
      // ⚠️ Counted ONCE each, not summed: an item that is both blocked and
      // risk-flagged would otherwise inflate the number it appears in.
      troubled: items.filter((i) => i.status === 'blocked' || i.riskFlag).length
    },
    projects,
    items: ordered,
    risks,
    now: now.toISOString()
  };
}
