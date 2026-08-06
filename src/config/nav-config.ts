import type { NavGroup } from '@/types';
import { navRolesForRoute, type GatedRoute } from '@/lib/route-access';

/**
 * Navigation configuration — the roles-mockup information architecture.
 *
 * ⚠️ THE SINGLE SOURCE FOR BOTH SURFACES. The sidebar renders these groups, and
 * `src/components/kbar/index.tsx` flattens `items` across every group to build
 * its command list, using `label` as the Cmd+K section heading.
 *
 * ⚠️ kbar IS NOT ROLE-FILTERED, and that is now HARMLESS rather than a gap.
 * It imports this module directly on the client, where the actor is not
 * available, so Cmd+K still offers every command. Selecting a forbidden one no
 * longer reaches the screen: `requireRouteAccess()` runs in the page and
 * redirects to the caller's own role home. The remaining cost is cosmetic — a
 * command that appears in the palette and quietly bounces you home.
 *
 * Threading the filtered groups from the server layout into KBar as a prop would
 * tidy that up and is still worth doing; it is a presentation fix, not a security
 * one.
 *
 * ⚠️ `roles` BELOW IS DERIVED, NOT DECLARED. Every value comes from
 * `@/lib/route-access`, which is also what the page guard enforces — so nav
 * visibility and page access cannot drift. Do not hand-write a `roles` array
 * here: it would be presentation disagreeing with security, and the nav is the
 * half with no teeth.
 *
 * ⚠️ ORDER IS THE SPEC'S ORDER. The Workspace items below are listed in the
 * exact sequence the mockup shows them; do not alphabetise.
 *
 * ── Role gating ─────────────────────────────────────────────────────────────
 * `roles` is filtered server-side against `getCurrentActor().roleCode`. An item
 * with `roles` is hidden when roleCode is null — deny by default. See NavItem.
 *
 * ── Routes ──────────────────────────────────────────────────────────────────
 * Every URL resolves to a page. Where the mockup screen is not built, the URL
 * points at a stub carrying a "not built yet" body, so nothing 404s. Where a
 * REAL page already covers the mockup screen, the item points at that instead of
 * a stub:
 *
 *   Control Tower   -> /dashboard/overview     the existing pre-aggregated
 *                                              founder landing page
 *                                              (getHomeSnapshot)
 *   Capture queue   -> /dashboard/extraction   where candidate review and
 *                                              approveCandidate() already live
 *   Briefs & quota  -> /dashboard/briefs       real Vision-event brief board
 *   People & org    -> /dashboard/people       real roster + identity coverage
 */
/**
 * Nav visibility for a route, from the shared access map.
 *
 * ⚠️ `navRolesForRoute` — NOT the access list. For all but one route they are the
 * same value. The exception is the tracker: its nav item is founder/ops only
 * because it is an operator surface, while the PAGE is open to everyone, because
 * My day, My projects and My team all link into it. The map holds both; this
 * reads the presentation half.
 *
 * ⚠️ Mutable copy: `NavItem.roles` is a mutable `RoleCode[]` and the map returns
 * `readonly`. Spreading here keeps the map immutable rather than widening it.
 */
function rolesFor(route: GatedRoute) {
  return [...navRolesForRoute(route)];
}

