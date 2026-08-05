/**
 * App sidebar — the SERVER half.
 *
 * ⚠️ NO `'use client'`, deliberately, and this is the whole point of the split.
 * Three things have to happen before any markup exists:
 *
 *   1. resolve the actor (one `getCurrentActor()`, memoised per request)
 *   2. filter the nav by `role.code` SERVER-SIDE, so a role's items never reach
 *      the browser at all
 *   3. run the department health join once
 *
 * Doing any of that in a client component would mean either shipping the whole
 * nav and hiding parts with CSS, or a per-render DB round trip. The interactive
 * half — active row from `usePathname`, Clerk `signOut` — lives in
 * ./sidebar-shell.tsx and receives plain serialisable props.
 *
 * ⚠️ HIDING IS NOT AUTHORISATION. Filtering here controls what renders. Every
 * route behind these URLs still does its own `requireUser()`; a hidden item whose
 * URL is typed must be refused by the page, not by the nav's absence.
 */

import { DEPARTMENTS_SECTION_ROLES, navGroups } from '@/config/nav-config';
import { getCurrentActor } from '@/lib/current-actor';
import { getDeptNav } from '@/lib/dept-nav';
import type { NavGroup } from '@/types';
import type { RoleCode } from '@/db/schema/role';
import { SidebarShell } from './sidebar-shell';

/**
 * Keep the items this role may see, and drop a group that empties out.
 *
 * ⚠️ DENY BY DEFAULT. An item carrying `roles` is hidden when `roleCode` is null —
 * a signed-in user not yet linked to a roster person, or a person with no
 * `role_id`. Treating null as "show everything" would hand founder screens to
 * anyone whose row was not filled in, and nothing about that looks broken.
 *
 * An item with no `roles` is ungated and always survives.
 */
function visibleGroups(groups: NavGroup[], roleCode: RoleCode | null): NavGroup[] {
  return (
    groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!item.roles) return true;
          return roleCode !== null && item.roles.includes(roleCode);
        })
      }))
      // A section label with nothing under it is worse than no section — it reads
      // as a failed load rather than as "not for you".
      .filter((group) => group.items.length > 0)
  );
}

export default async function AppSidebar() {
  const actor = await getCurrentActor();
  const roleCode = actor?.roleCode ?? null;

  const groups = visibleGroups(navGroups, roleCode);

  // ⚠️ `now` is resolved ONCE here and threaded down, never read inside a
  // renderer. A clock read during render differs between server and browser by
  // construction, and React discards the mismatched subtree — which presented
  // once as a table rendering its toolbar and row count with no rows, and read
  // exactly like a failed fetch. Same reason formatDueDate(due, now) takes it.
  const now = new Date();

  const showDepartments =
    roleCode !== null && (DEPARTMENTS_SECTION_ROLES as readonly string[]).includes(roleCode);

  // Only queried when the section will actually render — the join is pointless
  // work for a CX agent who will never see it.
  const departments = showDepartments ? await getDeptNav(now) : [];

  return (
    <SidebarShell
      groups={groups}
      departments={departments}
      user={{
        name: actor?.personName ?? null,
        roleLabel: actor?.roleDisplayName ?? null,
        email: actor?.email ?? null
      }}
    />
  );
}
