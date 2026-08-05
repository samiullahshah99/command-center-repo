// ============================================================
// Department detail Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
//
// READ-ONLY. This page observes; it has no mutations and must never gain one.
//
// ⚠️ ONE surface here is invented: the CX panel's agent FIGURES, from the shared
// `buildAgentPerformance` (Zendesk unbuilt). Everything else — health, stats,
// projects, items, risks, members, the brief backlog and the 6-week series — is a
// real query. See docs/gaps.md.
//
// ⚠️ ONE PRE-AGGREGATED CALL — `getDepartment(departmentId, now)`.
// ============================================================

'use server';

import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { department, person, project, role, trackedItem } from '@/db/schema';
import type { DeptType } from '@/db/schema/department';
import type { ProjectStatus } from '@/db/schema/project';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { buildAgentPerformance } from '@/lib/agent-performance';
import { foldBriefs } from '@/lib/brief-fold';
import { buildBriefBacklog, buildWeeklySeries } from '@/lib/brief-view';
import { departmentAccentVar } from '@/lib/dept-accent';
import { computeDeptHealth, TERMINAL_STATUSES } from '@/lib/dept-health';
import { getDeptItems } from '@/lib/dept-nav';
import { formatDateOnly } from '@/lib/format-date';
import { personAccentVar } from '@/lib/person-accent';
import type {
  BriefRow,
  DepartmentDetail,
  DeptItem,
  DeptProject,
  DeptRisk,
  WeeklyPerformanceView
} from './types';

/** Resource-based check on every export — a Server Action is its own endpoint. */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/** Canonical uuid shape. See the note in getDepartment. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RISK_CAP = 6;

/** Drizzle's execute() returns a driver result; both shapes are handled here. */
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}

