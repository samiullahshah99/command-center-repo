import 'server-only';

/**
 * ⚠️ `import 'server-only'` above is the BOUNDARY GUARD, not decoration.
 *
 * This module imports `db`, so a `'use client'` component importing anything
 * from it drags `pg` into the browser bundle — which fails as seven Turbopack
 * errors naming `dns`, `net`, `tls` and `fs` inside pg internals, none of which
 * mentions the import that caused it. With this marker the build instead names
 * the actual rule. Add this file to FORBIDDEN in
 * scripts/check-client-boundaries.ts if it ever grows a client-tempting export.
 *
 * ⚠️ NOT `'use server'`. This is a plain module called BY Server Actions and
 * route handlers, not a Server Action itself — publishing it as one would give
 * the browser a callable endpoint that writes identity rows. Every caller does
 * its own `auth()` first; see `requireActor()` below.
 *
 * ── What this solves ────────────────────────────────────────────────────────
 * Clerk authenticates a user and hands back an opaque `userId`. Nothing in this
 * database knew what that string meant, so "me" could not be resolved to a
 * `person` row — which blocked every my-scoped screen (My day, My projects) and
 * the sidebar's own user chip.
 *
 * ── Why this reuses the identity resolver rather than adding a column ───────
 * `person_identity` already reserves `source='portal'` for the Command Centre's
 * own Clerk instance: it is in IDENTITY_SOURCES and deliberately NOT in
 * RAW_EVENT_SOURCES, because the portal issues identities but never delivers
 * webhooks. The slot existed and was unused.
 *
 * Going through `resolvePerson()` inherits, for free and already tested:
 *   - the `(source, external_id)` unique index, so this is idempotent under
 *     concurrent requests via ON CONFLICT rather than select-then-insert
 *   - the EXACT -> EMAIL -> UNRESOLVED ladder
 *   - `person_identity_link_provenance_ck`, so a link always records how it was
 *     made
 *   - the unresolved queue: a signed-in user whose email is not on the roster
 *     shows up as an identity to link, exactly like a Slack or Vision actor,
 *     instead of vanishing
 *
 * A `person.clerk_user_id` column would have none of that, and would repeat the
 * mistake `person.slack_id` / `.clickup_id` / `.portal_id` already made — one
 * column per system, no source discriminator, quietly inviting cross-system id
 * comparison. Those three are deprecated and NULL on every row.
 *
 * ⚠️ IDS ARE NOT COMPARABLE ACROSS THE THREE CLERK INSTANCES. Vision, UGC and
 * the Command Centre each run their own, and a `user_id` from one is an
 * unrelated string to a `user_id` from another — they may collide. Identity is
 * always the PAIR. That is why the write below hardcodes `source: 'portal'` and
 * never accepts a source from a caller.
 */

import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { auth, currentUser } from '@clerk/nextjs/server';
import { db } from '@/db';
import { person, role, type RoleCode } from '@/db/schema';
import { resolvePerson } from '@/features/identity/resolve';

/** The Clerk instance this app owns. Never parameterised — see the header. */
const PORTAL_SOURCE = 'portal' as const;

export type CurrentActor = {
  /** Clerk's user id. Opaque; only meaningful paired with 'portal'. */
  clerkUserId: string;
  /** Primary email from Clerk, lowercased. Null when Clerk has none. */
  email: string | null;
  /** The `person_identity` row for this Clerk user. Always present. */
  identityId: string;
  /**
   * Null when the Clerk account could not be matched to a roster person —
   * usually because their email is not on it, or Clerk has no email at all.
   *
   * ⚠️ A null person is NOT an error and must NOT fail the request: the user is
   * genuinely authenticated. It means "signed in, not yet on the roster", and
   * the identity is sitting in the unresolved queue to be linked.
   */
  personId: string | null;
  personName: string | null;
  /**
   * ⚠️ THE ONLY THING AUTHORISATION MAY BRANCH ON — and null means NO ACCESS,
   * never a default.
   *
   * Null when the actor has no linked person, or that person has no `role_id`
   * yet. Treating null as a fallback role would grant founder screens to anyone
   * whose row was not filled in, which is precisely the failure that does not
   * look like a failure.
   */
  roleCode: RoleCode | null;
  /**
   * `role.display_name` — the human label for the sidebar's user chip.
   *
   * ⚠️ DISPLAY ONLY. Never branch on this: it is mutable in the database and
   * localisable, whereas `roleCode` is the stable key. Authorisation reads
   * `roleCode`, the UI reads this.
   */
  roleDisplayName: string | null;
  departmentId: string | null;
};

