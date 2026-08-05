// ============================================================
// People Service — Data Access Layer
// ============================================================
// Pattern 1 from src/features/products/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED, not stylistic. queries.ts is consumed on both sides
// of the SSR handoff — the server prefetches, and every `shallow: true` nuqs
// filter change re-runs the same queryFn in the BROWSER. Drizzle and `pg`
// cannot run there, so these functions have to be callable as RPC.
//
// Every export in this file must be an async function ('use server' contract).
// Types live in ./types.ts for that reason.
// ============================================================

'use server';

import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import {
  candidateActionItem,
  person,
  personIdentity,
  roleProfile,
  unifiedEvent
} from '@/db/schema';
import {
  BOARD_SOURCES,
  type ActivityDay,
  type BoardSource,
  type IdentityBadge,
  type PeopleBoardResponse,
  type PeopleResponse,
  type PersonBoardRow,
  type PersonByIdResponse,
  type PersonFilters,
  type PersonMutationPayload,
  type PersonPanel,
  type RoleProfileOption
} from './types';

/**
 * ⚠️ ADDED, and it was missing — every export in this file was an UNAUTHENTICATED
 * endpoint until now, including `createPerson` and `updatePerson`.
 *
 * `'use server'` publishes each of these as its own POST route. `src/proxy.ts`
 * guards the /dashboard PAGES, but a Server Action is not a page, and
 * `createRouteMatcher` is deprecated precisely because its path matching can
 * diverge from how Next.js actually routes. So the roster was readable and
 * writable without a session. CLAUDE.md requires per-action auth; the tracker
 * and identities services already do this and this one did not.
 */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/**
 * ⚠️ `slackId` / `clickupId` removed as sort keys — the columns they sorted are
 * gone from the UI (superseded by person_identity). Sorting is deliberately
 * limited to name/role/createdAt: this is a visibility tool for a seven-person
 * team, and an activity-based sort turns it into a leaderboard.
 */
const SORTABLE = {
  name: person.name,
  createdAt: person.createdAt
} as const;

const SELECTION = {
  id: person.id,
  name: person.name,
  // The resolver's only automatic cross-system join key — see person.email.
  email: person.email,
  roleProfileId: person.roleProfileId,
  // ⚠️ TWO DIFFERENT AXES, both required by `PersonRow` (= `Person & …`).
  // `roleProfileId` above is work config (tracked signals + quota); `roleId` is
  // ACCESS. See the header on src/db/schema/role.ts — they must not be merged.
  roleId: person.roleId,
  departmentId: person.departmentId,
  slackId: person.slackId,
  clickupId: person.clickupId,
  portalId: person.portalId,
  createdAt: person.createdAt,
  updatedAt: person.updatedAt,
  roleProfileName: roleProfile.name
};

function buildWhere(filters: PersonFilters) {
  const clauses = [];

  if (filters.search?.trim()) {
    clauses.push(ilike(person.name, `%${filters.search.trim()}%`));
  }

  if (filters.roleProfiles?.trim()) {
    const ids = filters.roleProfiles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 0) clauses.push(inArray(person.roleProfileId, ids));
  }

  return clauses.length > 0 ? and(...clauses) : undefined;
}

function buildOrderBy(sort?: string) {
  // Default ordering. Without a stable ORDER BY, Postgres may return rows in a
  // different order per page and pagination silently duplicates or skips rows.
  const fallback = [asc(person.name)];
  if (!sort) return fallback;

  try {
    const parsed = JSON.parse(sort) as { id: string; desc: boolean }[];
    const mapped = parsed
      .filter((s) => s.id in SORTABLE)
      .map((s) => {
        const col = SORTABLE[s.id as keyof typeof SORTABLE];
        return s.desc ? desc(col) : asc(col);
      });
    return mapped.length > 0 ? mapped : fallback;
  } catch {
    return fallback;
  }
}

