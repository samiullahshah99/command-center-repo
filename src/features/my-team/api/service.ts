// ============================================================
// My team Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
//
// READ-ONLY. This page observes; it has no mutations and must never gain one.
//
// ⚠️ ONE surface here is invented: the Agent-performance FIGURES (Zendesk is
// unbuilt). The agents themselves, and everything else on the page, are real
// queries. See `buildAgentPerformance` and docs/gaps.md.
//
// ⚠️ ONE PRE-AGGREGATED CALL — `getMyTeam(departmentId, now)` returns everything
// the page renders. Do not add a second call for a new widget; extend this one.
// ============================================================

'use server';

import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { person, project, role, trackedItem } from '@/db/schema';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { departmentAccentVar } from '@/lib/dept-accent';
import { computeDeptHealth, TERMINAL_STATUSES } from '@/lib/dept-health';
import { getDeptItems } from '@/lib/dept-nav';
import { formatDateOnly } from '@/lib/format-date';

import type {
  AgentCadence,
  AgentPerformance,
  AgentRow,
  MyTeam,
  TeamItem,
  TeamMemberRow,
  TeamRisk
} from './types';

/** Resource-based check on every export — a Server Action is its own endpoint. */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/** Troubled rows shown in the At risk / blocked panel. */
const RISK_CAP = 6;

/**
 * ⚠️⚠️ THE ONE PLACE "TEAM" IS DEFINED — and it is a WORKING ASSUMPTION, not a
 * settled decision.
 *
 * **Open question (audit D2, team lead undecided):** is a team the same thing as a
 * department, or a sub-level inside one? The frontend contract says "team" on this
 * screen and on the capture-queue scoping rule, and "department" on the Control
 * Tower and Department screens, and nothing resolves which.
 *
 * Until it is resolved, **team ≡ the actor's department**. That is encoded HERE and
 * nowhere else, so a sub-team model is a change to this function plus whatever it
 * returns — not a hunt through five queries that each assumed a department id.
 *
 * ⚠️ Returns null rather than throwing when the actor has no department. That is an
 * ordinary state — a person can be onboarded before assignment — and the page
 * renders an explanation for it, not a stack trace.
 */
export async function resolveTeamScope(
  departmentId: string | null
): Promise<{ departmentId: string } | null> {
  await requireUser();
  return departmentId ? { departmentId } : null;
}

/**
 * TODO(backend): zendesk (audit §3.3).
 *
 * ⚠️ THE AGENTS ARE REAL; EVERY FIGURE IS INVENTED. Zendesk has **no code at all**
 * — no client, no credentials, no table — and `AgentPerformance` appears on three
 * screens in the contract, so this is the shape those will share.
 *
 * ⚠️ DERIVED FROM A REAL PER-PERSON COUNT so the numbers are stable per agent
 * rather than reshuffling on every reload. A figure that changes on refresh reads
 * as live telemetry. It is still invented; the caption is what makes that legible,
 * not the arithmetic.
 *
 * ⚠️ `cadence` here is ADHERENCE, not a schedule. See the note on `AgentCadence`.
 */
function buildAgentPerformance(
  members: { id: string; name: string; roleLabel: string | null; openCount: number }[]
): AgentPerformance {
  const rows: AgentRow[] = members.map((m, i) => {
    // Stable, bounded, and visibly synthetic-but-plausible.
    const tickets = 40 + ((i * 17 + m.openCount * 3) % 60);
    const resolved = Math.max(0, tickets - ((i * 5 + m.openCount) % 9));
    const csat = Number((4.2 + ((i * 3) % 7) / 10).toFixed(1));

    // Adherence follows the one REAL signal available: someone carrying more open
    // work than they are closing is "behind". That keeps the mocked column at
    // least directionally honest against data we do have.
    const cadence: AgentCadence =
      m.openCount >= 5 ? 'behind' : m.openCount <= 1 ? 'ahead' : 'on_track';

    return {
      personId: m.id,
      name: m.name,
      roleLabel: m.roleLabel,
      tickets,
      resolved,
      csat,
      cadence
    };
  });

  return { figuresAreSample: true, rows };
}

/** UTC day, for whole-day overdue comparisons. */
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
 * Stable per-person avatar tint, hashing the person's ID.
 *
 * ⚠️ Duplicated from the person profile's `personAccentVar` rather than imported:
 * that lives in a feature's constants folder and CLAUDE.md allows constants to
 * cross a boundary, but the moment a THIRD surface needs it the function belongs in
 * src/lib. Two copies is the point at which to notice, not yet to act — the
 * duplication is eight lines and the alternative is a premature move.
 */
