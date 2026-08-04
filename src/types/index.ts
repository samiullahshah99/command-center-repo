import { Icons } from '@/components/icons';

/**
 * Which count from GET /api/nav-badges this item displays, if any.
 *
 * ⚠️ The endpoint returns EVERY count regardless of whether a nav item claims
 * it. `reviewPending` is returned today with nothing rendering it, because
 * /dashboard/review does not exist yet — when it ships, the nav item is added
 * with `badge: 'reviewPending'` and inherits the badge with no endpoint change.
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