export async function getPeople(filters: PersonFilters): Promise<PeopleResponse> {
  await requireUser();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));
  const offset = (page - 1) * limit;
  const where = buildWhere(filters);

  const rows = await db
    .select(SELECTION)
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(where)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(limit)
    .offset(offset);

  // Counted with the same WHERE but no join/limit, so pageCount reflects the
  // filtered total rather than the current page.
  const [totals] = await db.select({ value: count() }).from(person).where(where);

  return {
    people: rows,
    total_people: Number(totals?.value ?? 0),
    offset,
    limit
  };
}

/** How many days the sparkline covers. */
const ACTIVITY_WINDOW_DAYS = 14;

/** UTC day key, matching what `date_trunc('day', …)` returns. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The people board.
 *
 * ⚠️ THREE AGGREGATES, EACH ONE QUERY ACROSS ALL PEOPLE — never per row. This
 * function re-runs in the BROWSER as an RPC on every nuqs filter change (see the
 * header note), so an N+1 here would be N+1 round trips over the network on
 * every keystroke, not just N+1 SQL statements.
 *
 * Row counts make the shape safe: 7 people, 19 identities, 286 events, 19
 * candidates. The identity and activity aggregates are small enough to fetch
 * whole and group in JS, which is cheaper than correlated subqueries per person.
 */
