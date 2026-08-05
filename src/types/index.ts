import { Icons } from '@/components/icons';
import type { RoleCode } from '@/db/schema/role';

/**
 * Which count from GET /api/nav-badges this item displays, if any.
 *
 * ⚠️ The endpoint returns EVERY count regardless of whether a nav item claims
 * it. Both are now rendered: `reviewPending` on Capture queue, and
 * `identitiesUnlinked` on Identities.
 */
export type NavBadgeKey = 'reviewPending' | 'identitiesUnlinked';

export interface NavItem {
  title: string;
  url: string;
  disabled?: boolean;
  external?: boolean;
  shortcut?: [string, string];
  icon?: keyof typeof Icons;
  label?: string;
  description?: string;
  isActive?: boolean;
  items?: NavItem[];
  badge?: NavBadgeKey;
  /**
   * Which ACCESS roles may see this item. Filtered SERVER-SIDE against
   * `getCurrentActor().roleCode` before the markup reaches the browser.
   *
   * ⚠️ DENY BY DEFAULT WHEN PRESENT. An item carrying `roles` is hidden from an
   * actor whose `roleCode` is null — a signed-in user not yet linked to a roster
   * person, or a person with no `role_id`. Falling back to "show it" would leak
   * founder screens to anyone whose row was not filled in, and that failure does
   * not look like a failure.
   *
   * Omitting `roles` means ungated: visible to every signed-in user.
   *
   * ⚠️ NOT `access`. The removed `NavItem.access` was powered by Clerk
   * Organizations (`has({ plan })` / `<Protect>`), which were deliberately
   * stripped from this template along with Billing. This is our own role table —
   * see src/db/schema/role.ts. Do not reintroduce the org-based mechanism.
   *
   * ⚠️ HIDING IS NOT AUTHORISATION. This controls what renders in the nav; the
   * page or Server Action behind it still does its own `requireUser()` check. A
   * hidden item whose URL is typed must be refused by the route, not by the nav.
   */
  roles?: RoleCode[];
}

export interface NavGroup {
  /**
   * Stable id, independent of the display label. kbar uses `label` as its
   * section heading, so renaming a section must not silently change anything
   * keyed on identity.
   */
  id: string;
  label: string;
  items: NavItem[];
  /**
   * Render the group as a collapsible section, closed by default. Only `false`
   * is meaningful; omit for a normal always-open group. Presentation only —
   * collapsing hides nothing from the router or from Cmd+K, which flattens
   * `items` regardless.
   */
  defaultOpen?: boolean;
}

export interface NavItemWithChildren extends NavItem {
  items: NavItemWithChildren[];
}

export interface NavItemWithOptionalChildren extends NavItem {
  items?: NavItemWithChildren[];
}

export interface FooterItem {
  title: string;
  items: {
    title: string;
    href: string;
    external?: boolean;
  }[];
}

export type MainNavItem = NavItemWithOptionalChildren;

export type SidebarNavItem = NavItemWithChildren;
