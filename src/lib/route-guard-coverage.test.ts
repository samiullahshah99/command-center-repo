import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGatedRoute } from '@/lib/route-access';

/**
 * EVERY DASHBOARD PAGE MUST DECLARE ITSELF — gated, or deliberately open.
 *
 * ⚠️ THIS IS THE TEST THAT SURVIVES THE NEXT PERSON. The access map and the page
 * guards are only as good as their coverage, and coverage is exactly what rots:
 * someone adds `src/app/dashboard/payroll/page.tsx`, forgets the guard, and it is
 * reachable by URL to every signed-in user. Nothing else in the suite notices —
 * the map is still internally consistent, every existing page is still guarded,
 * and the new page renders fine for the author, who is a founder.
 *
 * So a new page fails this test until it either calls `requireRouteAccess()` or is
 * added to `UNGATED` below with a written reason. Both are cheap; neither can be
 * done by accident.
 *
 * ⚠️ THIS IS A TEXT SCAN, and its bound is deliberate. It proves the guard is
 * CALLED, not that it is called correctly or before the data is read. A page could
 * call it inside a branch that never runs. Combined with the map's own tests
 * (`src/lib/route-access.test.ts`) and the guard's (`src/lib/route-guard.test.ts`)
 * that is a reasonable floor — and a scan that runs in milliseconds on every
 * `pnpm test` beats a perfect check nobody runs.
 */

const DASHBOARD = join('src', 'app', 'dashboard');

/**
 * How an ungated page is nonetheless protected.
 *
 * - `explicit`    — the page authenticates itself (`auth()` / `getCurrentActor()`).
 *                   Any authenticated actor with a role may open it.
 * - `delegated`   — a third-party component owns the check (Clerk's `<UserProfile/>`).
 * - `none`        — ⚠️ NO CHECK AT ALL. Template leftovers only; see the note below.
 */
type AuthKind = 'explicit' | 'delegated' | 'none';

type Exemption = {
  why: string;
  auth: AuthKind;
  /** The file need not exist — for pages that come and go behind a flag. */
  mayBeAbsent?: boolean;
};

/**
 * ⚠️ AN ALLOW-LIST, and every entry states WHY. "It didn't need one" is not a
 * reason — if you cannot write the sentence, the page probably wants a guard.
 *
 * Keys are paths relative to `src/app/dashboard`, using forward slashes.
 */
const UNGATED: Record<string, Exemption> = {
  'page.tsx': {
    why: 'The landing route. Renders nothing — forwards to the actor’s own role home via homeForRole(), so it must be reachable by every role including none.',
    auth: 'explicit'
  },

  'no-access/page.tsx': {
    why: '⚠️ THE REDIRECT TARGET FOR A NULL ROLE. Gating it would bounce a no-role actor to a page that bounces them, forever. src/lib/route-access.test.ts asserts it stays out of ROUTE_ACCESS.',
    auth: 'explicit'
  },

  'people/[personId]/profile/page.tsx': {
    why: 'A shared surface. My team links a support manager straight to a colleague’s profile, and the department page and tracker link here too. Gating it to the roster’s founder/ops would break all three.',
    auth: 'explicit'
  },

  'tracker/[projectId]/page.tsx': {
    why: 'Ordinary work for every role — My day, My projects and My team all render tracked-item rows linking here. Matches /dashboard/tracker, whose access is `all` while its nav item is leadership-only.',
    auth: 'explicit'
  },

  /**
   * ⚠️ `tracker-mockups` IS NOT `tracker`. Per CLAUDE.md these are screenshots
   * pinned to a hardcoded `MOCKUP_TODAY`, kept so the designed screens stay
   * reproducible. They hold no live data, so there is nothing here a role could
   * be wrongly shown — and anyone reviewing a design should be able to open them.
   */
  'tracker-mockups/page.tsx': {
    why: 'Design reference built on a hardcoded MOCKUP_TODAY — no live data, so no role can be wrongly shown anything.',
    auth: 'explicit'
  },
  'tracker-mockups/kanban/page.tsx': {
    why: 'Design reference, hardcoded fixture data only. Same reasoning as the tracker-mockups index.',
    auth: 'explicit'
  },
  'tracker-mockups/person/page.tsx': {
    why: 'Design reference, hardcoded fixture data only. Same reasoning as the tracker-mockups index.',
    auth: 'explicit'
  },
  'tracker-mockups/timeline/page.tsx': {
    why: 'Design reference, hardcoded fixture data only. Same reasoning as the tracker-mockups index.',
    auth: 'explicit'
  },

  'profile/[[...profile]]/page.tsx': {
    why: 'The signed-in user’s OWN Clerk profile. Clerk’s <UserProfile/> owns the session check, and there is no role for which "your own account settings" is the wrong answer.',
    auth: 'delegated'
  },

  /**
   * ⚠️ NOT PRESENT IN THE REPO TODAY. The env-flag-gated demo persona switcher was
   * built and then reverted. Listed anyway, per the brief, so that re-adding it
   * does not trip this test — and because its gate is `DEMO_ROLE_SWITCHER`, not a
   * role: the page must stay reachable whatever role you are currently wearing,
   * which is the whole point of a persona switcher.
   */
  'demo-roles/page.tsx': {
    why: 'Gated by the DEMO_ROLE_SWITCHER env flag (notFound() when off), not by role — it must stay reachable whatever role you are wearing.',
    auth: 'explicit',
    mayBeAbsent: true
  }
};