export async function getPeopleBoard(filters: PersonFilters): Promise<PeopleBoardResponse> {
  await requireUser();

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const offset = (page - 1) * limit;
  const where = buildWhere(filters);

  // ⚠️ Resolved ONCE, here, and returned to the client. Every relative time and
  // the whole 14-day window derive from this single instant — see the note on
  // PeopleBoardResponse.now.
  const now = new Date();
  const windowStart = new Date(now.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * 86400000);

  const rows = await db
    .select(SELECTION)
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(where)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(limit)
    .offset(offset);

  const [totals] = await db.select({ value: count() }).from(person).where(where);

  // ── 1. Identities. Whole table (19 rows); grouped by person in JS. ─────────
  const identityRows = await db
    .select({
      personId: personIdentity.personId,
      source: personIdentity.source,
      confidence: personIdentity.confidence,
      linkedBy: personIdentity.linkedBy,
      linkedAt: personIdentity.linkedAt
    })
    .from(personIdentity);

  // ── 2. Activity: one GROUP BY over the window, plus one last-seen pass. ────
  const activityRows = await db
    .select({
      personId: unifiedEvent.personId,
      day: sql<string>`to_char(date_trunc('day', ${unifiedEvent.occurredAt}), 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`
    })
    .from(unifiedEvent)
    .where(
      and(
        sql`${unifiedEvent.personId} is not null`,
        sql`${unifiedEvent.occurredAt} >= ${windowStart.toISOString()}`
      )
    )
    .groupBy(unifiedEvent.personId, sql`date_trunc('day', ${unifiedEvent.occurredAt})`);

  /**
   * Last seen is a SEPARATE query and deliberately NOT limited to the window:
   * "no activity in 14 days" and "never seen" are different facts, and a person
   * whose last event was five weeks ago should read as five weeks ago rather
   * than as nothing at all.
   *
   * DISTINCT ON is the index-friendly form here — it walks
   * unified_event_person_occurred_idx (person_id, occurred_at desc) and stops at
   * the first row per person.
   */
  const lastSeenRes = await db.execute(sql`
    select distinct on (person_id) person_id, source, occurred_at
    from ${unifiedEvent}
    where person_id is not null
    order by person_id, occurred_at desc
  `);
  const lastSeenRows = ((lastSeenRes as unknown as { rows?: unknown[] }).rows ??
    (lastSeenRes as unknown as unknown[])) as {
    person_id: string;
    source: string;
    occurred_at: string | Date;
  }[];

  /**
   * Page-level: identity rows nobody has claimed. One GROUP BY, not per person —
   * by the attribution CHECK these rows have no person_id at all, so they cannot
   * belong to a row on this board.
   */
  const unattributedRows = await db
    .select({ source: personIdentity.source, n: sql<number>`count(*)::int` })
    .from(personIdentity)
    .where(sql`${personIdentity.personId} is null`)
    .groupBy(personIdentity.source)
    .orderBy(desc(sql`count(*)`));

  // ── 3. Pending candidates by owner + attribution strength. ────────────────
  const itemRows = await db
    .select({
      ownerPersonId: candidateActionItem.ownerPersonId,
      ownerConfidence: candidateActionItem.ownerConfidence,
      n: sql<number>`count(*)::int`
    })
    .from(candidateActionItem)
    .where(
      and(
        eq(candidateActionItem.reviewStatus, 'pending'),
        sql`${candidateActionItem.ownerPersonId} is not null`
      )
    )
    .groupBy(candidateActionItem.ownerPersonId, candidateActionItem.ownerConfidence);

  // ── Fold into rows ────────────────────────────────────────────────────────

  const identityByPerson = new Map<string, typeof identityRows>();
  for (const r of identityRows) {
    if (!r.personId) continue;
    const list = identityByPerson.get(r.personId) ?? [];
    list.push(r);
    identityByPerson.set(r.personId, list);
  }

  const activityByPerson = new Map<string, Map<string, number>>();
  for (const r of activityRows) {
    if (!r.personId) continue;
    const m = activityByPerson.get(r.personId) ?? new Map<string, number>();
    m.set(r.day, r.n);
    activityByPerson.set(r.personId, m);
  }

  const lastSeenByPerson = new Map<string, { source: string; at: string }>();
  for (const r of lastSeenRows) {
    lastSeenByPerson.set(r.person_id, {
      source: r.source,
      at: new Date(r.occurred_at).toISOString()
    });
  }

  const itemsByPerson = new Map<string, { total: number; weak: number }>();
  for (const r of itemRows) {
    if (!r.ownerPersonId) continue;
    const acc = itemsByPerson.get(r.ownerPersonId) ?? { total: 0, weak: 0 };
    acc.total += r.n;
    // 'fuzzy' and 'unresolved' are the weak tiers — a human has not confirmed
    // this owner, so the count is provisional and says so.
    if (r.ownerConfidence === 'fuzzy' || r.ownerConfidence === 'unresolved') acc.weak += r.n;
    itemsByPerson.set(r.ownerPersonId, acc);
  }

  // Zero-filled day keys, oldest → newest. The bar chart needs every day present
  // or the shape lies about which days were quiet.
  const dayKeys: string[] = [];
  for (let i = 0; i < ACTIVITY_WINDOW_DAYS; i++) {
    dayKeys.push(dayKey(new Date(windowStart.getTime() + i * 86400000)));
  }

  const people: PersonBoardRow[] = rows.map((p) => {
    const mine = identityByPerson.get(p.id) ?? [];
    const bySource = new Map<string, typeof mine>();
    for (const r of mine) {
      const l = bySource.get(r.source) ?? [];
      l.push(r);
      bySource.set(r.source, l);
    }

    const identities: IdentityBadge[] = BOARD_SOURCES.map((source: BoardSource) => {
      const found = bySource.get(source) ?? [];
      if (found.length === 0) {
        return {
          source,
          state: 'absent' as const,
          confidence: null,
          linkedAt: null,
          linkedBy: null,
          count: 0
        };
      }
      // Strongest wins when a person has several rows for one source.
      const strongest =
        found.find((f) => f.confidence === 'exact' || f.confidence === 'email') ??
        found.find((f) => f.confidence === 'manual') ??
        found[0];
      // Per person_identity_attribution_ck, an attributed row always has a
      // confidence, so there is no null branch to handle here.
      const state =
        strongest.confidence === 'exact' || strongest.confidence === 'email'
          ? ('linked_strong' as const)
          : ('linked_manual' as const);
      return {
        source,
        state,
        confidence: strongest.confidence,
        linkedAt: strongest.linkedAt ? new Date(strongest.linkedAt).toISOString() : null,
        linkedBy: strongest.linkedBy,
        count: found.length
      };
    });

    const counts = activityByPerson.get(p.id);
    const activity: ActivityDay[] = dayKeys.map((day) => ({
      day,
      count: counts?.get(day) ?? 0
    }));
    const items = itemsByPerson.get(p.id);

    return {
      ...p,
      identities,
      activity,
      activityTotal: activity.reduce((s, d) => s + d.count, 0),
      lastSeen: lastSeenByPerson.get(p.id) ?? null,
      pendingCount: items?.total ?? 0,
      pendingNeedsReview: items?.weak ?? 0
    };
  });

  return {
    people,
    total_people: Number(totals?.value ?? 0),
    offset,
    limit,
    now: now.toISOString(),
    unattributed: unattributedRows.map((r) => ({ source: r.source, count: r.n }))
  };
}