function personAccentVar(personId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < personId.length; i += 1) {
    hash ^= personId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `var(--chart-${(hash % 5) + 1})`;
}

/**
 * Everything My team renders, in TWO queries plus the shared dept-items call.
 *
 * ⚠️ HEALTH AND THE STAT COUNTS COME FROM `getDeptItems()`, the same query and the
 * same `computeDeptHealth()` the sidebar dot and the Control Tower card use — so a
 * badge here cannot disagree with a dot there. The detailed rows below are a
 * SEPARATE query because they need columns rule A does not score (title, project,
 * owner); that is a different shape, not a duplicate.
 *
 * ⚠️ `now` is a PARAMETER, resolved once by the caller and threaded through, so
 * every overdue decision on the page derives from one instant.
 */
export async function getMyTeam(departmentId: string, now: Date): Promise<MyTeam> {
  await requireUser();

  // ── Health + counts, from the shared source of truth. ──────────────────────
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
    members: bucket?.people.size ?? 0
  };

  // ── Members, with their access-role label. ────────────────────────────────
  const memberRows = await db
    .select({
      id: person.id,
      name: person.name,
      roleLabel: role.displayName
    })
    .from(person)
    .leftJoin(role, eq(role.id, person.roleId))
    .where(eq(person.departmentId, departmentId))
    .orderBy(asc(person.name));

  /**
   * ── The team's open items, with the columns a list needs.
   *
   * ⚠️ A SEPARATE QUERY from `getDeptItems`, deliberately. That one is called on
   * every dashboard page by the sidebar, so it stays narrow; this one runs on one
   * page and can afford the joins. Both filter on the same
   * `person.department_id` + non-terminal status, using the SAME
   * `TERMINAL_STATUSES` constant — which is the part that could drift.
   */
  const itemRows = await db
    .select({
      id: trackedItem.id,
      title: trackedItem.title,
      projectId: trackedItem.projectId,
      projectName: project.name,
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

  const items: TeamItem[] = itemRows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: r.projectName,
    status: r.status as TrackedItemStatus,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    riskFlag: r.riskFlag,
    ownerPersonId: r.ownerPersonId,
    ownerName: r.ownerName
  }));

  const isOverdue = (i: TeamItem) => i.dueDate !== null && utcDay(new Date(i.dueDate)) < today;

  /**
   * Worst first: overdue, then blocked or at-risk, then the rest — and within a
   * rank the SQL's due-date order survives, because this sort is stable.
   */
  const rank = (i: TeamItem) => {
    if (isOverdue(i)) return 0;
    if (i.status === 'blocked' || i.riskFlag) return 1;
    return 2;
  };
  const ordered = items.toSorted((a, b) => rank(a) - rank(b));

  /**
   * ── Risks: the troubled subset of the SAME array the list renders.
   *
   * ⚠️ Not a second query. A risk panel that disagrees with the list beside it
   * reads as a ghost row, and two queries with the same intent are free to drift.
   */
  const risks: TeamRisk[] = ordered
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

  // Per-member open counts, from the rows already fetched — no third query.
  const openByPerson = new Map<string, number>();
  for (const i of items) {
    if (i.ownerPersonId)
      openByPerson.set(i.ownerPersonId, (openByPerson.get(i.ownerPersonId) ?? 0) + 1);
  }

  const members: TeamMemberRow[] = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    initials: initialsOf(m.name),
    accentVar: personAccentVar(m.id),
    roleLabel: m.roleLabel,
    openCount: openByPerson.get(m.id) ?? 0,
    // ⚠️ `?from=my-team` must be in the profile page's ALLOW-LIST or it silently
    // falls back to People & org. It was added there deliberately.
    href: `/dashboard/people/${m.id}/profile?from=my-team`
  }));

  /**
   * ⚠️ AGENTS = ALL department members, not only those with `role.code =
   * 'cx_agent'`.
   *
   * The seeded roster has cx_agent people in CX / Support, but a manager viewing a
   * department where nobody carries that role would get an EMPTY performance table,
   * which reads as a broken integration rather than as "no agents here". Showing
   * every member is the more useful default and matches what the brief permits.
   */
  const agents = buildAgentPerformance(
    memberRows.map((m) => ({
      id: m.id,
      name: m.name,
      roleLabel: m.roleLabel,
      openCount: openByPerson.get(m.id) ?? 0
    }))
  );

  return {
    department: {
      id: departmentId,
      name: bucket?.name ?? 'Your team',
      // Same accent function as the sidebar's dept dot — one hash, one palette.
      accentVar: departmentAccentVar(departmentId)
    },
    health,
    healthReasons,
    stats,
    agents,
    items: ordered,
    risks,
    members,
    now: now.toISOString()
  };
}
