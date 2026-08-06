import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleCode } from '@/db/schema/role';

/**
 * Unit tests for the PAGE GUARD and the SERVICE GUARD.
 *
 * ⚠️ `server-only` IS ALIASED TO AN EMPTY MODULE. `@/lib/current-actor` imports
 * it as its client-boundary marker, and that package resolves to a module which
 * THROWS under Node's default condition — so without this the suite fails to load
 * with "This module cannot be imported from a Client Component module". Measured,
 * and the same trap CLAUDE.md records for `src/db/index.ts`. Neutralising it here
 * costs nothing: the guard it provides is a build-time concern, not a runtime one.
 */
vi.mock('server-only', () => ({}));

/** `redirect()` throws a control-flow signal in Next; this makes it assertable. */
class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`REDIRECT:${target}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new RedirectSignal(target);
  }
}));

// ── The actor's ingredients, controlled per test ────────────────────────────
const state: { userId: string | null; roleCode: RoleCode | null; personId: string | null } = {
  userId: 'user_test',
  roleCode: 'coder',
  personId: 'person-1'
};

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: state.userId }),
  currentUser: async () => ({
    primaryEmailAddress: { emailAddress: 'test@example.com' },
    fullName: 'Test Person'
  })
}));

vi.mock('@/features/identity/resolve', () => ({
  resolvePerson: async () =>
    state.personId
      ? { status: 'resolved', personId: state.personId, identityId: 'identity-1' }
      : { status: 'unresolved', personId: null, identityId: 'identity-1' }
}));

/** Minimal chainable stand-in for the one query `getCurrentActor` runs. */
vi.mock('@/db', () => {
  const result = () => [
    {
      name: 'Test Person',
      roleCode: state.roleCode,
      roleDisplayName: state.roleCode ? 'Test Role' : null,
      departmentId: 'dept-1'
    }
  ];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'leftJoin', 'where']) {
    chain[m] = () => chain;
  }
  chain.limit = async () => result();
  return { db: chain };
});

const { requireRouteAccess, requireRole } = await import('./current-actor');
const { rolesForRoute, NO_ROLE_HOME } = await import('./route-access');
const { isAuthorizationError } = await import('./authorization-error');

/** Runs the guard and reports where it sent the caller, or null if it allowed. */
async function redirectTargetOf(route: Parameters<typeof requireRouteAccess>[0]) {
  try {
    await requireRouteAccess(route);
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.target;
    throw e;
  }
}

beforeEach(() => {
  state.userId = 'user_test';
  state.roleCode = 'coder';
  state.personId = 'person-1';
});

afterEach(() => vi.clearAllMocks());

describe('requireRouteAccess — allow', () => {
  it('lets a permitted role through and returns the actor', async () => {
    state.roleCode = 'coder';
    const actor = await requireRouteAccess('/dashboard/my-projects');
    expect(actor.roleCode).toBe('coder');
  });

  it('lets every role open the tracker, whose nav is leadership-only', async () => {
    for (const code of ['coder', 'cx_agent', 'creative', 'agency'] as RoleCode[]) {
      state.roleCode = code;
      expect(await redirectTargetOf('/dashboard/tracker'), code).toBeNull();
    }
  });
});

describe('requireRouteAccess — deny sends the caller to their OWN home', () => {
  it.each([
    ['coder', '/dashboard/overview', '/dashboard/my-projects'],
    ['cx_agent', '/dashboard/people', '/dashboard/my-day'],
    ['creative', '/dashboard/automations', '/dashboard/briefs'],
    ['support_manager', '/dashboard/overview', '/dashboard/my-team'],
    ['agency', '/dashboard/ai-search', '/dashboard/reporting'],
    ['founder', '/dashboard/my-day', '/dashboard/overview'],
    ['ops_lead', '/dashboard/briefs', '/dashboard/overview']
  ] as [RoleCode, Parameters<typeof requireRouteAccess>[0], string][])(
    '%s denied %s → %s',
    async (code, route, home) => {
      state.roleCode = code;
      expect(await redirectTargetOf(route)).toBe(home);
    }
  );
});

describe('requireRouteAccess — deny by default', () => {
  /**
   * ⚠️ A person on the roster with no `role_id`. Denied everywhere, and sent to
   * the no-role page rather than to any dashboard screen.
   */
  it('sends a null role to the no-role page, not to a fallback screen', async () => {
    state.roleCode = null;
    expect(await redirectTargetOf('/dashboard/overview')).toBe(NO_ROLE_HOME);
    expect(await redirectTargetOf('/dashboard/my-day')).toBe(NO_ROLE_HOME);
  });

  /** Signed in, but the Clerk account matches nobody on the roster. */
  it('denies an actor with no linked person', async () => {
    state.personId = null;
    state.roleCode = null;
    expect(await redirectTargetOf('/dashboard/tracker')).toBe(NO_ROLE_HOME);
  });

  it('sends an unauthenticated caller to sign-in, not to a role home', async () => {
    state.userId = null;
    expect(await redirectTargetOf('/dashboard/overview')).toBe('/auth/sign-in');
  });
});

describe('requireRole — the service guard', () => {
  it('throws AuthorizationError for a role that is not permitted', async () => {
    state.roleCode = 'coder';
    await expect(
      requireRole(rolesForRoute('/dashboard/overview'), 'the Control Tower rollup')
    ).rejects.toThrow(/Control Tower rollup requires one of/);
  });

  it('tags the failure so a caller can tell it from an expired session', async () => {
    state.roleCode = 'cx_agent';
    const err = await requireRole(rolesForRoute('/dashboard/people'), 'the org chart').catch(
      (e) => e
    );
    expect(isAuthorizationError(err)).toBe(true);
    expect(err.name).toBe('AuthorizationError');
  });

  it('throws for a null role', async () => {
    state.roleCode = null;
    await expect(
      requireRole(rolesForRoute('/dashboard/extraction'), 'approving a candidate')
    ).rejects.toThrow(/has no role/);
  });

  it('resolves for a permitted role', async () => {
    state.roleCode = 'ops_lead';
    await expect(
      requireRole(rolesForRoute('/dashboard/automations'), 'the automations overview')
    ).resolves.toMatchObject({ roleCode: 'ops_lead' });
  });

  /**
   * ⚠️ THE POINT OF THE SERVICE GUARD. A Server Action is its own POST endpoint,
   * so the page redirect protects nothing here. This calls the real service with
   * a forbidden role and asserts it refuses — no page involved.
   */
  it('blocks a real service call: a coder cannot fetch the founder offload queue', async () => {
    state.roleCode = 'coder';
    const { getFounderOffload } = await import('@/features/founder-offload/api/service');
    const err = await getFounderOffload().catch((e) => e);
    expect(isAuthorizationError(err)).toBe(true);
  });

  it('the same service resolves for a founder', async () => {
    state.roleCode = 'founder';
    const { getFounderOffload } = await import('@/features/founder-offload/api/service');
    await expect(getFounderOffload()).resolves.toMatchObject({ isSample: true });
  });
});
