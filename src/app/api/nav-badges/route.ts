import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getNavCounts } from '@/lib/nav-counts';

/**
 * All sidebar badge counts, in ONE response.
 *
 * ⚠️ The counts themselves live in `src/lib/nav-counts.ts` because the overview
 * page renders the same `reviewPending` number. Sharing the cached function is
 * what stops the two surfaces double-querying and, worse, disagreeing.
 *
 * ⚠️ EVERY COUNT IS RETURNED whether or not a nav item renders it.
 * `reviewPending` has no badge today because /dashboard/review does not exist —
 * when it ships, the nav item gains `badge: 'reviewPending'` and picks this up
 * with no change here.
 */

export const runtime = 'nodejs';

export type { NavCounts as NavBadgeCounts } from '@/lib/nav-counts';

export async function GET() {
  // Resource-based check, not a reliance on src/proxy.ts — the matcher covers
  // /dashboard pages and this is an API route. `createRouteMatcher` is
  // deprecated precisely because its matching can diverge from Next's routing.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getNavCounts());
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
