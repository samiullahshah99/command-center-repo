import { describe, expect, it } from 'vitest';
import { ROLE_CODES, type RoleCode } from '@/db/schema/role';
import { navGroups, DEPARTMENTS_SECTION_ROLES } from '@/config/nav-config';
import {
  canAccessRoute,
  homeForRole,
  isGatedRoute,
  navRolesForRoute,
  NO_ROLE_HOME,
  ROLE_HOME,
  ROUTE_ACCESS,
  rolesForRoute,
  type GatedRoute
} from './route-access';

const ALL_ROUTES = Object.keys(ROUTE_ACCESS) as GatedRoute[];

describe('canAccessRoute — the rule the page guard enforces', () => {
  it('allows a role that is listed', () => {
    expect(canAccessRoute('founder', '/dashboard/overview')).toBe(true);
    expect(canAccessRoute('ops_lead', '/dashboard/automations')).toBe(true);
    expect(canAccessRoute('creative', '/dashboard/briefs')).toBe(true);
    expect(canAccessRoute('agency', '/dashboard/reporting')).toBe(true);
  });

  it('denies a role that is not listed', () => {
    expect(canAccessRoute('coder', '/dashboard/overview')).toBe(false);
    expect(canAccessRoute('cx_agent', '/dashboard/people')).toBe(false);
    expect(canAccessRoute('founder', '/dashboard/my-day')).toBe(false);
    expect(canAccessRoute('founder', '/dashboard/automations')).toBe(false);
  });

  /**
   * ⚠️ THE HEADLINE RULE. A signed-in user with no linked person, or a person
   * with no `role_id`, must be denied EVERYWHERE. Treating null as a fallback
   * would hand every founder screen to anyone whose roster row was never filled
   * in — a hole that looks like nothing is wrong.
   */
  it('denies a NULL role on every gated route, without exception', () => {
    for (const route of ALL_ROUTES) {
      expect(canAccessRoute(null, route), `null role reached ${route}`).toBe(false);
    }
  });

  /** Agency is excluded from AI search by audit §2.9 — exclusion, not scoping. */
  it('excludes agency from AI search while admitting every other role', () => {
    expect(canAccessRoute('agency', '/dashboard/ai-search')).toBe(false);
    for (const code of ROLE_CODES.filter((c) => c !== 'agency')) {
      expect(canAccessRoute(code, '/dashboard/ai-search'), code).toBe(true);
    }
  });

  /**
   * ⚠️ THE TRACKER IS THE ONE ROUTE WHERE nav ⊂ access. My day, My projects and
   * My team all link to `/dashboard/tracker/{id}`, so gating the page to the
   * nav's founder/ops would bounce every coder and CX agent off their own work.
   */
  it('opens the tracker to every role even though its nav item is leadership-only', () => {
    for (const code of ROLE_CODES) {
      expect(canAccessRoute(code, '/dashboard/tracker'), code).toBe(true);
    }
    expect(navRolesForRoute('/dashboard/tracker')).toEqual(['founder', 'ops_lead']);
  });
});

describe('unlisted routes', () => {
  /**
   * A route absent from the map is open to any authenticated actor with a role.
   * These are the shared surfaces several roles legitimately reach from their own
   * screens, and the exact-match lookup is what keeps them open.
   */
  it.each([
    '/dashboard/people/[personId]/profile',
    '/dashboard/tracker/[projectId]',
    '/dashboard/profile',
    '/dashboard/no-access'
  ])('%s is not gated', (route) => {
    expect(isGatedRoute(route)).toBe(false);
  });

  /**
   * ⚠️ Lookup is EXACT, never by prefix. `/dashboard/people` is founder/ops, but
   * a person profile beneath it is open to everyone — My team links a support
   * manager straight to a colleague's profile. Prefix matching would silently
   * inherit the roster's gate and break that link.
   */
  it('does not let a gated parent leak its gate onto a child route', () => {
    expect(isGatedRoute('/dashboard/people')).toBe(true);
    expect(isGatedRoute('/dashboard/people/[personId]/profile')).toBe(false);
  });
});

describe('redirect targets', () => {
  it.each([
    ['founder', '/dashboard/overview'],
    ['ops_lead', '/dashboard/overview'],
    ['support_manager', '/dashboard/my-team'],
    ['cx_agent', '/dashboard/my-day'],
    ['creative', '/dashboard/briefs'],
    ['coder', '/dashboard/my-projects'],
    ['agency', '/dashboard/reporting']
  ] as [RoleCode, string][])('a denied %s is sent to %s', (code, home) => {
    expect(homeForRole(code)).toBe(home);
  });

  it('sends a null role to the no-role page', () => {
    expect(homeForRole(null)).toBe(NO_ROLE_HOME);
  });

  /**
   * ⚠️ THE LOOP TEST. Every role's home must be a route that role can actually
   * open, or the guard redirects them to a page that redirects them again.
   */
  it('never redirects a role to a page it would be denied', () => {
    for (const code of ROLE_CODES) {
      const home = ROLE_HOME[code];
      if (!isGatedRoute(home)) continue;
      expect(canAccessRoute(code, home), `${code} cannot open its own home ${home}`).toBe(true);
    }
  });

  /**
   * ⚠️ The no-role page must stay OUT of the map. If it were gated, a null-role
   * actor would be redirected to it, denied, and redirected to it again.
   */
  it('leaves the no-role page ungated so it cannot bounce forever', () => {
    expect(isGatedRoute(NO_ROLE_HOME)).toBe(false);
  });
});

describe('nav-config is derived, not duplicated', () => {
  /**
   * ⚠️ THE INVARIANT: nav ⊆ access. A nav item shown to somebody who would be
   * redirected away is a link that looks broken.
   */
  it('never shows a nav item to a role that cannot open its page', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (!item.roles || !isGatedRoute(item.url)) continue;
        for (const code of item.roles) {
          expect(
            canAccessRoute(code, item.url),
            `nav shows "${item.title}" to ${code}, who cannot open ${item.url}`
          ).toBe(true);
        }
      }
    }
  });

  /** Every nav item's roles come from the map, so the two cannot drift. */
  it('matches the map exactly for every nav item', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (!isGatedRoute(item.url)) continue;
        expect(item.roles, item.url).toEqual([...navRolesForRoute(item.url)]);
      }
    }
  });

  it('derives the departments section gate from the map too', () => {
    expect([...DEPARTMENTS_SECTION_ROLES]).toEqual([...navRolesForRoute('/dashboard/departments')]);
  });
});

describe('map integrity', () => {
  it('lists only real role codes', () => {
    for (const route of ALL_ROUTES) {
      for (const code of rolesForRoute(route)) {
        expect(ROLE_CODES, `${route} lists unknown role ${code}`).toContain(code);
      }
    }
  });

  it('never leaves a gated route with an empty role list', () => {
    for (const route of ALL_ROUTES) {
      expect(rolesForRoute(route).length, `${route} is unreachable`).toBeGreaterThan(0);
    }
  });
});
