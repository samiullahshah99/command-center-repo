import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import HomeListing from '@/features/home/components/home-listing';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = { title: 'Executive Control Tower' };

/**
 * The Command Center landing page — the Executive Control Tower.
 *
 * Replaced the dashboard starter's parallel-routes demo entirely: four fake
 * charts, hardcoded revenue figures, and 1–3s artificial `delay()` calls, all
 * removed. Verified no `delay`/`setTimeout` remains on this route.
 *
 * ⚠️ Reached from the sidebar as "Control Tower", gated to founder / ops_lead. The
 * nav gate is visibility only — the auth check below is the actual control, and it
 * is resource-based per CLAUDE.md rather than relying on src/proxy.ts's deprecated
 * `createRouteMatcher`, whose path matching can diverge from how Next.js routes.
 */
export default async function OverviewPage() {
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/overview');

  return (
    // ⚠️ NO pageTitle. The Control Tower's own header row IS the page header —
    // title, date and the liveness pill are one baseline-aligned row inside the
    // feature. Passing pageTitle too would render two headings ten pixels apart.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <HomeListing />
      </Suspense>
    </PageContainer>
  );
}