/**
 * Resolve the signed-in user to a roster person, role and department.
 *
 * ⚠️ MEMOISED PER REQUEST with React's `cache()`, which is what makes the
 * "nav visibility never needs a per-render DB join" requirement true: the
 * sidebar, the page and every nested server component share one lookup, and the
 * memo dies with the request.
 *
 * ⚠️ `cache()` DELIBERATELY, not `unstable_cache`. `unstable_cache` persists
 * across requests, and this value is user-specific — a cache keyed even
 * slightly wrong serves one person's role to the next request, which is the
 * worst bug this file could have. `nav-counts.ts` may use `unstable_cache`
 * safely only because its two integers are not user-specific, and it keeps
 * `auth()` outside the cache for the same reason.
 *
 * Returns null when nobody is signed in. Callers that require a session should
 * use `requireActor()`.
 */
export const getCurrentActor = cache(async (): Promise<CurrentActor | null> => {
  const { userId } = await auth();
  if (!userId) return null;

  // Clerk's `currentUser()` is the only source of the email; the session claim
  // carries the id alone.
  const u = await currentUser();
  const email = u?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? null;

  // The write. Idempotent: ON CONFLICT (source, external_id) inside
  // resolvePerson, so concurrent first requests cannot both insert.
  //
  // `displayName` is stored for the unresolved queue's benefit only — it is
  // display-only and is NEVER matched on. Two people can share a name, and a
  // wrong auto-link silently attributes one person's work to another.
  const resolution = await resolvePerson({
    source: PORTAL_SOURCE,
    externalId: userId,
    email,
    displayName: u?.fullName ?? null
  });

  const base = {
    clerkUserId: userId,
    email,
    identityId: resolution.identityId
  };

  if (resolution.status !== 'resolved') {
    return {
      ...base,
      personId: null,
      personName: null,
      roleCode: null,
      roleDisplayName: null,
      departmentId: null
    };
  }

  // One join for the role code, so callers compare greppable strings and never
  // a numeric role id.
  const [row] = await db
    .select({
      name: person.name,
      roleCode: role.code,
      roleDisplayName: role.displayName,
      departmentId: person.departmentId
    })
    .from(person)
    .leftJoin(role, eq(role.id, person.roleId))
    .where(eq(person.id, resolution.personId))
    .limit(1);

  return {
    ...base,
    personId: resolution.personId,
    personName: row?.name ?? null,
    // `role.code` is CHECK-free TEXT in Postgres (the seven rows are the
    // constraint), so this cast is the one place the string re-enters the type
    // system. A role inserted by hand that is not in ROLE_CODES surfaces here.
    roleCode: (row?.roleCode as RoleCode | undefined) ?? null,
    roleDisplayName: row?.roleDisplayName ?? null,
    departmentId: row?.departmentId ?? null
  };
});

/**
 * Same, but throws when unauthenticated.
 *
 * ⚠️ Resource-based, exactly like every service's own `requireUser()` — NOT a
 * reliance on `src/proxy.ts`. Clerk's `createRouteMatcher` is deprecated and its
 * path matching can diverge from how Next.js actually routes, and a Server
 * Action is its own reachable endpoint that the matcher does not cover.
 *
 * ⚠️ Throws only on NO SESSION. It resolves successfully with `personId: null`
 * for a signed-in user who is not on the roster — that is an authorisation
 * question for the caller, not an authentication failure.
 */
export async function requireActor(): Promise<CurrentActor> {
  const actor = await getCurrentActor();
  if (!actor) throw new Error('Not authenticated');
  return actor;
}

/**
 * "Which person am I?" for my-scoped queries.
 *
 * Throws when the signed-in user is not linked to a roster person, because a
 * my-scoped query with no person cannot be answered — and returning an empty
 * list instead would render My day as "nothing assigned to you", which reads as
 * a fact about the user rather than a gap in our data.
 */
export async function requirePersonId(): Promise<string> {
  const actor = await requireActor();
  if (!actor.personId) {
    throw new Error(
      `Signed-in user ${actor.clerkUserId} is not linked to a person. ` +
        `Their identity is in the unresolved queue at /dashboard/identities — link it, ` +
        `or set the matching person's email so it resolves automatically.`
    );
  }
  return actor.personId;
}
