import { ROLE_CODES, type RoleCode } from '@/db/schema/role';

/**
 * WHO MAY OPEN WHICH DASHBOARD ROUTE — the single source of truth.
 *
 * ⚠️ CLIENT-SAFE, CONSTANTS ONLY. `src/config/nav-config.ts` imports this and is
 * itself imported on the client by kbar, so nothing here may touch the database,
 * the actor or `process.env`. `@/db/schema/role` is a schema module (drizzle's
 * query builder, no driver) and is explicitly allowed in client code — see
 * CLAUDE.md. The enforcement half lives in `requireRouteAccess()` in
 * `@/lib/current-actor`, which is server-only.
 *
 * ⚠️ THE NAV WAS NEVER THE ACCESS CONTROL. Before this map, `roles` in
 * nav-config hid nav items while every page did `requireUser()` alone — so any
 * signed-in user could open any dashboard route by typing its URL. nav-config now
 * BUILDS its gating from this map, so the two cannot drift apart.
 *
 * ── Why an entry has two fields ─────────────────────────────────────────────
 *
 * ⚠️ NAV VISIBILITY AND PAGE ACCESS ARE DIFFERENT QUESTIONS, and collapsing them
 * breaks a real flow. The tracker is the case that proves it: its nav item is
 * founder/ops only (it is an operator tool, in a collapsed System group), but My
 * day, My projects and My team ALL render tracked-item rows linking to
 * `/dashboard/tracker/{id}`. Gate the PAGE to the nav's roles and every coder,
 * creative and CX agent clicking their own work gets bounced home.
 *
 * So `access` is the security rule and `nav` is presentation, defaulting to
 * `access`.
 *
 * ⚠️ INVARIANT: `nav` MUST be a subset of `access`. A nav item shown to someone
 * who would be redirected away is a link that looks broken. A test asserts this.
 */
export type RouteRule = {
  /**
   * Who may LOAD the page.
   *
   * `'all'` means every one of the seven roles — NOT "anyone signed in". An actor
   * with a null `roleCode` is denied everywhere; see `canAccessRoute`.
   */
  access: readonly RoleCode[] | 'all';
  /** Who SEES the nav item. Defaults to `access`. Must be a subset of it. */
  nav?: readonly RoleCode[];
};

const LEADERSHIP = ['founder', 'ops_lead'] as const;

/**
 * ⚠️ AN ALLOW-LIST OF GATED ROUTES, not a list of every route. A route absent
 * from this map is reachable by any authenticated actor with a role — which is
 * correct for the shared surfaces (a person profile, a tracked item) that several
 * roles legitimately reach from their own screens.
 *
 * ⚠️ LOOKUP IS EXACT, NEVER BY PREFIX, and that is load-bearing.
 * `/dashboard/people` is founder/ops (the admin roster), while
 * `/dashboard/people/{id}/profile` is open to everyone — My team links a support
 * manager straight to a colleague's profile. Prefix matching would silently
 * inherit the roster's gate and break that link.
 */