function utcDay(x: Date): number {
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The department's brief backlog and its 6-week series.
 *
 * ⚠️ REAL, NOT MOCKED. Both come from `foldBriefs()`, which carries the mandatory
 * production filter — 12 of the stored Vision events are `development` and would
 * otherwise inflate every count here.
 *
 * ⚠️ NOT DEPARTMENT-FILTERED, and it cannot honestly be. A Vision brief has no
 * department: attribution runs brief → actor identity → person, and Vision
 * attribution is partial (0% for several sources). Filtering by the actor's
 * department would silently drop every brief whose actor is unlinked — which is
 * most of them — and present a short list as a complete one. So this panel shows
 * the company's brief pipeline on the creative department's page, which is where
 * the mockup puts it and is the only reading the data supports.
 */
async function buildBriefs(now: Date): Promise<{
  backlog: BriefRow[];
  performance: WeeklyPerformanceView;
}> {
  const folded = await foldBriefs();

  /**
   * Team-wide quota. ⚠️ NULL when nothing configures one — the case today, every
   * `quota_config` being `{}`. An unconfigured quota is not a zero quota.
   */
  const quotaRows = await db
    .select({ config: sql<unknown>`rp.quota_config` })
    .from(sql`role_profile rp`);

  let quota: number | null = null;
  for (const r of quotaRows) {
    const n = (r.config as { briefsPerWeek?: unknown } | null)?.briefsPerWeek;
    if (typeof n === 'number' && n > 0) quota = (quota ?? 0) + n;
  }

  // ⚠️ SHARED builders — the same ones Briefs & quota uses, so the two screens
  // cannot compute different backlogs or different weekly series.
  return {
    backlog: buildBriefBacklog(folded, now),
    performance: buildWeeklySeries(folded, now, quota)
  };
}

/**
 * Everything the Department page renders, in THREE queries plus the shared
 * dept-items call and (for creative) the shared brief fold.
 *
 * ⚠️ HEALTH AND STATS COME FROM `getDeptItems()` — the same query and the same
 * `computeDeptHealth()` call the sidebar dot, the Control Tower card and My team
 * use. Four surfaces, one path: they cannot disagree about a department's state.
 *
 * ⚠️ Returns null for an unknown id so the route can `notFound()`. The
 * `[departmentId]` param is untrusted input and must never reach a query as an
 * assumed-valid id.
 */
export async function getDepartment(
  departmentId: string,
  now: Date
): Promise<DepartmentDetail | null> {
  await requireUser();

  /**
   * ⚠️ SHAPE-CHECK BEFORE QUERYING. `departmentId` comes from the URL and Postgres
   * REJECTS a malformed uuid with `invalid input syntax for type uuid`, which
   * surfaces as a thrown error boundary rather than a 404. Returning null here
   * turns `/dashboard/departments/banana` into a clean not-found, which is what it
   * is. The `eq()` below is still parameterised — this is about the error shape,
   * not injection.
   */
  if (!UUID_RE.test(departmentId)) return null;

  // ── Validate the param resolves. An unknown id is a 404, not an empty page. ─
  const [dept] = await db
    .select({ id: department.id, name: department.name, deptType: department.deptType })
    .from(department)
    .where(eq(department.id, departmentId))
    .limit(1);

  if (!dept) return null;

  // ── Health + stats, from the shared source of truth. ──────────────────────
  const buckets = await getDeptItems();
  const bucket = buckets.find((b) => b.id === departmentId);
  const healthItems = bucket?.items ?? [];
  const { status: health, reasons: healthReasons } = computeDeptHealth(healthItems, now);

  const today = utcDay(now);
  const stats = {
    open: healthItems.length,
    overdue: healthItems.filter(
      (i) => i.dueDate !== null && utcDay(new Date(i.dueDate as Date)) < today
    ).length,
    blocked: healthItems.filter((i) => i.status === 'blocked').length,
    atRisk: healthItems.filter((i) => i.riskFlag).length,
    people: bucket?.people.size ?? 0
  };

  // ── Members, with their access-role label. ────────────────────────────────
  const memberRows = await db
    .select({ id: person.id, name: person.name, roleLabel: role.displayName })
    .from(person)
    .leftJoin(role, eq(role.id, person.roleId))
    .where(eq(person.departmentId, departmentId))
    .orderBy(asc(person.name));

  /**
   * ── The department's open items, with list columns.
   *
   * ⚠️ A SEPARATE QUERY from `getDeptItems`, deliberately. That one is called by
   * the sidebar on every dashboard page and stays narrow; this needs joins it
   * should not carry. Both filter identically using the SAME `TERMINAL_STATUSES`
   * constant — the part that could otherwise drift.
   */
  const itemRows = await db
    .select({
      id: trackedItem.id,
      title: trackedItem.title,
      projectId: trackedItem.projectId,
      projectName: project.name,
      projectStatus: project.status,
      projectLeadId: project.leadPersonId,
      status: trackedItem.status,
      dueDate: trackedItem.dueDate,
      riskFlag: trackedItem.riskFlag,
      ownerPersonId: trackedItem.ownerPersonId,
      ownerName: person.name
    })
    .from(trackedItem)
    .innerJoin(person, eq(person.id, trackedItem.ownerPersonId))
    .leftJoin(project, eq(project.id, trackedItem.projectId))
    .where(
      and(
        eq(person.departmentId, departmentId),
        notInArray(trackedItem.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(sql`${trackedItem.dueDate} asc nulls last`);

  /**
   * ── Per-project totals for THIS department, including terminal items.
   *
   * ⚠️ THE PROGRESS DENOMINATOR IS DEPT-SCOPED, NOT GLOBAL. "Resolved / total" here
   * counts only items owned by THIS department's people. The same project therefore
   * shows a DIFFERENT bar on a different department's page — which is intended: the
   * question this screen answers is "how far along is *this team's* work in that
   * project", not "how far along is the project".
   *
   * ⚠️ `resolved` counts terminal items — `done` AND `cancelled` — because the
   * available aggregate does not split them. A cancelled item genuinely is no longer
   * outstanding, so the bar reads "resolved", not strictly "done".
   */
  const projectRows = await db.execute(sql`
    select p.id,
           p.name,
           p.status,
           lead.name                                                   as lead_name,
           count(t.id)::int                                            as total_count,
           count(t.id) filter (
             where t.status not in ('done','cancelled')
           )::int                                                       as open_count
    from tracked_item t
    join person owner on owner.id = t.owner_person_id
    join project p on p.id = t.project_id
    left join person lead on lead.id = p.lead_person_id
    where owner.department_id = ${departmentId}
    group by p.id, p.name, p.status, lead.name
    having count(t.id) filter (where t.status not in ('done','cancelled')) > 0
    order by p.name
  `);
  const projectAgg = rowsOf<{
    id: string;
    name: string;
    status: string;
    lead_name: string | null;
    total_count: number;
    open_count: number;
  }>(projectRows);

  const projects: DeptProject[] = projectAgg.map((p) => ({
    id: p.id,
    name: p.name,
    leadName: p.lead_name,
    status: p.status as ProjectStatus,
    progressPct:
      p.total_count > 0 ? Math.round(((p.total_count - p.open_count) / p.total_count) * 100) : null,
    openCount: p.open_count,
    totalCount: p.total_count
  }));

  const items: DeptItem[] = itemRows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: r.projectName,
    status: r.status as TrackedItemStatus,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    riskFlag: r.riskFlag,
    ownerName: r.ownerName
  }));

  const isOverdue = (i: DeptItem) => i.dueDate !== null && utcDay(new Date(i.dueDate)) < today;

  /**
   * ⚠️ Risks are the troubled subset of the SAME array the detail rows come from,
   * not a second query. A risk panel that disagrees with the list beside it reads
   * as a ghost row.
   */
  const risks: DeptRisk[] = items
    .filter((i) => isOverdue(i) || i.status === 'blocked' || i.riskFlag)
    .toSorted((a, b) => {
      const rank = (x: DeptItem) => (isOverdue(x) ? 0 : x.status === 'blocked' ? 1 : 2);
      return rank(a) - rank(b);
    })
    .slice(0, RISK_CAP)
    .map((i) => {
      const overdue = isOverdue(i);
      const days = overdue
        ? Math.round((today - utcDay(new Date(i.dueDate as string))) / 86_400_000)
        : null;

      return {
        id: i.id,
        severity: (overdue || i.status === 'blocked' ? 'destructive' : 'warning') as
          | 'destructive'
          | 'warning',
        text: i.title ?? 'Title held in the source system',
        meta: [
          i.ownerName ?? 'Unowned',
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

  // Per-member open counts, from rows already fetched — no extra query.
  const openByPerson = new Map<string, number>();
  for (const r of itemRows) {
    if (r.ownerPersonId) {
      openByPerson.set(r.ownerPersonId, (openByPerson.get(r.ownerPersonId) ?? 0) + 1);
    }
  }

  const members = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    initials: initialsOf(m.name),
    accentVar: personAccentVar(m.id),
    roleLabel: m.roleLabel,
    openCount: openByPerson.get(m.id) ?? 0,
    // ⚠️ `?from=department` must be in the profile page's ALLOW-LIST or it falls
    // back to People & org. Added there deliberately.
    href: `/dashboard/people/${m.id}/profile?from=department`
  }));

  const deptType = dept.deptType as DeptType;

  /**
   * ⚠️ A DETERMINISTIC FACTUAL SENTENCE, not a generated summary. No model call, no
   * sample flag — every clause is a live count. `ai_summary` is keyed per
   * `person_id`; extending it to a polymorphic subject is backend work (audit
   * §1.3), and a fabricated department summary would be exactly the failure the
   * AI-summary rules exist to prevent.
   */
  const summary = [
    `${stats.people} ${stats.people === 1 ? 'person' : 'people'} · ${stats.open} open ${
      stats.open === 1 ? 'item' : 'items'
    } across ${projects.length} ${projects.length === 1 ? 'project' : 'projects'}.`,
    healthReasons.length > 0 ? `${healthReasons.join(' · ')}.` : 'No overdue or blocked work.'
  ].join(' ');

  return {
    department: {
      id: dept.id,
      name: dept.name,
      deptType,
      // Same accent function as the sidebar's dot — one hash, one palette.
      accentVar: departmentAccentVar(dept.id)
    },
    health,
    healthReasons,
    summary,
    stats,
    projects,
    items,
    risks,
    members,
    // Conditional panels, keyed on dept_type. Other types get neither.
    briefs: deptType === 'creative' ? await buildBriefs(now) : null,
    agents:
      deptType === 'cx'
        ? buildAgentPerformance(
            memberRows.map((m) => ({
              id: m.id,
              name: m.name,
              roleLabel: m.roleLabel,
              openCount: openByPerson.get(m.id) ?? 0
            }))
          )
        : null,
    now: now.toISOString()
  };
}