/**
 * A CALL, not a mention.
 *
 * ⚠️ THE OPEN PAREN IS LOAD-BEARING. A bare `includes('requireRouteAccess')`
 * also matches the `import { requireRouteAccess } from …` line — so deleting the
 * call while leaving the import behind (exactly what a careless edit does) left
 * this test green. Caught by probing it; do not relax this back to a substring.
 */
const CALLS_GUARD = /requireRouteAccess\s*\(/;

/** Evidence that a page resolves a session for itself. */
const AUTHENTICATES =
  /requireRouteAccess|requireActor|requirePersonId|getCurrentActor|await auth\(\)|requireUser/;

function findPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findPages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** `src/app/dashboard/a/[b]/page.tsx` → `a/[b]/page.tsx`, forward slashes. */
function keyOf(file: string): string {
  return relative(DASHBOARD, file).split(sep).join('/');
}

/** `a/[b]/page.tsx` → `/dashboard/a/[b]`; the index → `/dashboard`. */
function routeOf(key: string): string {
  const dir = key.replace(/\/?page\.tsx$/, '');
  return dir ? `/dashboard/${dir}` : '/dashboard';
}

const PAGES = findPages(DASHBOARD).map((file) => ({
  key: keyOf(file),
  source: readFileSync(file, 'utf8')
}));

describe('dashboard route coverage', () => {
  it('finds the pages at all (guards against a broken walk silently passing)', () => {
    // ⚠️ Without this, a wrong path would make every assertion below vacuous —
    // zero pages trivially satisfies "every page is guarded".
    expect(PAGES.length).toBeGreaterThan(20);
    expect(PAGES.map((p) => p.key)).toContain('overview/page.tsx');
  });

  it('every page either calls requireRouteAccess() or is on the UNGATED allow-list', () => {
    const undeclared = PAGES.filter((p) => !CALLS_GUARD.test(p.source) && !(p.key in UNGATED)).map(
      (p) => p.key
    );

    expect(
      undeclared,
      '\n\n' +
        undeclared
          .map(
            (k) =>
              `New dashboard page ${routeOf(k)} is unguarded — call requireRouteAccess(route) ` +
              `and add the route to ROUTE_ACCESS, or add it to UNGATED with a reason.\n` +
              `  file: ${join(DASHBOARD, k)}`
          )
          .join('\n\n') +
        `\n\n  ROUTE_ACCESS lives in src/lib/route-access.ts; UNGATED is at the top of this file.\n` +
        `  A page reachable by URL with no rule is readable by every signed-in user.\n`
    ).toEqual([]);
  });

  it('every page marked `explicit` actually resolves a session', () => {
    const unprotected = Object.entries(UNGATED)
      .filter(([, e]) => e.auth === 'explicit')
      .map(([key]) => PAGES.find((p) => p.key === key))
      .filter((p): p is (typeof PAGES)[number] => Boolean(p))
      .filter((p) => !AUTHENTICATES.test(p.source))
      .map((p) => p.key);

    expect(
      unprotected,
      `\n\nListed as \`auth: 'explicit'\` but nothing in the file resolves a session:\n` +
        unprotected.map((k) => `  • ${k}`).join('\n') +
        `\n\n"Ungated" means any AUTHENTICATED role — not "no check".\n`
    ).toEqual([]);
  });

  /**
   * ⚠️ A page cannot be both. If it were, the allow-list would read as permission
   * while the guard actually refused — or worse, someone would delete the guard
   * call on the strength of the list.
   */
  it('no page is both gated by the map and on the UNGATED list', () => {
    const both = Object.keys(UNGATED).filter((key) => isGatedRoute(routeOf(key)));
    expect(both, `these are in ROUTE_ACCESS *and* on the allow-list: ${both.join(', ')}`).toEqual(
      []
    );
  });

  /**
   * ⚠️ Stops the list from rotting. A stale entry is not inert: it would silently
   * exempt a NEW page later added at the same path.
   */
  it('has no stale UNGATED entries', () => {
    const keys = new Set(PAGES.map((p) => p.key));
    const stale = Object.entries(UNGATED)
      .filter(([key, e]) => !e.mayBeAbsent && !keys.has(key))
      .map(([key]) => key);

    expect(
      stale,
      `\n\nUNGATED lists pages that no longer exist:\n` +
        stale.map((k) => `  • ${k}`).join('\n') +
        `\n\nRemove them — a stale entry would exempt a future page at the same path.\n`
    ).toEqual([]);
  });

  it('every UNGATED entry gives a real reason', () => {
    for (const [key, e] of Object.entries(UNGATED)) {
      expect(e.why.length, `${key} needs a reason worth reading`).toBeGreaterThan(30);
    }
  });

  /**
   * ⚠️ THIS LIST IS NOW EMPTY AND MUST STAY EMPTY.
   *
   * It used to hold three template leftovers — `product`, `product/[productId]`
   * and `users` — which had NO authentication check of any kind and leaned
   * entirely on `src/proxy.ts`'s deprecated route matcher. They have been deleted
   * (inventory §4.2), so every dashboard page now resolves a session one way or
   * another.
   *
   * The `'none'` category is kept rather than removed so that adding a page with
   * no check at all is a deliberate, reviewable act that fails this test — not
   * something anyone can do by omission.
   */
  it('no dashboard page is exempt from authentication entirely', () => {
    const noAuth = Object.entries(UNGATED)
      .filter(([, e]) => e.auth === 'none')
      .map(([key]) => key)
      .sort();

    expect(
      noAuth,
      `\n\nThese pages have NO authentication check:\n${noAuth.map((k) => `  • ${k}`).join('\n')}\n` +
        `\n"Ungated" must mean any AUTHENTICATED role, never "no check".\n`
    ).toEqual([]);
  });
});
