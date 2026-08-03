// ============================================================
// Tracker Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/identities/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED. queries.ts is consumed on both sides of the SSR
// handoff — the server prefetches, and the browser re-runs the same queryFn on
// invalidation after an inline edit, where Drizzle and `pg` cannot run.
//
// Every export must be an async function ('use server' contract). Types live in
// ./types.ts for that reason.
// ============================================================

'use server';

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { candidateActionItem, person, project, trackedItem } from '@/db/schema';
import { TRACKED_ITEM_STATUSES, type TrackedItemStatus } from '@/db/schema/tracked-item';
import {
  updateItemDueDateSchema,
  updateItemOwnerSchema,
  updateItemStatusSchema
} from '../schemas/tracker';
import type {
  BoardGroup,
  BoardItem,
  BoardResponse,
  ExternalSystem,
  OwnerConfidence,
  PersonRef,
  ProjectListResponse,
  ProjectRollup,
  ProjectStatus,
  UpdateItemResult
} from './types';

/**
 * ⚠️ Resource-based auth on EVERY export, not a reliance on src/proxy.ts.
 *
 * The matcher protects the /dashboard pages, but a Server Action is its own POST
 * endpoint, and `createRouteMatcher` is deprecated precisely because its path
 * matching can diverge from how Next.js routes. These read and MUTATE real work
 * data, so they check for themselves.
 */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/** Statuses that mean "no longer needs attention". */
const TERMINAL: TrackedItemStatus[] = ['done', 'cancelled'];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function personRef(id: string | null, name: string | null): PersonRef | null {
  if (!id || !name) return null;
  return { id, name, initials: initialsOf(name) };
}

// ── Project list ────────────────────────────────────────────────────────────

/**
 * Projects with their rollups.
 *
 * Counts are correlated subqueries rather than a GROUP BY join: an inner join
 * would drop projects with no items, and a project with nothing in it is exactly
 * the one a lead needs to see.
 */
export async function getProjects(): Promise<ProjectListResponse> {
  await requireUser();

  const terminal = sql.raw(`('${TERMINAL.join("','")}')`);

  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      externalSystem: project.externalSystem,
      externalId: project.externalId,
      leadId: person.id,
      leadName: person.name,
      totalCount: sql<number>`(
        select count(*)::int from ${trackedItem} ti where ti.project_id = ${project.id}
      )`,
      openCount: sql<number>`(
        select count(*)::int from ${trackedItem} ti
        where ti.project_id = ${project.id} and ti.status not in ${terminal}
      )`,
      overdueCount: sql<number>`(
        select count(*)::int from ${trackedItem} ti
        where ti.project_id = ${project.id}
          and ti.status not in ${terminal}
          and ti.due_date is not null
          and ti.due_date < now()
      )`,
      // Pending candidates reachable from this project's items. A COUNT ONLY —
      // the review queue is a later increment and this links nowhere yet.
      needsReviewCount: sql<number>`(
        select count(*)::int from ${candidateActionItem} c
        where c.review_status = 'pending'
          and c.id in (
            select ti.candidate_action_item_id from ${trackedItem} ti
            where ti.project_id = ${project.id} and ti.candidate_action_item_id is not null
          )
      )`
    })
    .from(project)
    .leftJoin(person, eq(person.id, project.leadPersonId))
    .orderBy(asc(project.name));

  const unassigned = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(candidateActionItem)
    .where(
      and(
        eq(candidateActionItem.reviewStatus, 'pending'),
        sql`not exists (
          select 1 from ${trackedItem} ti
          where ti.candidate_action_item_id = ${candidateActionItem.id}
        )`
      )
    );

  const projects: ProjectRollup[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status as ProjectStatus,
    lead: personRef(r.leadId, r.leadName),
    externalSystem: (r.externalSystem as ExternalSystem | null) ?? null,
    externalId: r.externalId,
    openCount: r.openCount,
    overdueCount: r.overdueCount,
    needsReviewCount: r.needsReviewCount,
    totalCount: r.totalCount
  }));

  return { projects, unassignedNeedsReview: unassigned[0]?.n ?? 0 };
}

// ── Board ───────────────────────────────────────────────────────────────────

const boardSelect = {
  id: trackedItem.id,
  title: trackedItem.title,
  description: trackedItem.description,
  status: trackedItem.status,
  dueDate: trackedItem.dueDate,
  sourceSystem: trackedItem.sourceSystem,
  sourceType: trackedItem.sourceType,
  externalTaskId: trackedItem.externalTaskId,
  riskFlag: trackedItem.riskFlag,
  updatedAt: trackedItem.updatedAt,
  ownerId: person.id,
  ownerName: person.name,
  originOwnerConfidence: candidateActionItem.ownerConfidence
};