export const navGroups: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        title: 'My day',
        url: '/dashboard/my-day',
        icon: 'sun',
        shortcut: ['m', 'd'],
        roles: rolesFor('/dashboard/my-day'),
        items: []
      },
      {
        // The existing overview page IS this screen — one pre-aggregated call,
        // real severity-ranked attention rows. A stub would have replaced a
        // working surface with a placeholder.
        title: 'Control Tower',
        url: '/dashboard/overview',
        icon: 'dashboard',
        shortcut: ['c', 't'],
        roles: rolesFor('/dashboard/overview'),
        items: []
      },
      {
        title: 'My team',
        url: '/dashboard/my-team',
        icon: 'teams',
        shortcut: ['m', 't'],
        roles: rolesFor('/dashboard/my-team'),
        items: []
      },
      {
        title: 'Briefs & quota',
        url: '/dashboard/briefs',
        icon: 'post',
        shortcut: ['b', 'b'],
        roles: rolesFor('/dashboard/briefs'),
        items: []
      },
      {
        title: 'My projects',
        url: '/dashboard/my-projects',
        icon: 'code',
        shortcut: ['m', 'p'],
        roles: rolesFor('/dashboard/my-projects'),
        items: []
      },
      {
        // The pill is `reviewPending` — pending candidate_action_item rows, the
        // count GET /api/nav-badges has returned since before anything rendered
        // it. Nothing about the endpoint changed to wire it up here.
        title: 'Capture queue',
        url: '/dashboard/extraction',
        icon: 'inbox',
        shortcut: ['c', 'q'],
        roles: rolesFor('/dashboard/extraction'),
        badge: 'reviewPending',
        items: []
      },
      {
        title: 'Automations',
        url: '/dashboard/automations',
        icon: 'zap',
        shortcut: ['a', 'u'],
        roles: rolesFor('/dashboard/automations'),
        items: []
      },
      {
        title: 'Reporting',
        url: '/dashboard/reporting',
        icon: 'barChart',
        shortcut: ['r', 'p'],
        roles: rolesFor('/dashboard/reporting'),
        items: []
      },
      {
        // Every role EXCEPT agency. Listed explicitly rather than as a negation:
        // the filter has one rule (is my role in this list?), and an "all except"
        // form would need a second, which is how one of them ends up wrong.
        title: 'AI search',
        url: '/dashboard/ai-search',
        icon: 'search',
        shortcut: ['a', 'i'],
        roles: rolesFor('/dashboard/ai-search'),
        items: []
      }
    ]
  },

  {
    id: 'company',
    label: 'Company',
    items: [
      {
        title: 'People & org',
        url: '/dashboard/people',
        icon: 'teams',
        shortcut: ['p', 'p'],
        roles: rolesFor('/dashboard/people'),
        items: []
      },
      {
        title: 'Founder offload',
        url: '/dashboard/founder-offload',
        icon: 'share',
        shortcut: ['f', 'o'],
        roles: rolesFor('/dashboard/founder-offload'),
        items: []
      }
    ]
  },

  /**
   * ⚠️ NOT IN THE MOCKUP — added to prevent a reachability regression, and
   * trivially removable if unwanted.
   *
   * The mockup's IA has no home for four BUILT, WORKING operator surfaces:
   * the tracker board (which CLAUDE.md names as the task system of record),
   * identity linking, connector health, and role profiles. Rebuilding the nav to
   * the mockup alone would have left all four reachable only by typing a URL —
   * a regression the previous nav-config explicitly warned against for the
   * tracker specifically.
   *
   * Gated to founder/ops_lead because these are operator tools, and collapsed by
   * default because they are consulted occasionally rather than daily. Delete
   * this group to match the mockup exactly.
   */
  {
    id: 'system',
    label: 'System',
    defaultOpen: false,
    items: [
      {
        title: 'Tracker',
        url: '/dashboard/tracker',
        icon: 'checks',
        shortcut: ['t', 't'],
        roles: rolesFor('/dashboard/tracker'),
        items: []
      },
      {
        title: 'Identities',
        url: '/dashboard/identities',
        icon: 'userPen',
        shortcut: ['i', 'i'],
        roles: rolesFor('/dashboard/identities'),
        badge: 'identitiesUnlinked',
        items: []
      },
      {
        title: 'Connectors',
        url: '/dashboard/connectors',
        icon: 'settings',
        shortcut: ['c', 'c'],
        roles: rolesFor('/dashboard/connectors'),
        items: []
      },
      {
        title: 'Role Profiles',
        url: '/dashboard/role-profiles',
        icon: 'badgeCheck',
        shortcut: ['r', 'r'],
        roles: rolesFor('/dashboard/role-profiles'),
        items: []
      }
    ]
  }
];

/**
 * Where the Departments section is rendered, and who may see it.
 *
 * The section's ROWS come from the database (one per `department`), so it cannot
 * live in the static config above — but its role gate belongs beside the others
 * rather than inline in the sidebar, so the whole matrix reads from one file.
 */
export const DEPARTMENTS_SECTION_ROLES = navRolesForRoute('/dashboard/departments');

/**
 * Which roles get the copilot input on the top bar rather than the plain
 * "Ask the AI brain" button. Agency gets neither — see AI search above.
 */
export const COPILOT_ROLES = ['founder', 'ops_lead'] as const;

/** The AI-search route, referenced by both top-bar affordances. */
export const AI_SEARCH_URL = '/dashboard/ai-search';