export const ROUTE_ACCESS = {
  // ── Workspace ─────────────────────────────────────────────────────────────
  '/dashboard/overview': { access: LEADERSHIP },
  '/dashboard/my-day': { access: ['cx_agent', 'creative', 'coder', 'support_manager'] },
  '/dashboard/my-team': { access: ['support_manager'] },
  '/dashboard/briefs': { access: ['creative'] },
  '/dashboard/my-projects': { access: ['coder'] },
  '/dashboard/extraction': { access: ['founder', 'ops_lead', 'support_manager'] },
  '/dashboard/automations': { access: ['ops_lead'] },
  '/dashboard/reporting': { access: ['ops_lead', 'agency'] },

  /**
   * Every role EXCEPT agency, listed explicitly rather than as a negation — the
   * check has one rule (is my role in this list?) and an "all except" form would
   * need a second, which is how one of them ends up wrong. Audit §2.9 requires
   * role-based EXCLUSION of agency here, not merely scoping.
   */
  '/dashboard/ai-search': {
    access: ['founder', 'ops_lead', 'support_manager', 'cx_agent', 'creative', 'coder']
  },

  // ── Company ───────────────────────────────────────────────────────────────
  '/dashboard/people': { access: LEADERSHIP },
  '/dashboard/founder-offload': { access: LEADERSHIP },
  '/dashboard/departments': { access: LEADERSHIP },

  // ── System (operator tools) ───────────────────────────────────────────────

  /**
   * ⚠️ THE ONE ROUTE WHERE nav ⊂ access, AND IT IS DELIBERATE.
   *
   * The Command Centre is the task system of record, so a tracked item is
   * ordinary work for every role — My day, My projects and My team all link into
   * it. But the board itself is an operator surface nobody else needs in their
   * sidebar. Access is open; the nav item is not.
   */
  '/dashboard/tracker': { access: 'all', nav: LEADERSHIP },

  '/dashboard/identities': { access: LEADERSHIP },
  '/dashboard/connectors': { access: LEADERSHIP },
  '/dashboard/role-profiles': { access: LEADERSHIP },

  // ── Sub-routes that are NOT nav items and would otherwise be ungated ───────
  //
  // ⚠️ Without these four the gate would be trivially bypassable: the roster is
  // protected but `/dashboard/people/{id}` (its EDIT form) would not be, and the
  // capture queue is protected but a single candidate at
  // `/dashboard/extraction/{id}` would not be. Exact-match lookup means a parent
  // entry protects nothing below it.
  '/dashboard/people/[personId]': { access: LEADERSHIP },
  '/dashboard/extraction/[id]': { access: ['founder', 'ops_lead', 'support_manager'] },
  '/dashboard/role-profiles/[roleProfileId]': { access: LEADERSHIP },
  '/dashboard/departments/[departmentId]': { access: LEADERSHIP }
} as const satisfies Record<string, RouteRule>;

/**
 * The routes this map gates. A page passes its own key, and because the parameter
 * is typed to these keys a TYPO IS A COMPILE ERROR rather than a silent allow —
 * which is what deny-by-default has to mean for a lookup-based guard.
 */
export type GatedRoute = keyof typeof ROUTE_ACCESS;

/** Where each role lands when it is redirected, and its post-sign-in home. */
export const ROLE_HOME: Record<RoleCode, string> = {
  founder: '/dashboard/overview',
  ops_lead: '/dashboard/overview',
  support_manager: '/dashboard/my-team',
  cx_agent: '/dashboard/my-day',
  creative: '/dashboard/briefs',
  coder: '/dashboard/my-projects',
  agency: '/dashboard/reporting'
};

/**
 * Where an actor with NO role goes.
 *
 * ⚠️ Must not be gated, or a no-role actor redirects to a page that redirects
 * them, forever. There is a test for the loop.
 */
export const NO_ROLE_HOME = '/dashboard/no-access';

/** Roles permitted to LOAD a route. */
export function rolesForRoute(route: GatedRoute): readonly RoleCode[] {
  const rule: RouteRule = ROUTE_ACCESS[route];
  return rule.access === 'all' ? ROLE_CODES : rule.access;
}

/** Roles that SEE the nav item. Defaults to `access`. */
export function navRolesForRoute(route: GatedRoute): readonly RoleCode[] {
  const rule: RouteRule = ROUTE_ACCESS[route];
  return rule.nav ?? rolesForRoute(route);
}

/**
 * ⚠️ DENY BY DEFAULT ON A NULL ROLE. A signed-in user with no linked person, or a
 * person with no `role_id`, is denied everywhere. Treating null as a fallback
 * would hand founder screens to anyone whose roster row was never filled in —
 * the failure that does not look like a failure.
 */
export function canAccessRoute(roleCode: RoleCode | null, route: GatedRoute): boolean {
  if (!roleCode) return false;
  return rolesForRoute(route).includes(roleCode);
}

/** Where to send an actor who may not be where they are. */
export function homeForRole(roleCode: RoleCode | null): string {
  return roleCode ? ROLE_HOME[roleCode] : NO_ROLE_HOME;
}

/**
 * `true` when the route is in this map at all.
 *
 * Used by tests and by nav-config; an unlisted route is open to any authenticated
 * actor holding a role, by design — see the note on ROUTE_ACCESS.
 */
export function isGatedRoute(route: string): route is GatedRoute {
  return route in ROUTE_ACCESS;
}
