import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidateActionItem, personIdentity } from '@/db/schema';

/**
 * All sidebar badge counts, in ONE response.
 *
 * ⚠️ ONE ENDPOINT, NOT ONE PER BADGE. The sidebar is in the dashboard layout, so
 * this is fetched on every page in the app. Two endpoints would be two round
 * trips per navigation for two integers.
 *
 * ⚠️ EVERY COUNT IS RETURNED whether or not a nav item renders it.
 * `reviewPending` has no consumer today because /dashboard/review does not exist
 * — when it ships, the nav item is added with `badge: 'reviewPending'` and picks
 * this up with no change here. An endpoint shaped around today's UI would need
 * editing on Day 4; this one does not.
 */

export const runtime = 'nodejs';

/**
 * ⚠️ CACHED FOR 60s VIA `unstable_cache`, and the boundary matters: the DB query
 * is inside the cache, `auth()` is OUTSIDE it.
 *
 * Caching a session check would serve one user's authorisation to the next
 * request. So the handler authenticates every call itself and only the two
 * integers — which are not user-specific — are shared.
 *
 * Why cache at all: these render on every page load. Uncached, each navigation
 * adds two COUNT queries against tables that grow, to move a number that nobody
 * needs to the second. 60s is short enough that a reviewer clearing the queue
 * sees the badge fall on their next page change.
 *
 * ⚠️ `unstable_cache`, not `revalidate` on the route: `auth()` makes this handler
 * dynamic, so a route-level revalidate would not apply. Wrapping just the query
 * is what actually caches anything here.
 */
const getBadgeCounts = unstable_cache(
  async () => {
    // Two COUNTs in ONE round trip. Separate statements would be two waits on
    // the same connection for two scalars.
    const [row] = await db
      .select({
        reviewPending: sql<number>`(
          select count(*)::int from ${candidateActionItem}
          where review_status = 'pending'
        )`,
        identitiesUnlinked: sql<number>`(
          select count(*)::int from ${personIdentity}
          where person_id is null
        )`
      })
      .from(sql`(select 1) as _`);

    return {
      reviewPending: row?.reviewPending ?? 0,
      identitiesUnlinked: row?.identitiesUnlinked ?? 0
    };
  },
  ['nav-badges'],
  { revalidate: 60, tags: ['nav-badges'] }
);

export type NavBadgeCounts = Awaited<ReturnType<typeof getBadgeCounts>>;

export async function GET() {
  // Resource-based check, not a reliance on src/proxy.ts — the matcher covers
  // /dashboard pages and this is an API route. `createRouteMatcher` is
  // deprecated precisely because its matching can diverge from Next's routing.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getBadgeCounts());
  } catch {
    /**
     * ⚠️ Badges are DECORATION on navigation. A failed count must never take the
     * sidebar — and therefore every page — down with it, so this degrades to
     * zeros, which the renderer treats as "show nothing". Deliberately not a
     * 500: the client would then need error handling for a number.
     */
    return NextResponse.json({ reviewPending: 0, identitiesUnlinked: 0 }, { status: 200 });
  }
}
