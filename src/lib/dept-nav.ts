import 'server-only';

/**
 * The sidebar's Departments section — names, accents and health, in one query.
 *
 * ⚠️ `import 'server-only'` is the BOUNDARY GUARD. This module imports `db`, so a
 * `'use client'` file importing it drags `pg` into the browser bundle and the
 * build fails with seven Turbopack errors naming `dns`/`net`/`tls`/`fs` inside pg
 * internals — none of which mentions the import that caused it. With this marker
 * the build names the actual rule instead. Registered in
 * scripts/check-client-boundaries.ts alongside brief-fold and nav-counts.
 *
 * ⚠️ NOT `'use server'`. A plain module called BY the server sidebar, not a
 * Server Action — publishing it would give the browser an endpoint. It has no
 * auth of its own, so every caller must `auth()` first (the sidebar does, via
 * getCurrentActor).
 *
 * ⚠️ THIS IS `computeDeptHealth`'s FIRST CONSUMER. That function has been built
 * and unit-tested since 2026-08-06 with nothing calling it. Health is derived
 * here and stored nowhere: `department` deliberately has no `health` column,
 * because a stored status can disagree with the items it came from and the only
 * way to check would be re-deriving it — which is this.
 *
 * ⚠️ HEALTH FOLLOWS THE OWNER'S DEPARTMENT, not the item's project. An item moves
 * between departments when it is re-owned, which is the intended semantics
 * (a department is accountable for its people's work) and is easy to misread as
 * a bug when a card changes colour after a reassignment.
 *
 * ⚠️ REQUIRES MIGRATION 0011. `department` and `person.department_id` land in
 * `drizzle/0011_amused_slipstream.sql`, which is generated but NOT YET APPLIED.
 * Until it is applied and `pnpm db:seed` has run, this query throws and the
 * sidebar cannot render.
 */

import { cache } from 'react';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { department, person, trackedItem } from '@/db/schema';
import type { DeptType } from '@/db/schema/department';
import { departmentAccentVar } from './dept-accent';
import {
  computeDeptHealth,
  TERMINAL_STATUSES,
  type DeptHealthItem,
  type DeptHealthStatus
} from './dept-health';

export type DeptNavRow = {
  id: string;
  name: string;
  deptType: DeptType;
  /** Theme token reference, e.g. `var(--chart-3)`. Never a colour literal. */
  accentVar: string;
  health: DeptHealthStatus;
  /** Why, worst trigger first. The sidebar tooltip and the Control Tower note. */
  healthReasons: string[];
  /** Active (non-terminal) item count — i.e. open work. */
  activeItems: number;
  /** People assigned to this department. */
  peopleCount: number;
};

/**
 * The RAW per-department rows: one per (department × active item), LEFT JOINed.
 *
 * ⚠️ THIS IS THE SINGLE SOURCE OF TRUTH FOR DEPARTMENT WORK, and it is split out
 * from `getDeptNav` for exactly one reason: the sidebar health dot and the Control
 * Tower health card MUST NEVER DISAGREE. Two queries with the same intent drift —
 * one gets a filter the other does not, and then a department shows amber in the
 * rail and green on the card, and neither is obviously the wrong one.
 *
 * ⚠️ NO ARGUMENTS, so React's `cache()` actually memoises. `getDeptNav(now)` is
 * called by the sidebar and again by the home rollup within one request, each
 * with its own `Date` — different arguments, so a `cache()` on THAT function
 * would key twice and run the query twice. Keying on nothing means one round trip
 * per request no matter how many callers derive from it.
 *
 * ⚠️ LEFT JOINed all the way down, so a department with no people and a person
 * with no items both still produce a row. An INNER join would silently drop empty
 * departments — which reads as "that department was deleted" rather than "nobody
 * has open work there", and `good` is the correct, informative answer for an
 * empty department.
 */
const getDeptItems = cache(async () => {
  const rows = await db
    .select({
      id: department.id,
      name: department.name,
      deptType: department.deptType,
      // For the distinct people count. ⚠️ Counted in JS, not with SQL
      // count(distinct …): the join fans out one row per (department × item), so a
      // plain count would multiply a person by their item count.
      personId: person.id,
      status: trackedItem.status,
      dueDate: trackedItem.dueDate,
      riskFlag: trackedItem.riskFlag
    })
    .from(department)
    .leftJoin(person, eq(person.departmentId, department.id))
    .leftJoin(
      trackedItem,
      and(
        eq(trackedItem.ownerPersonId, person.id),
        // ⚠️ Filtered with the SAME constant computeDeptHealth uses, imported
        // rather than retyped. The function re-filters defensively, so the two
        // can never disagree — but a hand-written `not in ('done','cancelled')`
        // here would drift the day a terminal status is added.
        notInArray(trackedItem.status, [...TERMINAL_STATUSES])
      )
    )
    .orderBy(asc(department.name));

  // Group in JS rather than in SQL: health is a function, not an aggregate, and
  // expressing rule A as SQL would put the thresholds in two places.
  //
  // ⚠️ The LEFT JOIN types every tracked_item column as nullable even though
  // `status` and `risk_flag` are NOT NULL in the table — a null here means "this
  // department had no matching row", not "the column was empty". DeptHealthItem
  // tolerates a nullish riskFlag for exactly this reason, so no cast is needed.
  type Bucket = {
    id: string;
    name: string;
    deptType: DeptType;
    items: DeptHealthItem[];
    people: Set<string>;
  };

  const byDept = new Map<string, Bucket>();

  for (const r of rows) {
    let b = byDept.get(r.id);
    if (!b) {
      b = {
        id: r.id,
        name: r.name,
        deptType: r.deptType as DeptType,
        items: [],
        people: new Set()
      };
      byDept.set(r.id, b);
    }
    if (r.personId !== null) b.people.add(r.personId);
    if (r.status !== null) {
      b.items.push({ status: r.status, dueDate: r.dueDate, riskFlag: r.riskFlag });
    }
  }

  return [...byDept.values()];
});

/**
 * Every department with its computed health.
 *
 * ⚠️ THE ONLY WAY TO GET DEPARTMENT HEALTH. Both the sidebar's dot and the
 * Control Tower's card call this, so they share one query (via `getDeptItems`),
 * one accent function and one `computeDeptHealth` — they cannot disagree about a
 * department's state, which is the whole point of the split above.
 *
 * ⚠️ `now` is a parameter, never read from the clock here. Callers resolve it once
 * above their tree; see the note on `computeDeptHealth`. Two callers passing
 * `now` values milliseconds apart get identical answers because rule A compares
 * UTC DAY boundaries — the only instant where they could differ is the tick over
 * midnight UTC, which is accepted.
 */
export const getDeptNav = cache(async (now: Date): Promise<DeptNavRow[]> => {
  const buckets = await getDeptItems();

  return buckets.map((b) => {
    const { status, reasons } = computeDeptHealth(b.items, now);
    return {
      id: b.id,
      name: b.name,
      deptType: b.deptType,
      accentVar: departmentAccentVar(b.id),
      health: status,
      healthReasons: reasons,
      activeItems: b.items.length,
      peopleCount: b.people.size
    };
  });
});
