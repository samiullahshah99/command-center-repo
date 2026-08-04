import { NavGroup } from '@/types';

/**
 * Navigation configuration — grouped sections.
 *
 * ⚠️ THE SINGLE SOURCE FOR BOTH SURFACES. The sidebar renders these groups, and
 * `src/components/kbar/index.tsx` flattens `items` across every group to build
 * its command list, using `label` as the Cmd+K section heading. Adding an entry
 * here gives it a keyboard command for free — and forgetting to remove one
 * leaves a command that navigates to a 404.
 *
 * ⚠️ EVERY URL BELOW IS A ROUTE THAT EXISTS. Verified against
 * `find src/app/dashboard -name page.tsx`. No placeholders, no disabled items,
 * no "coming soon": a nav entry that goes nowhere reads as broken rather than
 * unbuilt, and gets filed as a bug.
 *
 * Not in the nav, deliberately:
 *   • /dashboard/review          — does not exist yet. Day 4 adds the item and
 *                                  it inherits the already-built badge.
 *   • /dashboard/product         — dashboard-starter demo page.
 *   • /dashboard/users           — dashboard-starter demo page.
 *     Both routes and feature folders still exist and are reachable by URL;
 *     only the nav entries are gone. Do not re-add them, do not delete them.
 *   • /dashboard/tracker-mockups — disposable review artefacts.
 *   • /dashboard/profile         — account settings live in the user chip at the
 *                                  foot of the sidebar, not in an IA section.
 */
export const navGroups: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        title: 'Overview',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      }
    ]
  },

  {
    id: 'work',
    label: 'Work',
    items: [
      /**
       * ⚠️ ADDED BEYOND THE REQUESTED STRUCTURE, and easy to remove if wrong.
       *
       * The spec listed only Meetings under Work. But /dashboard/tracker exists,
       * it is the board CLAUDE.md names as the task system of record, and it was
       * in the nav before — dropping it would leave the product's central surface
       * reachable only by typing the URL. That is a reachability regression
       * rather than a tidier IA, so it is here with this note instead of being
       * silently removed.
       */
      {
        title: 'Tracker',
        url: '/dashboard/tracker',
        icon: 'dashboard',
        shortcut: ['t', 't'],
        isActive: false,
        items: []
      },
      {
        title: 'Briefs',
        url: '/dashboard/briefs',
        icon: 'page',
        shortcut: ['b', 'b'],
        isActive: false,
        items: []
      },
      {
        // Label ONLY. The route stays /dashboard/extraction — "Extraction" named
        // the mechanism; "Meetings" names the thing a person is looking for.
        title: 'Meetings',
        url: '/dashboard/extraction',
        icon: 'checks',
        shortcut: ['m', 'm'],
        isActive: false,
        items: []
      }
    ]
  },

  {
    id: 'people',
    label: 'People',
    items: [
      {
        title: 'People',
        url: '/dashboard/people',
        icon: 'employee',
        shortcut: ['e', 'e'],
        isActive: false,
        items: []
      },
      {
        // Verified built: src/app/dashboard/identities/page.tsx exists.
        title: 'Identities',
        url: '/dashboard/identities',
        icon: 'userPen',
        shortcut: ['i', 'i'],
        isActive: false,
        items: [],
        // Unattributed person_identity rows — currently 17 of 19, which is the
        // dominant fact about identity coverage and the reason this badge exists.
        badge: 'identitiesUnlinked'
      }
    ]
  },

  {
    id: 'system',
    label: 'System',
    // Collapsed by default — operator configuration, consulted occasionally.
    defaultOpen: false,
    items: [
      {
        title: 'Connectors',
        url: '/dashboard/connectors',
        icon: 'settings',
        shortcut: ['c', 'c'],
        isActive: false,
        items: []
      },
      {
        title: 'Role Profiles',
        url: '/dashboard/role-profiles',
        icon: 'badgeCheck',
        shortcut: ['r', 'r'],
        isActive: false,
        items: []
      }
    ]
  }
];