function toBoardItem(r: Record<string, unknown>): BoardItem {
  return {
    id: r.id as string,
    title: (r.title as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    status: r.status as TrackedItemStatus,
    owner: personRef(r.ownerId as string | null, r.ownerName as string | null),
    dueDate: r.dueDate ? (r.dueDate as Date).toISOString() : null,
    sourceSystem: r.sourceSystem as ExternalSystem,
    sourceType: r.sourceType as string,
    externalTaskId: (r.externalTaskId as string | null) ?? null,
    originOwnerConfidence: (r.originOwnerConfidence as OwnerConfidence | null) ?? null,
    riskFlag: Boolean(r.riskFlag),
    updatedAt: (r.updatedAt as Date).toISOString()
  };
}

/**
 * One project's items, grouped by status.
 *
 * ⚠️ EVERY status group is returned, including empty ones. A Monday-style board
 * is a set of lanes; a lane that vanishes when it empties makes the board's
 * shape change under the user and removes the drop target they were aiming for.
 */
export async function getBoard(projectId: string): Promise<BoardResponse | null> {
  await requireUser();

  const [p] = await db
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      leadId: person.id,
      leadName: person.name
    })
    .from(project)
    .leftJoin(person, eq(person.id, project.leadPersonId))
    .where(eq(project.id, projectId))
    .limit(1);

  if (!p) return null;

  const rows = await db
    .select(boardSelect)
    .from(trackedItem)
    .leftJoin(person, eq(person.id, trackedItem.ownerPersonId))
    .leftJoin(candidateActionItem, eq(candidateActionItem.id, trackedItem.candidateActionItemId))
    .where(eq(trackedItem.projectId, projectId))
    // Nulls last so undated work does not sit above things with real deadlines.
    .orderBy(sql`${trackedItem.dueDate} asc nulls last`, desc(trackedItem.updatedAt));

  const items = rows.map((r) => toBoardItem(r as Record<string, unknown>));

  const groups: BoardGroup[] = TRACKED_ITEM_STATUSES.map((status) => ({
    status,
    items: items.filter((i) => i.status === status)
  }));

  const rosterRows = await db
    .select({ id: person.id, name: person.name })
    .from(person)
    .orderBy(asc(person.name));

  return {
    project: {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status as ProjectStatus,
      lead: personRef(p.leadId, p.leadName)
    },
    groups,
    roster: rosterRows.map((r) => ({ ...r, initials: initialsOf(r.name) })),
    totalCount: items.length
  };
}

// ── Inline edits ────────────────────────────────────────────────────────────

/** Re-read one row in the board's shape, so a mutation can return the truth. */
async function readItem(itemId: string): Promise<BoardItem | null> {
  const [row] = await db
    .select(boardSelect)
    .from(trackedItem)
    .leftJoin(person, eq(person.id, trackedItem.ownerPersonId))
    .leftJoin(candidateActionItem, eq(candidateActionItem.id, trackedItem.candidateActionItemId))
    .where(eq(trackedItem.id, itemId))
    .limit(1);
  return row ? toBoardItem(row as Record<string, unknown>) : null;
}

/**
 * ⚠️ Every mutation validates with the SAME Zod schema the table mirrors, on the
 * SERVER. The optimistic UI updates before this returns, so if validation lived
 * only on the client an invalid value would be visible, then silently revert —
 * the user would see their edit "stick" and then undo itself with no reason
 * given.
 */
export async function updateItemStatus(input: unknown): Promise<UpdateItemResult> {
  await requireUser();

  const parsed = updateItemStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid status' };
  }

  await db
    .update(trackedItem)
    .set({ status: parsed.data.status, lastUpdateAt: new Date() })
    .where(eq(trackedItem.id, parsed.data.itemId));

  const item = await readItem(parsed.data.itemId);
  return item ? { ok: true, item } : { ok: false, message: 'Item not found' };
}

export async function updateItemOwner(input: unknown): Promise<UpdateItemResult> {
  await requireUser();

  const parsed = updateItemOwnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid owner' };
  }

  // ⚠️ The person must exist. The FK would catch a bad id, but as a 500 with a
  // Postgres message — this returns something a UI can show.
  if (parsed.data.ownerPersonId) {
    const [exists] = await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.id, parsed.data.ownerPersonId))
      .limit(1);
    if (!exists) return { ok: false, message: 'That person no longer exists' };
  }

  await db
    .update(trackedItem)
    .set({ ownerPersonId: parsed.data.ownerPersonId, lastUpdateAt: new Date() })
    .where(eq(trackedItem.id, parsed.data.itemId));

  const item = await readItem(parsed.data.itemId);
  return item ? { ok: true, item } : { ok: false, message: 'Item not found' };
}

export async function updateItemDueDate(input: unknown): Promise<UpdateItemResult> {
  await requireUser();

  const parsed = updateItemDueDateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid due date' };
  }

  // The column is timestamptz; the UI works in whole days. Anchored at UTC
  // midnight so it round-trips through formatDueDate unchanged — a local-midnight
  // value would render as the previous day for anyone west of UTC.
  const due = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00Z`) : null;

  await db
    .update(trackedItem)
    .set({ dueDate: due, lastUpdateAt: new Date() })
    .where(eq(trackedItem.id, parsed.data.itemId));

  const item = await readItem(parsed.data.itemId);
  return item ? { ok: true, item } : { ok: false, message: 'Item not found' };
}
