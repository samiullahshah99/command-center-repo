import { unstable_cache } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidateActionItem, personIdentity } from '@/db/schema';

/**
 * Counts shared between the sidebar badges and the overview page.
 *
 * ⚠️ ONE cached function, so nothing double-queries. The sidebar's
 * `reviewPending` badge and Overview's Review card are the SAME number; querying
 * it twice per page load to render it twice would be waste, and worse, the two
 * could disagree mid-refresh and look like a bug.
 *
 * ⚠️ Lives in `src/lib` because both a route handler (`/api/nav-badges`) and a
 * feature service consume it. Not `'use server'` — a plain module called by
 * both, with no auth of its own, so EVERY caller must `auth()` first.
 *
 * ⚠️ CACHED 60s VIA `unstable_cache`, and the boundary is deliberate: the DB
 * query is inside the cache, `auth()` is outside it at every call site. Caching a
 * session check would serve one user's authorisation to the next request. These
 * two integers are not user-specific, so sharing them is safe.
 *
 * ⚠️ `unstable_cache`, not a route-level `revalidate`: `auth()` makes those
 * callers dynamic, so a route-level revalidate would apply to nothing. Wrapping
 * the query is what actually caches.
 */
export const getNavCounts = unstable_cache(
  async () => {
    // Both counts in ONE round trip. Two statements would be two waits on the
    // same connection for two scalars.
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

export type NavCounts = Awaited<ReturnType<typeof getNavCounts>>;
