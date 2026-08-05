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
  /** Why, worst trigger first. Rendered as the row's title attribute. */
  healthReasons: string[];
  /** Active (non-terminal) item count, for the tooltip. */
  activeItems: number;
};

/**
 * Every department with its computed health.
 *
 * ⚠️ MEMOISED PER REQUEST with React's `cache()`, not `unstable_cache`. The
 * sidebar renders on every dashboard page, so without memoisation a page with
 * nested server components would repeat the join; with a cross-request cache,
 * health would go stale exactly when someone is watching it change. `nav-counts`
 * may use `unstable_cache` because two integers tolerate a 60s lag — a red
 * department card does not.
 *
 * ⚠️ ONE query, LEFT JOINed all the way down, so a department with no people and
 * a person with no items both still produce a row. An INNER join would silently
 * drop empty departments from the sidebar — which reads as "that department was
 * deleted" rather than "nobody has open work there", and `good` is the correct,
 * informative answer for an empty department.
 */
export const getDeptNav = cache(async (now: Date): Promise<DeptNavRow[]> => {
  const rows = await db
    .select({
      id: department.id,
      name: department.name,
      deptType: department.deptType,
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
  const meta = new Map<string, Omit<DeptNavRow, 'health' | 'healthReasons' | 'activeItems'>>();
  const items = new Map<string, DeptHealthItem[]>();

  for (const r of rows) {
    if (!meta.has(r.id)) {
      meta.set(r.id, {
        id: r.id,
        name: r.name,
        deptType: r.deptType as DeptType,
        accentVar: departmentAccentVar(r.id)
      });
      items.set(r.id, []);
    }
    if (r.status !== null) {
      items.get(r.id)!.push({ status: r.status, dueDate: r.dueDate, riskFlag: r.riskFlag });
    }
  }

  return [...meta.values()].map((d) => {
    const own = items.get(d.id) ?? [];
    const { status, reasons } = computeDeptHealth(own, now);
    return { ...d, health: status, healthReasons: reasons, activeItems: own.length };
  });
});