/**
 * Expand-panel data for ONE person. Called on expand, never with the page —
 * the board fetches nothing per row.
 */
export async function getPersonPanel(personId: string): Promise<PersonPanel> {
  await requireUser();

  const identities = await db
    .select({
      id: personIdentity.id,
      source: personIdentity.source,
      externalId: personIdentity.externalId,
      email: personIdentity.email,
      displayName: personIdentity.displayName,
      confidence: personIdentity.confidence,
      linkedBy: personIdentity.linkedBy,
      linkedAt: personIdentity.linkedAt
    })
    .from(personIdentity)
    .where(eq(personIdentity.personId, personId))
    .orderBy(asc(personIdentity.source));

  const events = await db
    .select({
      id: unifiedEvent.id,
      source: unifiedEvent.source,
      eventType: unifiedEvent.eventType,
      occurredAt: unifiedEvent.occurredAt,
      subjectLabel: unifiedEvent.subjectLabel
    })
    .from(unifiedEvent)
    .where(eq(unifiedEvent.personId, personId))
    .orderBy(desc(unifiedEvent.occurredAt))
    .limit(10);

  // description + source_span only. NO payload contents ever reach the client.
  const items = await db
    .select({
      id: candidateActionItem.id,
      description: candidateActionItem.description,
      sourceSpan: candidateActionItem.sourceSpan,
      ownerConfidence: candidateActionItem.ownerConfidence,
      confidence: candidateActionItem.confidence
    })
    .from(candidateActionItem)
    .where(
      and(
        eq(candidateActionItem.ownerPersonId, personId),
        eq(candidateActionItem.reviewStatus, 'pending')
      )
    )
    .orderBy(desc(candidateActionItem.confidence));

  return {
    identities: identities.map((i) => ({
      ...i,
      linkedAt: i.linkedAt ? new Date(i.linkedAt).toISOString() : null
    })),
    events: events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt).toISOString() })),
    items,
    now: new Date().toISOString()
  };
}

export async function getPersonById(id: string): Promise<PersonByIdResponse> {
  await requireUser();
  const [row] = await db
    .select(SELECTION)
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(eq(person.id, id))
    .limit(1);

  return { success: Boolean(row), person: row ?? null };
}

/** Role profiles as select/filter options. Dynamic, unlike the template's static CATEGORY_OPTIONS. */
export async function getRoleProfileOptions(): Promise<RoleProfileOption[]> {
  await requireUser();
  const rows = await db
    .select({ value: roleProfile.id, label: roleProfile.name })
    .from(roleProfile)
    .orderBy(asc(roleProfile.name));
  return rows;
}

export async function createPerson(data: PersonMutationPayload) {
  await requireUser();
  const [created] = await db.insert(person).values(data).returning({ id: person.id });
  return { success: true, id: created.id };
}

export async function updatePerson(id: string, data: PersonMutationPayload) {
  await requireUser();
  await db.update(person).set(data).where(eq(person.id, id));
  return { success: true, id };
}
